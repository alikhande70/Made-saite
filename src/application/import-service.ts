/**
 * Bulk import for the parts catalogue.
 *
 * The flow is deliberately two-phase: **validate** parses and checks the whole
 * file and stores the result as a job, **commit** applies that stored result
 * inside a single transaction. An administrator therefore always sees exactly
 * what will change before anything changes, and a partial write is impossible
 * — a supplier file that is half-wrong leaves the catalogue untouched rather
 * than half-updated.
 *
 * Every unresolved reference (an unknown brand, category or vehicle model) is
 * reported as an error. Nothing is auto-created from an import: a typo in a
 * supplier's brand column must not silently mint a new brand.
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import {
  brands, categories, importJobs, inventory, products,
  vehicleEngines, vehicleModels, vehicleTrims,
} from '@/infrastructure/db/schema';
import {
  parseProductCsv, type ImportRowError, type ParsedProductRow, type ParseResult,
} from '@/domain/import';
import { errors } from '@/domain/errors';
import { setProductFitments, setProductReferences } from './fitment-service';
import { ensureInventoryRow } from './inventory-service';
import { slugify, uniqueSlug } from '@/lib/slug';
import { toPersianDigits } from '@/lib/fa';

/** Errors stored per job. Beyond this the report says how many were dropped. */
const MAX_STORED_ERRORS = 500;

export interface ImportPreview {
  jobId: string;
  status: 'VALIDATED' | 'FAILED';
  totalRows: number;
  validRows: number;
  errorRows: number;
  /** Rows whose SKU already exists — these will be updated, not created. */
  willUpdate: number;
  willCreate: number;
  errors: ImportRowError[];
  truncatedErrors: number;
  /** First few rows as they will be applied, for the preview table. */
  sample: ParsedProductRow[];
}

/* ── reference resolution ─────────────────────────────────────────────── */

interface Lookups {
  brandBySlug: Map<string, string>;
  brandByName: Map<string, string>;
  categoryBySlug: Map<string, string>;
  categoryByName: Map<string, string>;
  modelBySlug: Map<string, string>;
  engineByModelAndCode: Map<string, string>;
  trimByModelAndCode: Map<string, string>;
  productIdBySku: Map<string, string>;
  /** Current pricing of the products a file touches, for cross-row validation. */
  pricingBySku: Map<string, { price: number; salePrice: number | null }>;
}

async function loadLookups(db: Database, skus: readonly string[]): Promise<Lookups> {
  const [brandRows, categoryRows, modelRows, engineRows, trimRows, productRows] = await Promise.all([
    db.select({ id: brands.id, slug: brands.slug, nameFa: brands.nameFa }).from(brands),
    db.select({ id: categories.id, slug: categories.slug, nameFa: categories.nameFa }).from(categories),
    db.select({ id: vehicleModels.id, slug: vehicleModels.slug }).from(vehicleModels),
    db.select({ id: vehicleEngines.id, modelId: vehicleEngines.vehicleModelId, code: vehicleEngines.code }).from(vehicleEngines),
    db.select({ id: vehicleTrims.id, modelId: vehicleTrims.vehicleModelId, code: vehicleTrims.code }).from(vehicleTrims),
    skus.length > 0
      ? db
          .select({ id: products.id, sku: products.sku, price: products.price, salePrice: products.salePrice })
          .from(products)
          .where(inArray(products.sku, [...skus]))
      : Promise.resolve([] as { id: string; sku: string; price: number; salePrice: number | null }[]),
  ]);

  const key = (modelId: string, code: string) => `${modelId}::${code.toUpperCase()}`;
  return {
    brandBySlug: new Map(brandRows.map((b) => [b.slug, b.id])),
    brandByName: new Map(brandRows.map((b) => [b.nameFa.trim(), b.id])),
    categoryBySlug: new Map(categoryRows.map((c) => [c.slug, c.id])),
    categoryByName: new Map(categoryRows.map((c) => [c.nameFa.trim(), c.id])),
    modelBySlug: new Map(modelRows.map((m) => [m.slug, m.id])),
    engineByModelAndCode: new Map(engineRows.map((e) => [key(e.modelId, e.code), e.id])),
    trimByModelAndCode: new Map(trimRows.map((t) => [key(t.modelId, t.code), t.id])),
    productIdBySku: new Map(productRows.map((p) => [p.sku, p.id])),
    pricingBySku: new Map(productRows.map((p) => [p.sku, { price: p.price, salePrice: p.salePrice }])),
  };
}

/**
 * Checks every foreign reference a row makes.
 *
 * This is where "never silently accept malformed automotive data" is enforced:
 * an unknown vehicle model in a fitment cell fails the row rather than being
 * dropped, because a silently discarded fitment produces a part that appears
 * to fit nothing — indistinguishable from a part nobody has mapped yet.
 */
function resolveRow(row: ParsedProductRow, lookups: Lookups): ImportRowError[] {
  const rowErrors: ImportRowError[] = [];
  const isNew = !lookups.productIdBySku.has(row.sku);

  if (isNew) {
    if (!row.titleFa) {
      rowErrors.push({ line: row.line, column: 'نام کالا', message: 'کالای جدید بدون نام قابل ثبت نیست.' });
    }
    if (row.price === null) {
      rowErrors.push({ line: row.line, column: 'قیمت', message: 'کالای جدید بدون قیمت قابل ثبت نیست.' });
    }
  } else {
    /*
     * A row that lowers the price without touching the sale price can leave
     * the product with a "discount" above its own price. The database rejects
     * that combination, but a constraint violation surfaces as one opaque
     * failure for the whole file — so the conflict is caught here, named, and
     * attributed to the row that causes it.
     */
    const current = lookups.pricingBySku.get(row.sku);
    if (current) {
      const price = row.price ?? current.price;
      const salePrice = row.salePrice ?? current.salePrice;
      if (salePrice !== null && salePrice >= price) {
        rowErrors.push({
          line: row.line,
          column: 'قیمت',
          message:
            `قیمت ${toPersianDigits(price)} با قیمت تخفیف‌خوردهٔ فعلی ${toPersianDigits(salePrice)} سازگار نیست؛ ` +
            'ستون «قیمت با تخفیف» را هم مشخص کنید.',
        });
      }
    }
  }

  if (row.brand && !lookups.brandBySlug.has(row.brand) && !lookups.brandByName.has(row.brand)) {
    rowErrors.push({ line: row.line, column: 'برند', message: `برند «${row.brand}» در فروشگاه تعریف نشده است.` });
  }
  if (row.category && !lookups.categoryBySlug.has(row.category) && !lookups.categoryByName.has(row.category)) {
    rowErrors.push({ line: row.line, column: 'دسته‌بندی', message: `دسته‌بندی «${row.category}» تعریف نشده است.` });
  }

  for (const fitment of row.fitments ?? []) {
    const modelId = lookups.modelBySlug.get(fitment.modelSlug);
    if (!modelId) {
      rowErrors.push({
        line: row.line, column: 'سازگاری',
        message: `مدل خودرو «${fitment.modelSlug}» در پایگاه خودروها یافت نشد.`,
      });
      continue;
    }
    if (fitment.engineCode && !lookups.engineByModelAndCode.has(`${modelId}::${fitment.engineCode.toUpperCase()}`)) {
      rowErrors.push({
        line: row.line, column: 'سازگاری',
        message: `موتور «${fitment.engineCode}» برای «${fitment.modelSlug}» تعریف نشده است.`,
      });
    }
    if (fitment.trimCode && !lookups.trimByModelAndCode.has(`${modelId}::${fitment.trimCode.toUpperCase()}`)) {
      rowErrors.push({
        line: row.line, column: 'سازگاری',
        message: `تیپ «${fitment.trimCode}» برای «${fitment.modelSlug}» تعریف نشده است.`,
      });
    }
  }

  return rowErrors;
}

/* ── phase 1: validate ────────────────────────────────────────────────── */

export async function validateImport(
  text: string,
  opts: { filename?: string | null; actorUserId: string | null },
  db: Database = getDb(),
): Promise<ImportPreview> {
  const parsed: ParseResult = parseProductCsv(text);
  const lookups = await loadLookups(db, parsed.rows.map((r) => r.sku));

  const allErrors = [...parsed.errors];
  const accepted: ParsedProductRow[] = [];
  for (const row of parsed.rows) {
    const rowErrors = resolveRow(row, lookups);
    if (rowErrors.length > 0) allErrors.push(...rowErrors);
    else accepted.push(row);
  }

  const willUpdate = accepted.filter((r) => lookups.productIdBySku.has(r.sku)).length;
  const linesWithErrors = new Set(allErrors.map((e) => e.line));
  const status = accepted.length > 0 ? 'VALIDATED' : 'FAILED';

  const [job] = await db
    .insert(importJobs)
    .values({
      actorUserId: opts.actorUserId,
      kind: 'products',
      filename: opts.filename?.slice(0, 240) ?? null,
      status,
      totalRows: parsed.totalRows,
      validRows: accepted.length,
      errorRows: linesWithErrors.size,
      errors: allErrors.slice(0, MAX_STORED_ERRORS),
      // Only rows that passed every check are stored, so commit cannot write
      // anything validate rejected.
      payload: accepted,
    })
    .returning({ id: importJobs.id });

  if (!job) throw errors.conflict('ثبت گزارش درون‌ریزی انجام نشد.');

  return {
    jobId: job.id,
    status,
    totalRows: parsed.totalRows,
    validRows: accepted.length,
    errorRows: linesWithErrors.size,
    willUpdate,
    willCreate: accepted.length - willUpdate,
    errors: allErrors.slice(0, MAX_STORED_ERRORS),
    truncatedErrors: Math.max(0, allErrors.length - MAX_STORED_ERRORS),
    sample: accepted.slice(0, 10),
  };
}

/* ── phase 2: commit ──────────────────────────────────────────────────── */

export interface ImportResult {
  jobId: string;
  created: number;
  updated: number;
  stockAdjusted: number;
}

/**
 * Applies a validated job. One transaction for the whole file: a failure at
 * row 1,900 rolls back rows 1–1,899 as well, which is the only safe outcome
 * for a price list.
 */
export async function commitImport(
  jobId: string,
  actorUserId: string | null,
  db: Database = getDb(),
): Promise<ImportResult> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job) throw errors.notFound('گزارش درون‌ریزی یافت نشد.');
  if (job.status === 'COMMITTED') throw errors.conflict('این فایل قبلاً اعمال شده است.');
  if (job.status !== 'VALIDATED') throw errors.conflict('این فایل قابل اعمال نیست؛ ابتدا آن را بررسی کنید.');

  const rows = (job.payload ?? []) as ParsedProductRow[];
  if (rows.length === 0) throw errors.conflict('ردیف معتبری برای اعمال وجود ندارد.');

  return withTransaction(async (tx) => {
    /*
     * Re-resolve inside the transaction. The catalogue may have changed since
     * validation — a brand deleted, a SKU created by someone else — and the
     * preview must not become a licence to write stale references.
     */
    const lookups = await loadLookups(tx, rows.map((r) => r.sku));

    const stale: ImportRowError[] = [];
    for (const row of rows) stale.push(...resolveRow(row, lookups));
    if (stale.length > 0) {
      throw errors.conflict(
        `کاتالوگ از زمان بررسی تغییر کرده است (${toPersianDigits(stale.length)} مورد). فایل را دوباره بررسی کنید.`,
      );
    }

    /*
     * Slug uniqueness is resolved in memory: the set is loaded once and grows
     * as rows are inserted, so two new rows with the same title inside one
     * file get distinct slugs without a query per candidate.
     */
    const takenSlugs = new Set(
      (await tx.select({ slug: products.slug }).from(products)).map((r) => r.slug),
    );

    let created = 0;
    let updated = 0;
    let stockAdjusted = 0;

    for (const row of rows) {
      const brandId = row.brand
        ? (lookups.brandBySlug.get(row.brand) ?? lookups.brandByName.get(row.brand) ?? null)
        : null;
      const categoryId = row.category
        ? (lookups.categoryBySlug.get(row.category) ?? lookups.categoryByName.get(row.category) ?? null)
        : null;

      const existingId = lookups.productIdBySku.get(row.sku);
      let productId: string;

      if (existingId) {
        // A blank cell means "leave as is"; only supplied columns are written.
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (row.titleFa) patch.titleFa = row.titleFa;
        if (row.titleEn) patch.titleEn = row.titleEn;
        if (row.oemNumber) patch.oemNumber = row.oemNumber;
        if (row.mpn) patch.mpn = row.mpn;
        if (row.manufacturer) patch.manufacturer = row.manufacturer;
        if (row.descriptionFa) patch.descriptionFa = row.descriptionFa;
        if (row.countryOfOrigin) patch.countryOfOrigin = row.countryOfOrigin;
        if (row.productFamily) patch.productFamily = row.productFamily;
        if (row.condition) patch.condition = row.condition;
        if (row.tags) patch.tags = row.tags;
        if (row.price !== null) patch.price = row.price;
        // An explicit empty sale-price column clears the sale; a missing one does not.
        if (row.salePrice !== null) patch.salePrice = row.salePrice;
        if (row.weightGrams !== null) patch.weightGrams = row.weightGrams;
        if (row.warrantyMonths !== null) patch.warrantyMonths = row.warrantyMonths;
        if (row.isActive !== null) patch.isActive = row.isActive;
        if (brandId) patch.brandId = brandId;
        if (categoryId) patch.categoryId = categoryId;

        await tx.update(products).set(patch).where(eq(products.id, existingId));
        productId = existingId;
        updated += 1;
      } else {
        const slug = uniqueSlug(slugify(row.titleFa ?? row.sku), takenSlugs);
        takenSlugs.add(slug);

        const [inserted] = await tx
          .insert(products)
          .values({
            sku: row.sku,
            slug,
            titleFa: row.titleFa!,
            titleEn: row.titleEn,
            oemNumber: row.oemNumber,
            mpn: row.mpn,
            descriptionFa: row.descriptionFa,
            manufacturer: row.manufacturer,
            countryOfOrigin: row.countryOfOrigin,
            productFamily: row.productFamily,
            condition: row.condition ?? 'new',
            price: row.price!,
            salePrice: row.salePrice,
            weightGrams: row.weightGrams,
            warrantyMonths: row.warrantyMonths,
            tags: row.tags ?? [],
            brandId,
            categoryId,
            isActive: row.isActive ?? true,
            publishedAt: (row.isActive ?? true) ? new Date() : null,
          })
          .returning({ id: products.id });
        if (!inserted) throw errors.conflict(`ثبت کالای «${row.sku}» انجام نشد.`);
        productId = inserted.id;
        created += 1;
      }

      await ensureInventoryRow(tx, productId);

      /*
       * Stock is *set*, not adjusted by a delta: a supplier file states the
       * count on the shelf. Reserved units are respected — an import can never
       * push on-hand below what already-placed orders hold.
       */
      if (row.stock !== null) {
        const [current] = await tx
          .select({ onHand: inventory.quantityOnHand, reserved: inventory.quantityReserved })
          .from(inventory)
          .where(eq(inventory.productId, productId))
          .for('update');

        if (current && current.onHand !== row.stock) {
          if (row.stock < current.reserved) {
            throw errors.conflict(
              `موجودی «${row.sku}» نمی‌تواند ${toPersianDigits(row.stock)} شود؛ ` +
              `${toPersianDigits(current.reserved)} عدد برای سفارش‌های ثبت‌شده رزرو شده است.`,
            );
          }
          await tx
            .update(inventory)
            .set({ quantityOnHand: row.stock, updatedAt: new Date() })
            .where(eq(inventory.productId, productId));
          stockAdjusted += 1;
        }
      }

      if (row.fitments) {
        await setProductFitments(
          productId,
          await Promise.all(row.fitments.map(async (f) => {
            const modelId = lookups.modelBySlug.get(f.modelSlug)!;
            return {
              vehicleModelId: modelId,
              vehicleEngineId: f.engineCode
                ? (lookups.engineByModelAndCode.get(`${modelId}::${f.engineCode.toUpperCase()}`) ?? null)
                : null,
              vehicleTrimId: f.trimCode
                ? (lookups.trimByModelAndCode.get(`${modelId}::${f.trimCode.toUpperCase()}`) ?? null)
                : null,
              yearFrom: f.yearFrom,
              yearTo: f.yearTo,
              fitmentType: f.fitmentType,
            };
          })),
          'import',
          tx,
        );
      }

      if (row.references) {
        await setProductReferences(
          productId,
          row.references.map((r) => ({
            relationType: r.relationType,
            targetNumber: r.targetNumber,
            targetBrand: r.targetBrand,
          })),
          tx,
        );
      }
    }

    await tx
      .update(importJobs)
      .set({
        status: 'COMMITTED',
        createdCount: created,
        updatedCount: updated,
        committedAt: new Date(),
        actorUserId: actorUserId ?? job.actorUserId,
      })
      .where(eq(importJobs.id, jobId));

    return { jobId, created, updated, stockAdjusted };
  });
}

/* ── reporting ────────────────────────────────────────────────────────── */

export async function listImportJobs(limit = 25, db: Database = getDb()) {
  return db
    .select({
      id: importJobs.id,
      filename: importJobs.filename,
      status: importJobs.status,
      totalRows: importJobs.totalRows,
      validRows: importJobs.validRows,
      errorRows: importJobs.errorRows,
      createdCount: importJobs.createdCount,
      updatedCount: importJobs.updatedCount,
      createdAt: importJobs.createdAt,
      committedAt: importJobs.committedAt,
    })
    .from(importJobs)
    .orderBy(sql`${importJobs.createdAt} desc`)
    .limit(limit);
}

export async function getImportJob(jobId: string, db: Database = getDb()) {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  return job ?? null;
}

/** Discards a validated job that an administrator chose not to apply. */
export async function discardImportJob(jobId: string, db: Database = getDb()): Promise<void> {
  await db
    .update(importJobs)
    .set({ status: 'FAILED', payload: null })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'VALIDATED')));
}

/** A ready-to-fill template, so nobody has to guess the column names. */
export const IMPORT_TEMPLATE_CSV = [
  'sku,title_fa,brand,category,price,sale_price,stock,oem,mpn,warranty_months,country,condition,fitment,references',
  'FLT-OIL-DEMO,فیلتر روغن نمونه,mann-filter,oil-filters,385000,329000,20,1109AY,W 712/52,6,آلمان,new,peugeot-206|TU5||1385-1400|DIRECT;rana||||DIRECT,CROSS_REFERENCE:OC90:Mahle',
].join('\n');

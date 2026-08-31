/**
 * Administration of the vehicle taxonomy.
 *
 * This exists because bulk import deliberately refuses to create vehicles: an
 * unknown model in a supplier file is an error, not an invitation to invent a
 * car. Somebody therefore has to be able to add one, and that somebody is an
 * administrator working from a real specification.
 *
 * Deletion is the interesting operation. A model with recorded fitments is not
 * a row to be removed — deleting it would cascade away compatibility data and
 * silently turn "fits your car" into "we have no idea". So deletion is refused
 * whenever fitments or saved customer vehicles depend on the row, and
 * deactivation is offered instead.
 */
import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import {
  customerVehicles, productFitments, vehicleBrands, vehicleConfigurations,
  vehicleEngines, vehicleGenerations, vehicleModels, vehicleTrims,
} from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { slugify, uniqueSlug } from '@/lib/slug';
import { toPersianDigits } from '@/lib/fa';

/* ── reads ────────────────────────────────────────────────────────────── */

export interface AdminVehicleModel {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  isActive: boolean;
  generationCount: number;
  trimCount: number;
  engineCount: number;
  fitmentCount: number;
}

export interface AdminVehicleBrand {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  models: AdminVehicleModel[];
}

/**
 * The whole taxonomy with usage counts, in two queries.
 *
 * The counts are what make the page safe to act on: an administrator can see
 * that a model carries 42 fitments before considering removing it.
 */
export async function listVehicleTaxonomy(db: Database = getDb()): Promise<AdminVehicleBrand[]> {
  const brands = await db
    .select()
    .from(vehicleBrands)
    .orderBy(asc(vehicleBrands.sortOrder), asc(vehicleBrands.nameFa));

  const models = await db.execute<{
    id: string; brand_id: string; slug: string; name_fa: string; name_en: string | null;
    year_from: number | null; year_to: number | null; is_active: boolean;
    generation_count: number; trim_count: number; engine_count: number; fitment_count: number;
  }>(sql`
    select
      vm.id, vm.vehicle_brand_id as brand_id, vm.slug, vm.name_fa, vm.name_en,
      vm.year_from, vm.year_to, vm.is_active,
      (select count(*)::int from vehicle_generations g where g.vehicle_model_id = vm.id) as generation_count,
      (select count(*)::int from vehicle_trims t       where t.vehicle_model_id = vm.id) as trim_count,
      (select count(*)::int from vehicle_engines e     where e.vehicle_model_id = vm.id) as engine_count,
      (select count(*)::int
         from product_fitments pf
         join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
        where vc.vehicle_model_id = vm.id) as fitment_count
    from vehicle_models vm
    order by vm.name_fa
  `);

  const byBrand = new Map<string, AdminVehicleModel[]>();
  for (const m of models.rows) {
    const list = byBrand.get(m.brand_id) ?? [];
    list.push({
      id: m.id, slug: m.slug, nameFa: m.name_fa, nameEn: m.name_en,
      yearFrom: m.year_from, yearTo: m.year_to, isActive: m.is_active,
      generationCount: Number(m.generation_count),
      trimCount: Number(m.trim_count),
      engineCount: Number(m.engine_count),
      fitmentCount: Number(m.fitment_count),
    });
    byBrand.set(m.brand_id, list);
  }

  return brands.map((b) => ({
    id: b.id, slug: b.slug, nameFa: b.nameFa, nameEn: b.nameEn,
    sortOrder: b.sortOrder, isActive: b.isActive,
    models: byBrand.get(b.id) ?? [],
  }));
}

export async function getModelDetail(modelId: string, db: Database = getDb()) {
  const [model] = await db.select().from(vehicleModels).where(eq(vehicleModels.id, modelId)).limit(1);
  if (!model) throw errors.notFound('مدل خودرو یافت نشد.');

  const [generations, trims, engines] = await Promise.all([
    db.select().from(vehicleGenerations)
      .where(eq(vehicleGenerations.vehicleModelId, modelId))
      .orderBy(asc(vehicleGenerations.yearFrom)),
    db.select().from(vehicleTrims)
      .where(eq(vehicleTrims.vehicleModelId, modelId))
      .orderBy(asc(vehicleTrims.nameFa)),
    db.select().from(vehicleEngines)
      .where(eq(vehicleEngines.vehicleModelId, modelId))
      .orderBy(asc(vehicleEngines.code)),
  ]);
  return { model, generations, trims, engines };
}

/* ── writes ───────────────────────────────────────────────────────────── */

async function slugFor(base: string, table: 'brand' | 'model', db: Database): Promise<string> {
  const rows = table === 'brand'
    ? await db.select({ slug: vehicleBrands.slug }).from(vehicleBrands)
    : await db.select({ slug: vehicleModels.slug }).from(vehicleModels);
  return uniqueSlug(slugify(base), new Set(rows.map((r) => r.slug)));
}

export interface BrandInput {
  nameFa: string;
  nameEn?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export async function upsertVehicleBrand(
  input: BrandInput & { id?: string },
  db: Database = getDb(),
): Promise<{ id: string }> {
  if (input.id) {
    const [row] = await db
      .update(vehicleBrands)
      .set({
        nameFa: input.nameFa,
        nameEn: input.nameEn ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      })
      .where(eq(vehicleBrands.id, input.id))
      .returning({ id: vehicleBrands.id });
    if (!row) throw errors.notFound('برند خودرو یافت نشد.');
    return row;
  }

  const [row] = await db
    .insert(vehicleBrands)
    .values({
      slug: await slugFor(input.nameEn || input.nameFa, 'brand', db),
      nameFa: input.nameFa,
      nameEn: input.nameEn ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    })
    .returning({ id: vehicleBrands.id });
  if (!row) throw errors.conflict('ثبت برند خودرو انجام نشد.');
  return row;
}

export interface ModelInput {
  vehicleBrandId: string;
  nameFa: string;
  nameEn?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  isActive?: boolean;
}

function assertYearWindow(from: number | null | undefined, to: number | null | undefined): void {
  if (from != null && to != null && from > to) {
    throw errors.validation('سال شروع نمی‌تواند بزرگ‌تر از سال پایان باشد.');
  }
}

export async function upsertVehicleModel(
  input: ModelInput & { id?: string },
  db: Database = getDb(),
): Promise<{ id: string }> {
  assertYearWindow(input.yearFrom, input.yearTo);

  const [brand] = await db
    .select({ id: vehicleBrands.id })
    .from(vehicleBrands)
    .where(eq(vehicleBrands.id, input.vehicleBrandId))
    .limit(1);
  if (!brand) throw errors.validation('برند خودرو یافت نشد.');

  const values = {
    vehicleBrandId: input.vehicleBrandId,
    nameFa: input.nameFa,
    nameEn: input.nameEn ?? null,
    yearFrom: input.yearFrom ?? null,
    yearTo: input.yearTo ?? null,
    isActive: input.isActive ?? true,
  };

  if (input.id) {
    const [row] = await db
      .update(vehicleModels).set(values).where(eq(vehicleModels.id, input.id))
      .returning({ id: vehicleModels.id });
    if (!row) throw errors.notFound('مدل خودرو یافت نشد.');
    return row;
  }

  const [row] = await db
    .insert(vehicleModels)
    .values({ ...values, slug: await slugFor(input.nameEn || input.nameFa, 'model', db) })
    .returning({ id: vehicleModels.id });
  if (!row) throw errors.conflict('ثبت مدل خودرو انجام نشد.');
  return row;
}

export interface ChildInput {
  vehicleModelId: string;
  code: string;
  nameFa: string;
  isActive?: boolean;
  /** Generations only. */
  yearFrom?: number | null;
  yearTo?: number | null;
  /** Engines only. */
  displacementCc?: number | null;
  fuelType?: string | null;
  /** Trims only. */
  vehicleGenerationId?: string | null;
}

export type ChildKind = 'generation' | 'trim' | 'engine';

/**
 * Adds or edits a generation, trim or engine.
 *
 * The `code` is a technical identifier (`TU5`, `TIP5`) that customers see and
 * suppliers write in import files, so it is stored verbatim rather than
 * slugified — normalising it would break the match against a supplier's sheet.
 */
export async function upsertVehicleChild(
  kind: ChildKind,
  input: ChildInput & { id?: string },
  db: Database = getDb(),
): Promise<{ id: string }> {
  const [model] = await db
    .select({ id: vehicleModels.id })
    .from(vehicleModels)
    .where(eq(vehicleModels.id, input.vehicleModelId))
    .limit(1);
  if (!model) throw errors.validation('مدل خودرو یافت نشد.');

  const code = input.code.trim();
  if (!code) throw errors.validation('کد فنی نمی‌تواند خالی باشد.');

  if (kind === 'generation') {
    assertYearWindow(input.yearFrom, input.yearTo);
    const values = {
      vehicleModelId: input.vehicleModelId,
      code,
      nameFa: input.nameFa,
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
      isActive: input.isActive ?? true,
    };
    const [row] = input.id
      ? await db.update(vehicleGenerations).set(values)
          .where(eq(vehicleGenerations.id, input.id)).returning({ id: vehicleGenerations.id })
      : await db.insert(vehicleGenerations).values(values).returning({ id: vehicleGenerations.id });
    if (!row) throw errors.notFound('نسل خودرو یافت نشد.');
    return row;
  }

  if (kind === 'trim') {
    // A generation, when given, must belong to the same model.
    if (input.vehicleGenerationId) {
      const [generation] = await db
        .select({ id: vehicleGenerations.id })
        .from(vehicleGenerations)
        .where(and(
          eq(vehicleGenerations.id, input.vehicleGenerationId),
          eq(vehicleGenerations.vehicleModelId, input.vehicleModelId),
        ))
        .limit(1);
      if (!generation) throw errors.validation('نسل انتخاب‌شده به این مدل تعلق ندارد.');
    }
    const values = {
      vehicleModelId: input.vehicleModelId,
      vehicleGenerationId: input.vehicleGenerationId ?? null,
      code,
      nameFa: input.nameFa,
      isActive: input.isActive ?? true,
    };
    const [row] = input.id
      ? await db.update(vehicleTrims).set(values)
          .where(eq(vehicleTrims.id, input.id)).returning({ id: vehicleTrims.id })
      : await db.insert(vehicleTrims).values(values).returning({ id: vehicleTrims.id });
    if (!row) throw errors.notFound('تیپ خودرو یافت نشد.');
    return row;
  }

  const values = {
    vehicleModelId: input.vehicleModelId,
    code,
    nameFa: input.nameFa,
    displacementCc: input.displacementCc ?? null,
    fuelType: input.fuelType ?? null,
    isActive: input.isActive ?? true,
  };
  const [row] = input.id
    ? await db.update(vehicleEngines).set(values)
        .where(eq(vehicleEngines.id, input.id)).returning({ id: vehicleEngines.id })
    : await db.insert(vehicleEngines).values(values).returning({ id: vehicleEngines.id });
  if (!row) throw errors.notFound('موتور خودرو یافت نشد.');
  return row;
}

/* ── deletion ─────────────────────────────────────────────────────────── */

/**
 * Deletes a taxonomy row only when nothing depends on it.
 *
 * The schema cascades from `vehicle_models` down through configurations to
 * fitments, so a plain DELETE would quietly destroy compatibility data — and a
 * product that used to say «سازگار» would start saying «اطلاعات کافی نیست»
 * with nobody having decided that. Counting the dependants first and refusing
 * turns a silent data loss into a decision.
 */
export async function deleteVehicleEntity(
  kind: 'brand' | 'model' | ChildKind,
  id: string,
  db: Database = getDb(),
): Promise<void> {
  const usage = await countDependants(kind, id, db);
  if (usage.fitments > 0 || usage.savedVehicles > 0) {
    const parts: string[] = [];
    if (usage.fitments > 0) parts.push(`${toPersianDigits(usage.fitments)} رکورد سازگاری`);
    if (usage.savedVehicles > 0) parts.push(`${toPersianDigits(usage.savedVehicles)} خودروی ذخیره‌شدهٔ مشتری`);
    throw errors.conflict(
      `حذف ممکن نیست: ${parts.join(' و ')} به این مورد وابسته است. ` +
      'به‌جای حذف، آن را غیرفعال کنید تا داده‌های سازگاری حفظ شود.',
    );
  }

  switch (kind) {
    case 'brand': await db.delete(vehicleBrands).where(eq(vehicleBrands.id, id)); return;
    case 'model': await db.delete(vehicleModels).where(eq(vehicleModels.id, id)); return;
    case 'generation': await db.delete(vehicleGenerations).where(eq(vehicleGenerations.id, id)); return;
    case 'trim': await db.delete(vehicleTrims).where(eq(vehicleTrims.id, id)); return;
    case 'engine': await db.delete(vehicleEngines).where(eq(vehicleEngines.id, id)); return;
  }
}

/** Fitments and saved customer vehicles that would disappear with this row. */
export async function countDependants(
  kind: 'brand' | 'model' | ChildKind,
  id: string,
  db: Database = getDb(),
): Promise<{ fitments: number; savedVehicles: number }> {
  /*
   * Column references are qualified with the real table name, not an alias:
   * Drizzle's joins emit `"vehicle_configurations"`, so a hand-written `vc.`
   * prefix inside a raw fragment resolves against nothing.
   */
  const configurationFilter = {
    brand: sql`${vehicleConfigurations.vehicleModelId} in (select id from vehicle_models where vehicle_brand_id = ${id})`,
    model: sql`${vehicleConfigurations.vehicleModelId} = ${id}`,
    generation: sql`${vehicleConfigurations.vehicleGenerationId} = ${id}`,
    trim: sql`${vehicleConfigurations.vehicleTrimId} = ${id}`,
    engine: sql`${vehicleConfigurations.vehicleEngineId} = ${id}`,
  }[kind];

  const [fitments, saved] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(productFitments)
      .innerJoin(vehicleConfigurations, eq(vehicleConfigurations.id, productFitments.vehicleConfigurationId))
      .where(sql`${configurationFilter}`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(customerVehicles)
      .innerJoin(vehicleConfigurations, eq(vehicleConfigurations.id, customerVehicles.vehicleConfigurationId))
      .where(sql`${configurationFilter}`),
  ]);

  return { fitments: fitments[0]?.n ?? 0, savedVehicles: saved[0]?.n ?? 0 };
}

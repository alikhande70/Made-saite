/**
 * Admin write operations.
 *
 * Authorization is *not* handled here — it belongs at the boundary
 * (`requireAdmin` in every admin page and route). These functions assume the
 * caller has already proved it is an administrator.
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import {
  brands, categories, inventory, productImages, productSpecs,
  productReferences, products, users,
} from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { ensureInventoryRow } from './inventory-service';
import {
  listFitmentsForProduct, setProductFitments, setProductReferences,
  type FitmentInput, type ReferenceInput,
} from './fitment-service';
import { slugify, uniqueSlug } from '@/lib/slug';

/* ── products ─────────────────────────────────────────────────────────── */

export interface ProductInput {
  sku: string;
  oemNumber?: string | null;
  mpn?: string | null;
  slug?: string | null;
  titleFa: string;
  titleEn?: string | null;
  descriptionFa?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  manufacturer?: string | null;
  price: number;
  salePrice?: number | null;
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  warrantyMonths?: number | null;
  countryOfOrigin?: string | null;
  condition?: 'new' | 'refurbished' | 'used';
  installationNotes?: string | null;
  productFamily?: string | null;
  allowBackorder?: boolean;
  tags?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  isActive: boolean;
  images?: { url: string; alt?: string | null }[];
  specs?: { specKey: string; specValue: string; unit?: string | null }[];
  fitments?: FitmentInput[];
  references?: ReferenceInput[];
  /** Only honoured on create; afterwards stock moves through the inventory service. */
  initialStock?: number;
}

function validatePricing(input: Pick<ProductInput, 'price' | 'salePrice'>): void {
  if (!Number.isInteger(input.price) || input.price < 0) {
    throw errors.validation('قیمت باید عددی صحیح و نامنفی (تومان) باشد.');
  }
  if (input.salePrice !== null && input.salePrice !== undefined) {
    if (!Number.isInteger(input.salePrice) || input.salePrice < 0) {
      throw errors.validation('قیمت فروش ویژه باید عددی صحیح و نامنفی باشد.');
    }
    if (input.salePrice >= input.price) {
      throw errors.validation('قیمت فروش ویژه باید کمتر از قیمت اصلی باشد.');
    }
  }
}

async function resolveSlug(input: ProductInput, currentId: string | null, tx: Database): Promise<string> {
  const desired = input.slug?.trim() ? slugify(input.slug) : slugify(input.titleFa);
  const rows = await tx.select({ slug: products.slug, id: products.id }).from(products);
  const taken = new Set(rows.filter((r) => r.id !== currentId).map((r) => r.slug));
  return uniqueSlug(desired, taken);
}

async function writeChildren(tx: Database, productId: string, input: ProductInput): Promise<void> {
  if (input.images) {
    await tx.delete(productImages).where(eq(productImages.productId, productId));
    if (input.images.length > 0) {
      await tx.insert(productImages).values(
        input.images.map((image, i) => ({
          productId, url: image.url, alt: image.alt ?? input.titleFa,
          sortOrder: i, isPrimary: i === 0,
        })),
      );
    }
  }

  if (input.specs) {
    await tx.delete(productSpecs).where(eq(productSpecs.productId, productId));
    if (input.specs.length > 0) {
      await tx.insert(productSpecs).values(
        input.specs.map((spec, i) => ({
          productId, specKey: spec.specKey, specValue: spec.specValue,
          unit: spec.unit ?? null, sortOrder: i,
        })),
      );
    }
  }

  if (input.fitments) {
    await setProductFitments(productId, input.fitments, 'manual', tx);
  }

  if (input.references) {
    await setProductReferences(productId, input.references, tx);
  }
}

function toRow(input: ProductInput, slug: string) {
  return {
    sku: input.sku.trim(),
    oemNumber: input.oemNumber?.trim() || null,
    mpn: input.mpn?.trim() || null,
    slug,
    titleFa: input.titleFa.trim(),
    titleEn: input.titleEn?.trim() || null,
    descriptionFa: input.descriptionFa?.trim() || null,
    categoryId: input.categoryId || null,
    brandId: input.brandId || null,
    manufacturer: input.manufacturer?.trim() || null,
    price: input.price,
    salePrice: input.salePrice ?? null,
    weightGrams: input.weightGrams ?? null,
    lengthMm: input.lengthMm ?? null,
    widthMm: input.widthMm ?? null,
    heightMm: input.heightMm ?? null,
    warrantyMonths: input.warrantyMonths ?? null,
    countryOfOrigin: input.countryOfOrigin?.trim() || null,
    condition: input.condition ?? 'new',
    installationNotes: input.installationNotes?.trim() || null,
    productFamily: input.productFamily?.trim() || null,
    allowBackorder: input.allowBackorder ?? false,
    tags: input.tags ?? [],
    seoTitle: input.seoTitle?.trim() || null,
    seoDescription: input.seoDescription?.trim() || null,
    isActive: input.isActive,
  };
}

function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      if ((current as { code?: string }).code === '23505') return true;
      current = (current as { cause?: unknown }).cause;
    } else return false;
  }
  return false;
}

export async function createProduct(input: ProductInput, actorUserId: string): Promise<{ id: string; slug: string }> {
  validatePricing(input);

  return withTransaction(async (tx) => {
    const slug = await resolveSlug(input, null, tx);
    let row;
    try {
      [row] = await tx
        .insert(products)
        .values({ ...toRow(input, slug), publishedAt: input.isActive ? new Date() : null })
        .returning({ id: products.id, slug: products.slug });
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.conflict('کالایی با این کد (SKU) از قبل ثبت شده است.');
      throw e;
    }
    if (!row) throw errors.conflict('ثبت کالا انجام نشد.');

    await writeChildren(tx, row.id, input);
    await ensureInventoryRow(tx, row.id);

    if (input.initialStock && input.initialStock > 0) {
      const { adjustStock } = await import('./inventory-service');
      await adjustStock(tx, {
        productId: row.id,
        delta: input.initialStock,
        type: 'RECEIVE',
        reason: 'موجودی اولیه هنگام ایجاد کالا',
        actorUserId,
      });
    }

    return row;
  });
}

export async function updateProduct(
  productId: string,
  input: ProductInput,
): Promise<{ id: string; slug: string }> {
  validatePricing(input);

  return withTransaction(async (tx) => {
    const [existing] = await tx
      .select({ id: products.id, publishedAt: products.publishedAt, slug: products.slug })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!existing) throw errors.notFound('کالا یافت نشد.');

    const slug = input.slug?.trim() ? await resolveSlug(input, productId, tx) : existing.slug;

    let row;
    try {
      [row] = await tx
        .update(products)
        .set({
          ...toRow(input, slug),
          publishedAt: input.isActive ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ id: products.id, slug: products.slug });
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.conflict('کالای دیگری با این کد (SKU) وجود دارد.');
      throw e;
    }
    if (!row) throw errors.notFound('کالا یافت نشد.');

    await writeChildren(tx, productId, input);
    await ensureInventoryRow(tx, productId);
    return row;
  });
}

/** Products are deactivated, never deleted — order history must stay intact. */
export async function setProductActive(productId: string, isActive: boolean): Promise<void> {
  const updated = await getDb()
    .update(products)
    .set({ isActive, publishedAt: isActive ? sql`coalesce(${products.publishedAt}, now())` : products.publishedAt, updatedAt: new Date() })
    .where(eq(products.id, productId))
    .returning({ id: products.id });
  if (updated.length === 0) throw errors.notFound('کالا یافت نشد.');
}

export interface AdminProductFilter {
  q?: string | undefined;
  categoryId?: string | undefined;
  status?: 'active' | 'inactive' | undefined;
  lowStock?: boolean | undefined;
  page?: number;
  perPage?: number;
}

export async function listProductsAdmin(filter: AdminProductFilter = {}, db: Database = getDb()) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 20;

  const conditions = [sql`true`];
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    conditions.push(sql`(
      md_normalize_fa(p.title_fa) like '%' || md_normalize_fa(${q}) || '%'
      or md_normalize_fa(p.sku) like '%' || md_normalize_fa(${q}) || '%'
      or md_normalize_fa(coalesce(p.oem_number,'')) like '%' || md_normalize_fa(${q}) || '%'
    )`);
  }
  if (filter.categoryId) conditions.push(sql`p.category_id = ${filter.categoryId}`);
  if (filter.status === 'active') conditions.push(sql`p.is_active = true`);
  if (filter.status === 'inactive') conditions.push(sql`p.is_active = false`);
  if (filter.lowStock) {
    conditions.push(sql`coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0) <= coalesce(inv.low_stock_threshold,3)`);
  }
  const where = sql.join(conditions, sql` and `);

  const rows = await db.execute<{
    id: string; sku: string; title_fa: string; slug: string; price: string | number;
    sale_price: string | number | null; is_active: boolean; category_name: string | null;
    brand_name: string | null; on_hand: number; reserved: number; threshold: number;
    image_url: string | null; updated_at: Date;
  }>(sql`
    select p.id, p.sku, p.title_fa, p.slug, p.price, p.sale_price, p.is_active, p.updated_at,
      c.name_fa as category_name, b.name_fa as brand_name,
      coalesce(inv.quantity_on_hand,0) as on_hand,
      coalesce(inv.quantity_reserved,0) as reserved,
      coalesce(inv.low_stock_threshold,3) as threshold,
      (select pi.url from product_images pi where pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc limit 1) as image_url
    from products p
    left join categories c on c.id = p.category_id
    left join brands b on b.id = p.brand_id
    left join inventory inv on inv.product_id = p.id
    where ${where}
    order by p.updated_at desc
    limit ${perPage} offset ${(page - 1) * perPage}
  `);

  const countRows = await db.execute<{ total: number }>(sql`
    select count(*)::int as total
    from products p
    left join inventory inv on inv.product_id = p.id
    where ${where}
  `);

  const total = countRows.rows[0]?.total ?? 0;
  return {
    items: rows.rows.map((r) => ({
      id: r.id, sku: r.sku, titleFa: r.title_fa, slug: r.slug,
      price: Number(r.price), salePrice: r.sale_price === null ? null : Number(r.sale_price),
      isActive: r.is_active, categoryName: r.category_name, brandName: r.brand_name,
      quantityOnHand: r.on_hand, quantityReserved: r.reserved, lowStockThreshold: r.threshold,
      quantityAvailable: Math.max(0, r.on_hand - r.reserved),
      imageUrl: r.image_url, updatedAt: r.updated_at,
    })),
    total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/* ── categories ───────────────────────────────────────────────────────── */

export interface CategoryInput {
  nameFa: string;
  nameEn?: string | null;
  slug?: string | null;
  parentId?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function upsertCategory(input: CategoryInput & { id?: string }) {
  return withTransaction(async (tx) => {
    // A category may not be its own ancestor.
    if (input.id && input.parentId) {
      let cursor: string | null = input.parentId;
      for (let depth = 0; cursor && depth < 20; depth += 1) {
        if (cursor === input.id) throw errors.validation('یک دسته نمی‌تواند زیرمجموعهٔ خودش باشد.');
        const [parent]: { parentId: string | null }[] = await tx
          .select({ parentId: categories.parentId })
          .from(categories)
          .where(eq(categories.id, cursor))
          .limit(1);
        cursor = parent?.parentId ?? null;
      }
    }

    const existing = await tx.select({ slug: categories.slug, id: categories.id }).from(categories);
    const taken = new Set(existing.filter((r) => r.id !== input.id).map((r) => r.slug));
    const slug = uniqueSlug(input.slug?.trim() || input.nameFa, taken);

    const values = {
      nameFa: input.nameFa.trim(),
      nameEn: input.nameEn?.trim() || null,
      slug,
      parentId: input.parentId || null,
      description: input.description?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      icon: input.icon?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
    };

    if (input.id) {
      const [row] = await tx.update(categories)
        .set({ ...values, slug: input.slug?.trim() ? slug : undefined })
        .where(eq(categories.id, input.id)).returning();
      if (!row) throw errors.notFound('دسته یافت نشد.');
      return row;
    }
    const [row] = await tx.insert(categories).values(values).returning();
    return row!;
  });
}

export async function deleteCategory(id: string): Promise<void> {
  const [used] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.categoryId, id));
  if ((used?.n ?? 0) > 0) {
    throw errors.conflict('این دسته دارای کالا است و قابل حذف نیست. ابتدا کالاها را جابه‌جا کنید.');
  }
  await getDb().delete(categories).where(eq(categories.id, id));
}

export async function listCategoriesAdmin(db: Database = getDb()) {
  return db
    .select({
      id: categories.id, slug: categories.slug, nameFa: categories.nameFa, nameEn: categories.nameEn,
      parentId: categories.parentId, isActive: categories.isActive, sortOrder: categories.sortOrder,
      imageUrl: categories.imageUrl, description: categories.description,
      productCount: sql<number>`(select count(*)::int from products p where p.category_id = ${categories.id})`,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.nameFa));
}

/* ── brands ───────────────────────────────────────────────────────────── */

export interface BrandInput {
  nameFa: string;
  nameEn?: string | null;
  slug?: string | null;
  country?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  isActive: boolean;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export async function upsertBrand(input: BrandInput & { id?: string }) {
  return withTransaction(async (tx) => {
    const existing = await tx.select({ slug: brands.slug, id: brands.id }).from(brands);
    const taken = new Set(existing.filter((r) => r.id !== input.id).map((r) => r.slug));
    const slug = uniqueSlug(input.slug?.trim() || input.nameFa, taken);

    const values = {
      nameFa: input.nameFa.trim(),
      nameEn: input.nameEn?.trim() || null,
      slug,
      country: input.country?.trim() || null,
      logoUrl: input.logoUrl?.trim() || null,
      description: input.description?.trim() || null,
      isActive: input.isActive,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
    };

    if (input.id) {
      const [row] = await tx.update(brands)
        .set({ ...values, slug: input.slug?.trim() ? slug : undefined })
        .where(eq(brands.id, input.id)).returning();
      if (!row) throw errors.notFound('برند یافت نشد.');
      return row;
    }
    const [row] = await tx.insert(brands).values(values).returning();
    return row!;
  });
}

export async function deleteBrand(id: string): Promise<void> {
  const [used] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.brandId, id));
  if ((used?.n ?? 0) > 0) {
    throw errors.conflict('این برند دارای کالا است و قابل حذف نیست.');
  }
  await getDb().delete(brands).where(eq(brands.id, id));
}

export async function listBrandsAdmin(db: Database = getDb()) {
  return db
    .select({
      id: brands.id, slug: brands.slug, nameFa: brands.nameFa, nameEn: brands.nameEn,
      country: brands.country, isActive: brands.isActive, description: brands.description,
      productCount: sql<number>`(select count(*)::int from products p where p.brand_id = ${brands.id})`,
    })
    .from(brands)
    .orderBy(asc(brands.nameFa));
}

/* ── customers ────────────────────────────────────────────────────────── */

export async function listCustomers(
  filter: { q?: string | undefined; page?: number; perPage?: number } = {},
  db: Database = getDb(),
) {
  const page = filter.page ?? 1;
  const perPage = filter.perPage ?? 25;
  const q = filter.q?.trim();

  const where = q
    ? and(
        eq(users.role, 'customer'),
        or(ilike(users.fullName, `%${q}%`), ilike(users.phone, `%${q}%`), ilike(users.email, `%${q}%`)),
      )
    : eq(users.role, 'customer');

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      isActive: users.isActive,
      createdAt: users.createdAt,
      orderCount: sql<number>`(select count(*)::int from orders o where o.user_id = ${users.id})`,
      totalSpent: sql<number>`(
        select coalesce(sum(o.grand_total),0)::bigint
        from orders o
        where o.user_id = ${users.id} and o.status not in ('CANCELLED','PENDING_PAYMENT')
      )`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);

  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(where);
  const total = count?.n ?? 0;

  return {
    items: rows.map((r) => ({ ...r, totalSpent: Number(r.totalSpent) })),
    total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function setCustomerActive(userId: string, isActive: boolean): Promise<void> {
  const updated = await getDb()
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.role, 'customer')))
    .returning({ id: users.id });
  if (updated.length === 0) throw errors.notFound('مشتری یافت نشد.');
  if (!isActive) {
    const { revokeAllSessions } = await import('./auth-service');
    await revokeAllSessions(userId);
  }
}

/** Full product row plus children, for the admin edit form. */
export async function getProductForEdit(productId: string, db: Database = getDb()) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return null;

  const [images, specs, fitments, stock] = await Promise.all([
    db.select().from(productImages).where(eq(productImages.productId, productId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    db.select().from(productSpecs).where(eq(productSpecs.productId, productId)).orderBy(asc(productSpecs.sortOrder)),
    listFitmentsForProduct(productId, db),
    db.select().from(inventory).where(eq(inventory.productId, productId)).limit(1),
  ]);

  const references = await db
    .select()
    .from(productReferences)
    .where(eq(productReferences.productId, productId));

  return { product, images, specs, fitments, references, stock: stock[0] ?? null };
}

/** Order counts and revenue by day for the dashboard chart. */
export async function getSalesByDay(days = 14, db: Database = getDb()) {
  const rows = await db.execute<{ day: string; order_count: number; revenue: string }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      count(o.id)::int as order_count,
      coalesce(sum(o.grand_total) filter (where o.status not in ('CANCELLED','PENDING_PAYMENT')), 0)::bigint as revenue
    from generate_series(current_date - ${days - 1}::int, current_date, '1 day') as d(day)
    left join orders o on o.placed_at::date = d.day
    group by d.day
    order by d.day asc
  `);
  return rows.rows.map((r) => ({ day: r.day, orderCount: r.order_count, revenue: Number(r.revenue) }));
}

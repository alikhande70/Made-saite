/**
 * Catalog reads: listing, faceting, Persian search and product detail.
 *
 * Search strategy (v1, PostgreSQL-only — see docs/SEARCH.md for the migration
 * path to Meilisearch/OpenSearch):
 *   1. the query is normalised by `md_normalize_fa`, the same function that
 *      built the stored `search_doc`/`search_plain` columns, so Arabic vs
 *      Persian letter forms and Persian vs Latin digits all collapse together;
 *   2. matching is the union of full-text (`@@`), trigram similarity (`%`) and
 *      a plain substring test, which is what makes partial part numbers work;
 *   3. ranking blends ts_rank, trigram similarity and an exact SKU/OEM bonus.
 *
 * Every user value is bound as a parameter — no string concatenation reaches SQL.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import {
  brands,
  categories,
  productImages,
  productSpecs,
  productVehicleCompat,
  products,
  vehicleBrands,
  vehicleEngines,
  vehicleModels,
} from '@/infrastructure/db/schema';
import type { ProductQuery } from '@/lib/validation';
import { effectivePrice } from '@/domain/pricing';
import { stockStatus, type StockStatus } from '@/domain/inventory';

export interface ProductCard {
  id: string;
  slug: string;
  sku: string;
  oemNumber: string | null;
  titleFa: string;
  price: number;
  salePrice: number | null;
  effectivePrice: number;
  brandName: string | null;
  brandSlug: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  quantityAvailable: number;
  stockStatus: StockStatus;
  warrantyMonths: number | null;
}

export interface ProductListResult {
  items: ProductCard[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/* ── shared SQL fragments ─────────────────────────────────────────────── */

interface RawProductRow extends Record<string, unknown> {
  id: string;
  slug: string;
  sku: string;
  oem_number: string | null;
  title_fa: string;
  price: string | number;
  sale_price: string | number | null;
  warranty_months: number | null;
  brand_name: string | null;
  brand_slug: string | null;
  category_name: string | null;
  category_slug: string | null;
  image: { url: string; alt: string | null } | null;
  quantity_available: number;
  low_stock_threshold: number;
}

function toCard(r: RawProductRow): ProductCard {
  const price = Number(r.price);
  const salePrice = r.sale_price === null ? null : Number(r.sale_price);
  const available = Number(r.quantity_available);
  return {
    id: r.id,
    slug: r.slug,
    sku: r.sku,
    oemNumber: r.oem_number,
    titleFa: r.title_fa,
    price,
    salePrice,
    effectivePrice: effectivePrice({ price, salePrice }),
    brandName: r.brand_name,
    brandSlug: r.brand_slug,
    categoryName: r.category_name,
    categorySlug: r.category_slug,
    imageUrl: r.image?.url ?? null,
    imageAlt: r.image?.alt ?? null,
    quantityAvailable: available,
    stockStatus: stockStatus({
      quantityOnHand: available,
      quantityReserved: 0,
      lowStockThreshold: r.low_stock_threshold ?? 3,
    }),
    warrantyMonths: r.warranty_months,
  };
}

/** Category slug → that category and every descendant (recursive CTE). */
function categorySubtree(slug: string): SQL {
  return sql`(
    with recursive tree as (
      select id from categories where slug = ${slug}
      union all
      select c.id from categories c join tree t on c.parent_id = t.id
    )
    select id from tree
  )`;
}

/** Builds the list of WHERE conditions shared by search, listing and counting. */
function buildFilters(query: ProductQuery): SQL[] {
  const conditions: SQL[] = [sql`p.is_active = true`];

  if (query.category) {
    conditions.push(sql`p.category_id in ${categorySubtree(query.category)}`);
  }

  const brandSlugs = query.brand
    ? (Array.isArray(query.brand) ? query.brand : [query.brand]).filter(Boolean)
    : [];
  if (brandSlugs.length > 0) {
    // `sql.param` forces a single bound array parameter; a bare array would be
    // spliced into separate SQL chunks by the template tag.
    conditions.push(sql`b.slug = any(${sql.param(brandSlugs)}::text[])`);
  }

  if (query.manufacturer) {
    conditions.push(sql`md_normalize_fa(coalesce(p.manufacturer, '')) = md_normalize_fa(${query.manufacturer})`);
  }

  if (typeof query.minPrice === 'number') {
    conditions.push(sql`coalesce(p.sale_price, p.price) >= ${query.minPrice}`);
  }
  if (typeof query.maxPrice === 'number') {
    conditions.push(sql`coalesce(p.sale_price, p.price) <= ${query.maxPrice}`);
  }

  if (query.inStock) {
    conditions.push(sql`coalesce(inv.quantity_on_hand, 0) - coalesce(inv.quantity_reserved, 0) > 0`);
  }

  // Vehicle fitment: model (+ optional engine, + optional Jalali year window).
  if (query.vehicleModel) {
    const engineCond = query.vehicleEngine
      ? sql` and (pvc.vehicle_engine_id is null or pvc.vehicle_engine_id = (
            select ve.id from vehicle_engines ve
            join vehicle_models vm2 on vm2.id = ve.vehicle_model_id
            where vm2.slug = ${query.vehicleModel} and ve.code = ${query.vehicleEngine}
            limit 1))`
      : sql``;
    const yearCond =
      typeof query.vehicleYear === 'number'
        ? sql` and (pvc.year_from is null or pvc.year_from <= ${query.vehicleYear})
               and (pvc.year_to   is null or pvc.year_to   >= ${query.vehicleYear})`
        : sql``;

    conditions.push(sql`exists (
      select 1 from product_vehicle_compat pvc
      join vehicle_models vm on vm.id = pvc.vehicle_model_id
      where pvc.product_id = p.id and vm.slug = ${query.vehicleModel}${engineCond}${yearCond}
    )`);
  }

  return conditions;
}

/** Free-text match condition + a ranking expression, or null when no query. */
function buildSearch(term: string | undefined): { where: SQL; rank: SQL } | null {
  const raw = term?.trim();
  if (!raw) return null;

  const norm = sql`md_normalize_fa(${raw})`;
  const tsq = sql`websearch_to_tsquery('simple', ${norm})`;

  // `<%` is pg_trgm's *word* similarity: it scores the query against the best
  // matching run of words inside the document rather than against the whole
  // blob, which is what makes «فیلتر روغنن» still find «فیلتر روغن».
  const where = sql`(
    p.search_doc @@ ${tsq}
    or ${norm} <% p.search_plain
    or p.search_plain like '%' || ${norm} || '%'
    or md_normalize_fa(coalesce(b.name_fa, '')) like '%' || ${norm} || '%'
    or md_normalize_fa(coalesce(c.name_fa, '')) like '%' || ${norm} || '%'
  )`;

  // Exact part-number hits dominate, then an explicit brand/category name hit,
  // then full-text relevance, then fuzzy closeness.
  const rank = sql<number>`(
      case when md_normalize_fa(p.sku) = ${norm}
             or md_normalize_fa(coalesce(p.oem_number, '')) = ${norm}
             or md_normalize_fa(coalesce(p.mpn, '')) = ${norm}
           then 100 else 0 end
    + case when md_normalize_fa(coalesce(b.name_fa, '')) = ${norm}
             or md_normalize_fa(coalesce(c.name_fa, '')) = ${norm}
           then 40 else 0 end
    + case when md_normalize_fa(coalesce(b.name_fa, '')) like '%' || ${norm} || '%'
             or md_normalize_fa(coalesce(c.name_fa, '')) like '%' || ${norm} || '%'
           then 20 else 0 end
    + case when md_normalize_fa(p.title_fa) like '%' || ${norm} || '%' then 12 else 0 end
    + ts_rank(p.search_doc, ${tsq}) * 10
    + word_similarity(${norm}, p.search_plain) * 4
  )`;

  return { where, rank };
}

function orderByClause(sortKey: ProductQuery['sort'], rank: SQL | null): SQL {
  switch (sortKey) {
    case 'price-asc':
      return sql`coalesce(p.sale_price, p.price) asc, p.id asc`;
    case 'price-desc':
      return sql`coalesce(p.sale_price, p.price) desc, p.id asc`;
    case 'newest':
      return sql`p.published_at desc nulls last, p.created_at desc, p.id asc`;
    case 'relevance':
    default:
      // Deterministic: ties always break on id, never on physical row order.
      return rank
        ? sql`${rank} desc, p.published_at desc nulls last, p.id asc`
        : sql`p.published_at desc nulls last, p.created_at desc, p.id asc`;
  }
}

/**
 * Main storefront query. Powers the listing, category, brand and search pages.
 */
export async function searchProducts(
  query: ProductQuery,
  db: Database = getDb(),
): Promise<ProductListResult> {
  const search = buildSearch(query.q);
  const filters = buildFilters(query);
  if (search) filters.push(search.where);

  const whereSql = sql.join(filters, sql` and `);
  const offset = (query.page - 1) * query.perPage;

  const rows = await db.execute<RawProductRow>(sql`
    select
      p.id, p.slug, p.sku, p.oem_number, p.title_fa, p.price, p.sale_price, p.warranty_months,
      b.name_fa as brand_name, b.slug as brand_slug,
      c.name_fa as category_name, c.slug as category_slug,
      (select json_build_object('url', pi.url, 'alt', pi.alt)
         from product_images pi where pi.product_id = p.id
         order by pi.is_primary desc, pi.sort_order asc limit 1) as image,
      greatest(0, coalesce(inv.quantity_on_hand, 0) - coalesce(inv.quantity_reserved, 0)) as quantity_available,
      coalesce(inv.low_stock_threshold, 3) as low_stock_threshold
    from products p
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join inventory inv on inv.product_id = p.id
    where ${whereSql}
    order by ${orderByClause(query.sort, search?.rank ?? null)}
    limit ${query.perPage} offset ${offset}
  `);

  const countRows = await db.execute<{ total: number }>(sql`
    select count(*)::int as total
    from products p
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join inventory inv on inv.product_id = p.id
    where ${whereSql}
  `);

  const total = countRows.rows[0]?.total ?? 0;
  return {
    items: rows.rows.map(toCard),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

/* ── facets ───────────────────────────────────────────────────────────── */

export interface Facets {
  brands: { slug: string; nameFa: string; count: number }[];
  priceRange: { min: number; max: number } | null;
  manufacturers: { name: string; count: number }[];
}

/**
 * Facet counts for the current result set, computed with every filter applied
 * *except* the one being faceted (so a brand list does not collapse to one row
 * after picking a brand).
 */
export async function getFacets(query: ProductQuery, db: Database = getDb()): Promise<Facets> {
  const search = buildSearch(query.q);
  const withoutBrand = buildFilters({ ...query, brand: undefined });
  if (search) withoutBrand.push(search.where);
  const brandWhere = sql.join(withoutBrand, sql` and `);

  const allFilters = buildFilters(query);
  if (search) allFilters.push(search.where);
  const fullWhere = sql.join(allFilters, sql` and `);

  const [brandRows, priceRows, manufacturerRows] = await Promise.all([
    db.execute<{ slug: string; name_fa: string; count: number }>(sql`
      select b.slug, b.name_fa, count(*)::int as count
      from products p
      join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
      left join inventory inv on inv.product_id = p.id
      where ${brandWhere}
      group by b.slug, b.name_fa
      order by count desc, b.name_fa asc
      limit 40
    `),
    db.execute<{ min: string | null; max: string | null }>(sql`
      select min(coalesce(p.sale_price, p.price)) as min, max(coalesce(p.sale_price, p.price)) as max
      from products p
      left join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
      left join inventory inv on inv.product_id = p.id
      where ${fullWhere}
    `),
    db.execute<{ manufacturer: string; count: number }>(sql`
      select p.manufacturer, count(*)::int as count
      from products p
      left join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
      left join inventory inv on inv.product_id = p.id
      where ${fullWhere} and p.manufacturer is not null and p.manufacturer <> ''
      group by p.manufacturer
      order by count desc, p.manufacturer asc
      limit 25
    `),
  ]);

  const priceRow = priceRows.rows[0];
  return {
    brands: brandRows.rows.map((r) => ({ slug: r.slug, nameFa: r.name_fa, count: r.count })),
    priceRange:
      priceRow?.min != null && priceRow.max != null
        ? { min: Number(priceRow.min), max: Number(priceRow.max) }
        : null,
    manufacturers: manufacturerRows.rows.map((r) => ({ name: r.manufacturer, count: r.count })),
  };
}

/** Type-ahead suggestions for the header search box. */
export async function suggest(term: string, db: Database = getDb(), limit = 6) {
  const raw = term.trim();
  if (raw.length < 2) return [] as { slug: string; titleFa: string; sku: string; imageUrl: string | null }[];
  const rows = await db.execute<{ slug: string; title_fa: string; sku: string; image_url: string | null }>(sql`
    select p.slug, p.title_fa, p.sku,
      (select pi.url from product_images pi where pi.product_id = p.id
        order by pi.is_primary desc, pi.sort_order asc limit 1) as image_url
    from products p
    where p.is_active = true
      and (p.search_doc @@ websearch_to_tsquery('simple', md_normalize_fa(${raw}))
        or md_normalize_fa(${raw}) <% p.search_plain
        or p.search_plain like '%' || md_normalize_fa(${raw}) || '%')
    order by
      case when md_normalize_fa(p.title_fa) like '%' || md_normalize_fa(${raw}) || '%' then 0 else 1 end,
      word_similarity(md_normalize_fa(${raw}), p.search_plain) desc,
      p.title_fa asc
    limit ${limit}
  `);
  return rows.rows.map((r) => ({
    slug: r.slug,
    titleFa: r.title_fa,
    sku: r.sku,
    imageUrl: r.image_url,
  }));
}

/* ── product detail ───────────────────────────────────────────────────── */

export interface ProductSpec {
  specKey: string;
  specValue: string;
  unit: string | null;
}

export interface CompatibilityEntry {
  vehicleBrandName: string;
  vehicleBrandSlug: string;
  modelName: string;
  modelSlug: string;
  engineCode: string | null;
  engineName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  note: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  sku: string;
  oemNumber: string | null;
  mpn: string | null;
  titleFa: string;
  titleEn: string | null;
  descriptionFa: string | null;
  price: number;
  salePrice: number | null;
  effectivePrice: number;
  manufacturer: string | null;
  countryOfOrigin: string | null;
  condition: 'new' | 'refurbished' | 'used';
  warrantyMonths: number | null;
  installationNotes: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  isActive: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
  brand: { id: string; slug: string; nameFa: string; nameEn: string | null; country: string | null } | null;
  category: { id: string; slug: string; nameFa: string; parentSlug: string | null; parentNameFa: string | null } | null;
  images: { url: string; alt: string | null; isPrimary: boolean }[];
  specs: ProductSpec[];
  compatibility: CompatibilityEntry[];
  quantityAvailable: number;
  stockStatus: StockStatus;
}

export async function getProductBySlug(
  slug: string,
  opts: { includeInactive?: boolean } = {},
  db: Database = getDb(),
): Promise<ProductDetail | null> {
  const [row] = await db
    .select({
      product: products,
      brand: {
        id: brands.id,
        slug: brands.slug,
        nameFa: brands.nameFa,
        nameEn: brands.nameEn,
        country: brands.country,
      },
      category: { id: categories.id, slug: categories.slug, nameFa: categories.nameFa, parentId: categories.parentId },
      available: sql<number>`greatest(0, coalesce(inv.quantity_on_hand, 0) - coalesce(inv.quantity_reserved, 0))`,
      lowStockThreshold: sql<number>`coalesce(inv.low_stock_threshold, 3)`,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(sql`inventory inv`, sql`inv.product_id = ${products.id}`)
    .where(
      opts.includeInactive
        ? eq(products.slug, slug)
        : and(eq(products.slug, slug), eq(products.isActive, true)),
    )
    .limit(1);

  if (!row) return null;
  const p = row.product;

  const [images, specs, compat, parent] = await Promise.all([
    db
      .select({ url: productImages.url, alt: productImages.alt, isPrimary: productImages.isPrimary })
      .from(productImages)
      .where(eq(productImages.productId, p.id))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder)),
    db
      .select({ specKey: productSpecs.specKey, specValue: productSpecs.specValue, unit: productSpecs.unit })
      .from(productSpecs)
      .where(eq(productSpecs.productId, p.id))
      .orderBy(asc(productSpecs.sortOrder)),
    db
      .select({
        vehicleBrandName: vehicleBrands.nameFa,
        vehicleBrandSlug: vehicleBrands.slug,
        modelName: vehicleModels.nameFa,
        modelSlug: vehicleModels.slug,
        engineCode: vehicleEngines.code,
        engineName: vehicleEngines.nameFa,
        yearFrom: productVehicleCompat.yearFrom,
        yearTo: productVehicleCompat.yearTo,
        note: productVehicleCompat.note,
      })
      .from(productVehicleCompat)
      .innerJoin(vehicleModels, eq(vehicleModels.id, productVehicleCompat.vehicleModelId))
      .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleModels.vehicleBrandId))
      .leftJoin(vehicleEngines, eq(vehicleEngines.id, productVehicleCompat.vehicleEngineId))
      .where(eq(productVehicleCompat.productId, p.id))
      .orderBy(asc(vehicleBrands.nameFa), asc(vehicleModels.nameFa)),
    row.category?.parentId
      ? db
          .select({ slug: categories.slug, nameFa: categories.nameFa })
          .from(categories)
          .where(eq(categories.id, row.category.parentId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const available = Number(row.available);
  const parentRow = parent[0];

  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    oemNumber: p.oemNumber,
    mpn: p.mpn,
    titleFa: p.titleFa,
    titleEn: p.titleEn,
    descriptionFa: p.descriptionFa,
    price: p.price,
    salePrice: p.salePrice,
    effectivePrice: effectivePrice({ price: p.price, salePrice: p.salePrice }),
    manufacturer: p.manufacturer,
    countryOfOrigin: p.countryOfOrigin,
    condition: p.condition,
    warrantyMonths: p.warrantyMonths,
    installationNotes: p.installationNotes,
    weightGrams: p.weightGrams,
    lengthMm: p.lengthMm,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    tags: p.tags,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    isActive: p.isActive,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    brand: row.brand?.id ? row.brand : null,
    category: row.category?.id
      ? {
          id: row.category.id,
          slug: row.category.slug,
          nameFa: row.category.nameFa,
          parentSlug: parentRow?.slug ?? null,
          parentNameFa: parentRow?.nameFa ?? null,
        }
      : null,
    images,
    specs,
    compatibility: compat,
    quantityAvailable: available,
    stockStatus: stockStatus({
      quantityOnHand: available,
      quantityReserved: 0,
      lowStockThreshold: Number(row.lowStockThreshold),
    }),
  };
}

/** Other parts in the same category. */
export async function getRelatedProducts(
  productId: string,
  categoryId: string | null,
  limit = 8,
  db: Database = getDb(),
): Promise<ProductCard[]> {
  if (!categoryId) return [];
  const rows = await db.execute<RawProductRow>(sql`
    select p.id, p.slug, p.sku, p.oem_number, p.title_fa, p.price, p.sale_price, p.warranty_months,
      b.name_fa as brand_name, b.slug as brand_slug, c.name_fa as category_name, c.slug as category_slug,
      (select json_build_object('url', pi.url, 'alt', pi.alt) from product_images pi
        where pi.product_id = p.id order by pi.is_primary desc, pi.sort_order asc limit 1) as image,
      greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available,
      coalesce(inv.low_stock_threshold, 3) as low_stock_threshold
    from products p
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join inventory inv on inv.product_id = p.id
    where p.is_active = true and p.category_id = ${categoryId} and p.id <> ${productId}
    order by (coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) > 0 desc,
             p.published_at desc nulls last, p.id asc
    limit ${limit}
  `);
  return rows.rows.map(toCard);
}

/** Parts that fit at least one of the same vehicles — the useful "similar" list. */
export async function getSimilarByVehicle(
  productId: string,
  limit = 8,
  db: Database = getDb(),
): Promise<ProductCard[]> {
  const rows = await db.execute<RawProductRow>(sql`
    select p.id, p.slug, p.sku, p.oem_number, p.title_fa, p.price, p.sale_price, p.warranty_months,
      b.name_fa as brand_name, b.slug as brand_slug, c.name_fa as category_name, c.slug as category_slug,
      (select json_build_object('url', pi.url, 'alt', pi.alt) from product_images pi
        where pi.product_id = p.id order by pi.is_primary desc, pi.sort_order asc limit 1) as image,
      greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available,
      coalesce(inv.low_stock_threshold, 3) as low_stock_threshold
    from products p
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join inventory inv on inv.product_id = p.id
    where p.is_active = true and p.id <> ${productId}
      and exists (
        select 1 from product_vehicle_compat a
        join product_vehicle_compat x on x.vehicle_model_id = a.vehicle_model_id
        where a.product_id = ${productId} and x.product_id = p.id
      )
    order by p.published_at desc nulls last, p.id asc
    limit ${limit}
  `);
  return rows.rows.map(toCard);
}

export async function listFeatured(limit = 8, db: Database = getDb()): Promise<ProductCard[]> {
  const rows = await db.execute<RawProductRow>(sql`
    select p.id, p.slug, p.sku, p.oem_number, p.title_fa, p.price, p.sale_price, p.warranty_months,
      b.name_fa as brand_name, b.slug as brand_slug, c.name_fa as category_name, c.slug as category_slug,
      (select json_build_object('url', pi.url, 'alt', pi.alt) from product_images pi
        where pi.product_id = p.id order by pi.is_primary desc, pi.sort_order asc limit 1) as image,
      greatest(0, coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) as quantity_available,
      coalesce(inv.low_stock_threshold, 3) as low_stock_threshold
    from products p
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join inventory inv on inv.product_id = p.id
    where p.is_active = true
      and (coalesce(inv.quantity_on_hand,0) - coalesce(inv.quantity_reserved,0)) > 0
    order by (p.sale_price is not null) desc, p.published_at desc nulls last, p.id asc
    limit ${limit}
  `);
  return rows.rows.map(toCard);
}

/* ── taxonomy ─────────────────────────────────────────────────────────── */

export interface CategoryNode {
  id: string;
  slug: string;
  nameFa: string;
  icon: string | null;
  imageUrl: string | null;
  description: string | null;
  productCount: number;
  children: CategoryNode[];
}

export async function getCategoryTree(db: Database = getDb()): Promise<CategoryNode[]> {
  const rows = await db.execute<{
    id: string; parent_id: string | null; slug: string; name_fa: string;
    icon: string | null; image_url: string | null; description: string | null;
    sort_order: number; product_count: number;
  }>(sql`
    select c.id, c.parent_id, c.slug, c.name_fa, c.icon, c.image_url, c.description, c.sort_order,
      (
        with recursive tree as (
          select c.id as id
          union all
          select c2.id from categories c2 join tree t on c2.parent_id = t.id
        )
        select count(*)::int from products p where p.is_active = true and p.category_id in (select id from tree)
      ) as product_count
    from categories c
    where c.is_active = true
    order by c.sort_order asc, c.name_fa asc
  `);

  const nodes = new Map<string, CategoryNode>();
  for (const r of rows.rows) {
    nodes.set(r.id, {
      id: r.id,
      slug: r.slug,
      nameFa: r.name_fa,
      icon: r.icon,
      imageUrl: r.image_url,
      description: r.description,
      productCount: r.product_count,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const r of rows.rows) {
    const node = nodes.get(r.id)!;
    const parent = r.parent_id ? nodes.get(r.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getCategoryBySlug(slug: string, db: Database = getDb()) {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return row ?? null;
}

export async function listBrands(db: Database = getDb()) {
  const rows = await db.execute<{
    id: string; slug: string; name_fa: string; name_en: string | null;
    country: string | null; logo_url: string | null; description: string | null; product_count: number;
  }>(sql`
    select b.id, b.slug, b.name_fa, b.name_en, b.country, b.logo_url, b.description,
      (select count(*)::int from products p where p.brand_id = b.id and p.is_active = true) as product_count
    from brands b
    where b.is_active = true
    order by b.name_fa asc
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameFa: r.name_fa,
    nameEn: r.name_en,
    country: r.country,
    logoUrl: r.logo_url,
    description: r.description,
    productCount: r.product_count,
  }));
}

export async function getBrandBySlug(slug: string, db: Database = getDb()) {
  const [row] = await db.select().from(brands).where(eq(brands.slug, slug)).limit(1);
  return row ?? null;
}

/* ── vehicle tree (compatibility selector) ────────────────────────────── */

export interface VehicleBrandNode {
  id: string;
  slug: string;
  nameFa: string;
  models: { id: string; slug: string; nameFa: string; yearFrom: number | null; yearTo: number | null }[];
}

export async function getVehicleTree(db: Database = getDb()): Promise<VehicleBrandNode[]> {
  const rows = await db
    .select({
      brandId: vehicleBrands.id,
      brandSlug: vehicleBrands.slug,
      brandName: vehicleBrands.nameFa,
      brandSort: vehicleBrands.sortOrder,
      modelId: vehicleModels.id,
      modelSlug: vehicleModels.slug,
      modelName: vehicleModels.nameFa,
      yearFrom: vehicleModels.yearFrom,
      yearTo: vehicleModels.yearTo,
    })
    .from(vehicleBrands)
    .leftJoin(
      vehicleModels,
      and(eq(vehicleModels.vehicleBrandId, vehicleBrands.id), eq(vehicleModels.isActive, true)),
    )
    .where(eq(vehicleBrands.isActive, true))
    .orderBy(asc(vehicleBrands.sortOrder), asc(vehicleBrands.nameFa), asc(vehicleModels.nameFa));

  const out = new Map<string, VehicleBrandNode>();
  for (const r of rows) {
    if (!out.has(r.brandId)) {
      out.set(r.brandId, { id: r.brandId, slug: r.brandSlug, nameFa: r.brandName, models: [] });
    }
    if (r.modelId && r.modelSlug && r.modelName) {
      out.get(r.brandId)!.models.push({
        id: r.modelId,
        slug: r.modelSlug,
        nameFa: r.modelName,
        yearFrom: r.yearFrom,
        yearTo: r.yearTo,
      });
    }
  }
  return [...out.values()];
}

export async function getEnginesForModel(modelSlug: string, db: Database = getDb()) {
  return db
    .select({
      id: vehicleEngines.id,
      code: vehicleEngines.code,
      nameFa: vehicleEngines.nameFa,
      displacementCc: vehicleEngines.displacementCc,
      fuelType: vehicleEngines.fuelType,
    })
    .from(vehicleEngines)
    .innerJoin(vehicleModels, eq(vehicleModels.id, vehicleEngines.vehicleModelId))
    .where(and(eq(vehicleModels.slug, modelSlug), eq(vehicleEngines.isActive, true)))
    .orderBy(asc(vehicleEngines.code));
}

export async function getVehicleModelBySlug(slug: string, db: Database = getDb()) {
  const [row] = await db
    .select({
      id: vehicleModels.id,
      slug: vehicleModels.slug,
      nameFa: vehicleModels.nameFa,
      yearFrom: vehicleModels.yearFrom,
      yearTo: vehicleModels.yearTo,
      brandNameFa: vehicleBrands.nameFa,
      brandSlug: vehicleBrands.slug,
    })
    .from(vehicleModels)
    .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleModels.vehicleBrandId))
    .where(eq(vehicleModels.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Slugs for sitemap generation. */
export async function listAllActiveSlugs(db: Database = getDb()) {
  const [productRows, categoryRows, brandRows] = await Promise.all([
    db
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .where(eq(products.isActive, true)),
    db.select({ slug: categories.slug }).from(categories).where(eq(categories.isActive, true)),
    db.select({ slug: brands.slug }).from(brands).where(eq(brands.isActive, true)),
  ]);
  return { products: productRows, categories: categoryRows, brands: brandRows };
}

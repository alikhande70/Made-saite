/**
 * SEO health checks.
 *
 * Every issue is a counted, named condition over real rows — never a heuristic
 * and never a guess. That constraint is what keeps the score honest: a number
 * that moves without a countable cause is a vanity metric, and the point of
 * showing it to a shop owner is that they can act on it.
 *
 * Severity means something specific:
 *   ERROR    the page cannot be indexed correctly as it stands;
 *   WARNING  it will be indexed, but weakly;
 *   INFO     optional enrichment that is absent, and may legitimately stay so.
 *
 * Business fields that are genuinely optional stay INFO. An auto part with no
 * MPN is not broken — many Iranian aftermarket parts have no manufacturer part
 * number at all — so it must never be reported as an error.
 */
import { sql } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import type { SeoIssue } from '@/domain/search-visibility';
import { landingPageMinProducts, seoHealthScore, sortIssues } from '@/domain/search-visibility';

/**
 * One pass over `products` computing every product-level condition at once.
 *
 * Written as a single aggregate on purpose: nine separate `count(*)` queries
 * would be nine sequential scans of the same table for one admin page.
 */
async function productIssues(db: Database): Promise<SeoIssue[]> {
  const rows = await db.execute<{
    no_title: number;
    no_description: number;
    short_description: number;
    no_image: number;
    no_image_alt: number;
    no_category: number;
    no_brand: number;
    no_fitment: number;
    no_mpn: number;
    no_warranty: number;
    duplicate_title: number;
  }>(sql`
    with p as (
      select
        pr.id,
        pr.seo_title,
        pr.seo_description,
        pr.description_fa,
        pr.category_id,
        pr.brand_id,
        pr.mpn,
        pr.warranty_months,
        pr.title_fa,
        (select count(*) from product_images pi where pi.product_id = pr.id) as image_count,
        (select count(*) from product_images pi
           where pi.product_id = pr.id
             and (pi.alt is null or btrim(pi.alt) = '')) as image_no_alt,
        (select count(*) from product_fitments pf
           where pf.product_id = pr.id and pf.fitment_type <> 'NOT_COMPATIBLE') as fitment_count
      from products pr
      where pr.is_active = true
    ),
    dupes as (
      select count(*)::int as n from (
        select coalesce(nullif(btrim(seo_title), ''), title_fa) as t
        from p group by 1 having count(*) > 1
      ) d
    )
    select
      count(*) filter (where seo_title is null or btrim(seo_title) = '')::int          as no_title,
      count(*) filter (where seo_description is null or btrim(seo_description) = '')::int as no_description,
      count(*) filter (where description_fa is null or length(btrim(description_fa)) < 120)::int as short_description,
      count(*) filter (where image_count = 0)::int                                     as no_image,
      count(*) filter (where image_count > 0 and image_no_alt > 0)::int                as no_image_alt,
      count(*) filter (where category_id is null)::int                                 as no_category,
      count(*) filter (where brand_id is null)::int                                    as no_brand,
      count(*) filter (where fitment_count = 0)::int                                   as no_fitment,
      count(*) filter (where mpn is null or btrim(mpn) = '')::int                      as no_mpn,
      count(*) filter (where warranty_months is null)::int                             as no_warranty,
      (select n from dupes)                                                            as duplicate_title
    from p
  `);

  const r = rows.rows[0];
  if (!r) return [];

  const issue = (
    code: string,
    severity: SeoIssue['severity'],
    titleFa: string,
    count: number,
    href?: string,
  ): SeoIssue[] => (count > 0 ? [{ code, severity, titleFa, count: Number(count), href }] : []);

  return [
    // ERROR: an active product with no category has no breadcrumb, no parent
    // listing and no crawl path other than the flat product index.
    ...issue('product.no_category', 'ERROR',
      'کالای فعال بدون دسته‌بندی (مسیر خزش و مسیر راهنما ندارد)', r.no_category, '/admin/products'),
    // ERROR: no image means no `image` in Product structured data, which
    // Google documents as a required property for product results.
    ...issue('product.no_image', 'ERROR',
      'کالای فعال بدون تصویر (دادهٔ ساختاریافتهٔ کالا ناقص می‌شود)', r.no_image, '/admin/products'),
    ...issue('product.no_image_alt', 'WARNING',
      'کالای دارای تصویر بدون متن جایگزین (alt)', r.no_image_alt, '/admin/products'),
    ...issue('product.no_seo_title', 'WARNING',
      'کالا بدون عنوان سئو (از عنوان کالا استفاده می‌شود)', r.no_title, '/admin/products'),
    ...issue('product.no_seo_description', 'WARNING',
      'کالا بدون توضیح سئو', r.no_description, '/admin/products'),
    ...issue('product.short_description', 'WARNING',
      'توضیحات کالا بسیار کوتاه است (کمتر از ۱۲۰ نویسه)', r.short_description, '/admin/products'),
    ...issue('product.no_fitment', 'WARNING',
      'کالا بدون هیچ رکورد سازگاری خودرو', r.no_fitment, '/admin/products'),
    ...issue('product.duplicate_seo_title', 'WARNING',
      'عنوان سئوی تکراری میان کالاهای فعال', r.duplicate_title, '/admin/products'),
    ...issue('product.no_brand', 'INFO',
      'کالا بدون برند', r.no_brand, '/admin/products'),
    ...issue('product.no_warranty', 'INFO',
      'کالا بدون وضعیت گارانتی مشخص', r.no_warranty, '/admin/products'),
    ...issue('product.no_mpn', 'INFO',
      'کالا بدون کد سازنده (MPN)', r.no_mpn, '/admin/products'),
  ];
}

/**
 * Orphan detection: indexable resources with no reasonable internal link path.
 *
 * A category is orphaned when it has no active products *and* no active child
 * category — a crawler reaching it finds an empty page and no onward link. A
 * brand is orphaned when it has no active products, for the same reason. Both
 * are still served; they are simply not worth advertising, and an owner
 * usually wants to know they exist.
 */
async function orphanIssues(db: Database): Promise<SeoIssue[]> {
  const rows = await db.execute<{ orphan_categories: number; orphan_brands: number }>(sql`
    select
      (select count(*)::int from categories c
        where c.is_active = true
          and not exists (select 1 from products p where p.category_id = c.id and p.is_active = true)
          and not exists (select 1 from categories k where k.parent_id = c.id and k.is_active = true)
      ) as orphan_categories,
      (select count(*)::int from brands b
        where b.is_active = true
          and not exists (select 1 from products p where p.brand_id = b.id and p.is_active = true)
      ) as orphan_brands
  `);
  const r = rows.rows[0];
  if (!r) return [];

  const out: SeoIssue[] = [];
  if (r.orphan_categories > 0) {
    out.push({
      code: 'category.orphan', severity: 'WARNING',
      titleFa: 'دسته‌بندی فعال بدون کالا و بدون زیردسته (صفحهٔ خالی)',
      count: Number(r.orphan_categories), href: '/admin/categories',
    });
  }
  if (r.orphan_brands > 0) {
    out.push({
      code: 'brand.orphan', severity: 'WARNING',
      titleFa: 'برند فعال بدون هیچ کالای فعال (صفحهٔ خالی)',
      count: Number(r.orphan_brands), href: '/admin/brands',
    });
  }
  return out;
}

/**
 * Pairings that exist but sit below the indexing threshold. Not a defect —
 * this is the threshold working — but it is the single most actionable SEO
 * number in the shop, because each one becomes an indexable landing page as
 * soon as it has enough real stock behind it.
 */
async function thinLandingIssues(db: Database): Promise<SeoIssue[]> {
  const min = landingPageMinProducts();
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select c.id, vm.id as model_id
      from products p
      join categories c              on c.id = p.category_id and c.is_active = true
      join product_fitments pf       on pf.product_id = p.id and pf.fitment_type <> 'NOT_COMPATIBLE'
      join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
      join vehicle_models vm         on vm.id = vc.vehicle_model_id and vm.is_active = true
      where p.is_active = true
      group by c.id, vm.id
      having count(distinct p.id) < ${min}
    ) t
  `);
  const n = Number(rows.rows[0]?.n ?? 0);
  return n > 0
    ? [{
        code: 'landing.below_threshold', severity: 'INFO',
        titleFa: `ترکیب دسته×خودرو زیر آستانهٔ نمایه‌سازی (کمتر از ${min} کالا)`,
        count: n, href: '/admin/products',
      }]
    : [];
}

export interface SeoHealthReport {
  score: number;
  issues: SeoIssue[];
  counts: { errors: number; warnings: number; infos: number };
}

export async function getSeoHealth(db: Database = getDb()): Promise<SeoHealthReport> {
  const [productLevel, orphans, thin] = await Promise.all([
    productIssues(db),
    orphanIssues(db),
    thinLandingIssues(db),
  ]);
  const issues = sortIssues([...productLevel, ...orphans, ...thin]);
  return {
    score: seoHealthScore(issues),
    issues,
    counts: {
      errors: issues.filter((i) => i.severity === 'ERROR').length,
      warnings: issues.filter((i) => i.severity === 'WARNING').length,
      infos: issues.filter((i) => i.severity === 'INFO').length,
    },
  };
}

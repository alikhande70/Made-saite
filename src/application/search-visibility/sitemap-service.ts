/**
 * Sitemap generation.
 *
 * Two properties drive the design, and they pull in different directions.
 *
 * *Truthful*: every URL is public, active, canonical and expected to answer
 * 200. The queries select exactly the rows the corresponding page would render,
 * and every entry is additionally run through `assertSitemapCoherent`, which
 * rejects anything off-origin, carrying a query string, or under a private
 * prefix. That check is redundant if the queries are right — which is precisely
 * why it is there.
 *
 * *Bounded*: nothing loads a whole table. Each group is counted, split into
 * deterministic chunks, and served one `LIMIT/OFFSET` page at a time. The
 * previous implementation selected every active product on every request; at
 * 100,000 products that is one query returning 100,000 rows into memory to
 * build a single response, which is the shape of failure this replaces.
 *
 * `lastmod` is emitted only where a real timestamp exists. Categories and
 * brands carry no meaningful modification time, so they carry none here —
 * a synthesised `lastmod` is a false claim, and crawlers that notice stop
 * trusting the field.
 */
import { asc, count, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import { brands, categories, products } from '@/infrastructure/db/schema';
import {
  SITEMAP_URLS_PER_FILE,
  type SitemapEntry,
  type SitemapGroup,
  assertSitemapCoherent,
  canonicalUrl,
  landingPageMinProducts,
  sitemapFileName,
  sitemapOffset,
  sitemapPageCount,
  stripTrailingSlash,
  INDEXABLE_STATIC_PATHS,
} from '@/domain/search-visibility';
import { listVehicleLandingPages } from '@/application/catalog-service';

export interface SitemapIndexEntry {
  /** Absolute URL of a chunk file. */
  url: string;
  /** Newest `lastmod` inside that chunk, when the group has real timestamps. */
  lastModified: Date | null;
}

/* ── per-group counts ─────────────────────────────────────────────────────── */

async function countActiveProducts(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(products)
    .where(eq(products.isActive, true));
  return row?.n ?? 0;
}

async function countActiveCategories(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(categories).where(eq(categories.isActive, true));
  return row?.n ?? 0;
}

async function countActiveBrands(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(brands).where(eq(brands.isActive, true));
  return row?.n ?? 0;
}

/**
 * Landing pages are derived, not stored, so counting them means running the
 * aggregate. It is bounded by the number of (category, model) pairings that
 * clear the threshold — orders of magnitude smaller than the product table —
 * and the result is reused for the page itself on the same request.
 */
async function countLandingPages(db: Database): Promise<number> {
  const pages = await listVehicleLandingPages(landingPageMinProducts(), db);
  return pages.length;
}

export async function countGroup(group: SitemapGroup, db: Database = getDb()): Promise<number> {
  switch (group) {
    case 'static': return INDEXABLE_STATIC_PATHS.length + 5; // + home, products, categories, brands, vehicles
    case 'products': return countActiveProducts(db);
    case 'categories': return countActiveCategories(db);
    case 'brands': return countActiveBrands(db);
    case 'vehicles': return countLandingPages(db);
  }
}

/* ── per-group entry pages ────────────────────────────────────────────────── */

function staticEntries(base: string): SitemapEntry[] {
  const origin = stripTrailingSlash(base);
  const paths = ['/', '/products', '/categories', '/brands', '/vehicles', ...INDEXABLE_STATIC_PATHS];
  // No lastmod: these change when the code changes, and the deploy time is not
  // a property of the page.
  return paths.map((path) => ({ url: `${origin}${path}`, lastModified: null }));
}

async function productEntries(base: string, page: number, db: Database): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.isActive, true))
    // Ordering by id keeps chunk membership stable as rows are edited: ordering
    // by updatedAt would reshuffle products between files on every save.
    .orderBy(asc(products.id))
    .limit(SITEMAP_URLS_PER_FILE)
    .offset(sitemapOffset(page));

  return rows.map((r) => ({
    url: canonicalUrl(base, { kind: 'product', slug: r.slug }),
    lastModified: r.updatedAt,
  }));
}

async function categoryEntries(base: string, page: number, db: Database): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.id))
    .limit(SITEMAP_URLS_PER_FILE)
    .offset(sitemapOffset(page));
  return rows.map((r) => ({ url: canonicalUrl(base, { kind: 'category', slug: r.slug }), lastModified: null }));
}

async function brandEntries(base: string, page: number, db: Database): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: brands.slug })
    .from(brands)
    .where(eq(brands.isActive, true))
    .orderBy(asc(brands.id))
    .limit(SITEMAP_URLS_PER_FILE)
    .offset(sitemapOffset(page));
  return rows.map((r) => ({ url: canonicalUrl(base, { kind: 'brand', slug: r.slug }), lastModified: null }));
}

async function vehicleEntries(base: string, page: number, db: Database): Promise<SitemapEntry[]> {
  const all = await listVehicleLandingPages(landingPageMinProducts(), db);
  const slice = all.slice(sitemapOffset(page), sitemapOffset(page) + SITEMAP_URLS_PER_FILE);
  return slice.map((p) => ({
    url: canonicalUrl(base, { kind: 'vehicleLanding', categorySlug: p.categorySlug, modelSlug: p.modelSlug }),
    lastModified: null,
  }));
}

/**
 * One chunk's entries, already validated. Throws rather than emitting a URL
 * that should not be advertised.
 */
export async function sitemapEntries(
  group: SitemapGroup,
  page: number,
  base: string,
  db: Database = getDb(),
): Promise<SitemapEntry[]> {
  const entries = await (async () => {
    switch (group) {
      case 'static': return page === 1 ? staticEntries(base) : [];
      case 'products': return productEntries(base, page, db);
      case 'categories': return categoryEntries(base, page, db);
      case 'brands': return brandEntries(base, page, db);
      case 'vehicles': return vehicleEntries(base, page, db);
    }
  })();

  for (const entry of entries) assertSitemapCoherent(entry, base);
  return entries;
}

/** Defensive coercion for values that reach us as strings from raw SQL. */
function toDateOrNull(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The index: one entry per chunk file across every group. */
export async function sitemapIndex(base: string, db: Database = getDb()): Promise<SitemapIndexEntry[]> {
  const origin = stripTrailingSlash(base);
  const groups: SitemapGroup[] = ['static', 'products', 'categories', 'brands', 'vehicles'];

  /*
   * `max()` bypasses the column's type mapping, so the driver hands back
   * whatever it parsed — a string for a timestamp — rather than a Date. The
   * annotation on the previous version claimed `Date` and was simply wrong;
   * coercing here keeps the lie out of the type and out of the renderer.
   */
  const newestProduct = await db
    .select({ latest: sql<string | Date | null>`max(${products.updatedAt})` })
    .from(products)
    .where(eq(products.isActive, true));
  const productsLastMod = toDateOrNull(newestProduct[0]?.latest ?? null);

  const out: SitemapIndexEntry[] = [];
  for (const group of groups) {
    const total = await countGroup(group, db);
    const pages = sitemapPageCount(total);
    for (let page = 1; page <= pages; page += 1) {
      out.push({
        url: `${origin}/sitemaps/${sitemapFileName(group, page)}`,
        // Only products carry a real per-row timestamp to aggregate.
        lastModified: group === 'products' ? productsLastMod : null,
      });
    }
  }
  return out;
}

/* ── XML rendering ────────────────────────────────────────────────────────── */

/**
 * Minimal, correct escaping for XML text nodes. URLs are already
 * percent-encoded by `canonicalUrl`, so `&` is the realistic case (it appears
 * in no canonical we emit, but a future one could).
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** W3C Datetime, which the sitemap protocol requires for `lastmod`. */
function w3cDate(date: Date): string {
  return date.toISOString();
}

export function renderUrlSet(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const modified = toDateOrNull(e.lastModified);
      const lastmod = modified ? `\n    <lastmod>${w3cDate(modified)}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEscape(e.url)}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderSitemapIndex(entries: readonly SitemapIndexEntry[]): string {
  const maps = entries
    .map((e) => {
      const modified = toDateOrNull(e.lastModified);
      const lastmod = modified ? `\n    <lastmod>${w3cDate(modified)}</lastmod>` : '';
      return `  <sitemap>\n    <loc>${xmlEscape(e.url)}</loc>${lastmod}\n  </sitemap>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps}\n</sitemapindex>\n`;
}

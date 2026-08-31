/**
 * Search visibility rules — the single authority for what a crawler may see.
 *
 * Everything here is pure. No database, no network, no `process.env` beyond a
 * caller-supplied base URL. That is deliberate: these are the rules that decide
 * whether a URL enters the index, and rules that can only be exercised through
 * a running server are rules nobody tests properly.
 *
 * Three separate decisions live here and are easy to conflate:
 *
 *   canonical    — which URL *is* this page. One per resource, always absolute.
 *   indexable    — may a crawler keep this page in its index.
 *   sitemap-eligible — should we actively advertise it.
 *
 * Sitemap eligibility is strictly narrower than indexability: a filtered
 * listing is `noindex, follow` (crawl through, do not keep) and is also absent
 * from the sitemap, while a product page is both indexable and advertised.
 * A page may never be advertised in the sitemap without being indexable —
 * `assertSitemapCoherent` enforces that, because a sitemap that lists a
 * `noindex` URL is a self-contradiction crawlers report as an error.
 */

/* ── protocol limits (sitemaps.org/protocol.html) ─────────────────────────── */

/** Hard limit from the sitemap protocol: 50,000 URLs per file. */
export const SITEMAP_MAX_URLS = 50_000;

/** Hard limit from the sitemap protocol: 50,000 sitemaps per index file. */
export const SITEMAP_INDEX_MAX_ENTRIES = 50_000;

/**
 * URLs per generated file. Deliberately far below the 50,000 ceiling: the
 * other protocol limit is 50 MB uncompressed, and a chunk this size stays
 * small enough to generate from one bounded query and hold in memory without
 * thinking about it. Chunking is deterministic, so a URL keeps its file across
 * regenerations as long as the ordering key is stable.
 */
export const SITEMAP_URLS_PER_FILE = 10_000;

/* ── sitemap groups ───────────────────────────────────────────────────────── */

/**
 * Groups exist so a crawler can re-fetch only what changed, and so one
 * runaway table cannot push everything else out of a 50,000-URL file.
 */
export const SITEMAP_GROUPS = ['static', 'products', 'categories', 'brands', 'vehicles'] as const;
export type SitemapGroup = (typeof SITEMAP_GROUPS)[number];

export function isSitemapGroup(value: string): value is SitemapGroup {
  return (SITEMAP_GROUPS as readonly string[]).includes(value);
}

/** `products-2.xml` → `{ group: 'products', page: 2 }`; anything else → null. */
export function parseSitemapFileName(fileName: string): { group: SitemapGroup; page: number } | null {
  const match = /^([a-z]+)-(\d+)\.xml$/.exec(fileName);
  if (!match) return null;
  const [, group, rawPage] = match;
  if (!group || !rawPage || !isSitemapGroup(group)) return null;
  const page = Number(rawPage);
  // Leading zeros would give two file names for one page; reject them so the
  // chunk URL is canonical too.
  if (!Number.isInteger(page) || page < 1 || String(page) !== rawPage) return null;
  return { group, page };
}

export function sitemapFileName(group: SitemapGroup, page: number): string {
  return `${group}-${page}.xml`;
}

/**
 * How many files a group needs. Zero rows still yields one file, so the index
 * never points at a group that 404s and an empty catalogue still produces a
 * valid (empty) sitemap rather than a missing one.
 */
export function sitemapPageCount(totalUrls: number, perFile = SITEMAP_URLS_PER_FILE): number {
  if (perFile < 1) throw new RangeError('perFile must be at least 1');
  if (totalUrls <= 0) return 1;
  return Math.ceil(totalUrls / perFile);
}

/** Zero-based row offset for a 1-based page. */
export function sitemapOffset(page: number, perFile = SITEMAP_URLS_PER_FILE): number {
  return (page - 1) * perFile;
}

/* ── canonical URL authority ──────────────────────────────────────────────── */

/**
 * Every canonical path in the application. Adding a new indexable surface means
 * adding a member here, which is the point: a canonical built ad hoc in a page
 * component is how two URLs end up claiming to be the same resource.
 */
export type CanonicalTarget =
  | { kind: 'home' }
  | { kind: 'products' }
  | { kind: 'product'; slug: string }
  | { kind: 'categories' }
  | { kind: 'category'; slug: string }
  | { kind: 'brands' }
  | { kind: 'brand'; slug: string }
  | { kind: 'vehicles' }
  | { kind: 'vehicleLanding'; categorySlug: string; modelSlug: string }
  | { kind: 'staticPage'; path: string };

/** Static pages that are indexable. Anything absent is not a canonical target. */
export const INDEXABLE_STATIC_PATHS = [
  '/about', '/contact', '/faq', '/shipping', '/terms', '/privacy',
] as const;

/**
 * Path-only canonical (no origin), always starting with `/` and with each
 * segment percent-encoded exactly once.
 *
 * Persian slugs are the reason this is centralised. `encodeURIComponent` on an
 * already-encoded slug double-encodes it, and two pages disagreeing about
 * whether to encode produce two canonicals for one product.
 */
export function canonicalPath(target: CanonicalTarget): string {
  const seg = (value: string) => encodeURIComponent(decodeSlugOnce(value));
  switch (target.kind) {
    case 'home': return '/';
    case 'products': return '/products';
    case 'product': return `/products/${seg(target.slug)}`;
    case 'categories': return '/categories';
    case 'category': return `/categories/${seg(target.slug)}`;
    case 'brands': return '/brands';
    case 'brand': return `/brands/${seg(target.slug)}`;
    case 'vehicles': return '/vehicles';
    case 'vehicleLanding': return `/parts/${seg(target.categorySlug)}/${seg(target.modelSlug)}`;
    case 'staticPage': return target.path;
  }
}

/**
 * Decodes a slug at most once, so a caller passing either the raw or the
 * already-encoded form lands on the same canonical. A slug containing a literal
 * `%` that is not an escape decodes to itself.
 */
function decodeSlugOnce(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/** Absolute canonical. `base` must be an origin with no trailing slash. */
export function canonicalUrl(base: string, target: CanonicalTarget): string {
  return `${stripTrailingSlash(base)}${canonicalPath(target)}`;
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/* ── indexability ─────────────────────────────────────────────────────────── */

export type RawParams = Record<string, string | string[] | undefined>;

/**
 * Params that name the resource rather than filter it. `page` is *not* here:
 * page 2 of a listing is a filtered view of the same resource, not a resource
 * of its own, so it is `noindex, follow` and canonicalises to page 1.
 */
const IDENTITY_KEYS = new Set(['slug', 'category', 'vehicle']);

export function hasFacetParams(params: RawParams, ignore: readonly string[] = []): boolean {
  const ignored = new Set([...IDENTITY_KEYS, ...ignore]);
  return Object.entries(params).some(([key, value]) => {
    if (ignored.has(key)) return false;
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== '';
  });
}

export interface RobotsDirective {
  index: boolean;
  follow: boolean;
}

/**
 * A catalogue with n filters has 2^n reachable URLs. Exactly one per listing
 * surface is indexable — the bare one — and every filtered, sorted or paginated
 * variant is served normally but marked `noindex, follow`, so the crawler still
 * walks through to the products without keeping the intermediate page.
 *
 * `follow` is never withdrawn: withdrawing it would strand the products that
 * are only reachable through a filter.
 */
export function listingRobots(params: RawParams, ignore: readonly string[] = []): RobotsDirective {
  return hasFacetParams(params, ignore) ? { index: false, follow: true } : { index: true, follow: true };
}

/**
 * The threshold a vehicle × category pairing must clear to be indexable.
 *
 * Below it the page is still served — a customer following a link gets a real
 * page — but it is `noindex` and absent from the sitemap. This is the line
 * between programmatic SEO and mass thin-page generation: pages are derived
 * from real fitment rows, and a pairing with two products is not a landing page
 * just because the URL can be constructed.
 */
export const LANDING_PAGE_MIN_PRODUCTS_DEFAULT = 3;

export function landingPageMinProducts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SEO_LANDING_MIN_PRODUCTS);
  if (!Number.isFinite(raw) || raw < 1) return LANDING_PAGE_MIN_PRODUCTS_DEFAULT;
  return Math.floor(raw);
}

/** A landing page is indexable only on real, positive, sufficient evidence. */
export function isLandingPageIndexable(
  input: { productCount: number; hasPositiveFitment: boolean; categoryActive: boolean; modelActive: boolean },
  minProducts = LANDING_PAGE_MIN_PRODUCTS_DEFAULT,
): boolean {
  return (
    input.categoryActive &&
    input.modelActive &&
    input.hasPositiveFitment &&
    input.productCount >= minProducts
  );
}

/* ── sitemap eligibility ──────────────────────────────────────────────────── */

/**
 * Path prefixes that must never appear in a sitemap, whatever else happens.
 * Checked as a last line of defence in `assertSitemapCoherent`, so a future
 * query bug cannot advertise a private URL even if it produces one.
 */
export const SITEMAP_FORBIDDEN_PREFIXES = [
  '/admin', '/account', '/cart', '/checkout', '/orders', '/api',
  '/payment', '/login', '/register', '/search',
] as const;

export function isForbiddenInSitemap(path: string): boolean {
  return SITEMAP_FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export interface SitemapEntry {
  /** Absolute URL. */
  url: string;
  /**
   * Real modification time, or null. Never synthesised: `lastmod` is a claim
   * about the page, and a generated-at timestamp is a false one that teaches
   * crawlers to ignore the field.
   */
  lastModified: Date | null;
}

/**
 * Throws if an entry should not be in a sitemap. Called on every entry during
 * generation — cheap, and it converts a silent leak into a loud failure.
 */
export function assertSitemapCoherent(entry: SitemapEntry, base: string): void {
  const origin = stripTrailingSlash(base);
  if (!entry.url.startsWith(`${origin}/`) && entry.url !== origin) {
    throw new Error(`sitemap entry is not on the canonical origin: ${entry.url}`);
  }
  if (entry.url.includes('?') || entry.url.includes('#')) {
    throw new Error(`sitemap entry carries a query or fragment: ${entry.url}`);
  }
  const path = entry.url.slice(origin.length) || '/';
  if (isForbiddenInSitemap(path)) {
    throw new Error(`sitemap entry is a private or non-indexable surface: ${path}`);
  }
}

/* ── submission URL normalisation and dedupe ──────────────────────────────── */

/**
 * The dedupe key for a submission. Two events for the same page must collapse
 * to one request, or an afternoon of admin edits becomes a flood that gets the
 * host rate-limited (IndexNow answers 429 and treats it as spam).
 *
 * Normalisation drops the fragment and any query string — a search engine
 * indexes the canonical URL, and our canonical URLs never carry a query.
 */
export function normalizeSubmissionUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.search = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = stripTrailingSlash(url.pathname);
  }
  return url.toString();
}

/** Preserves first-seen order, which keeps batches deterministic for tests. */
export function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let normalized: string;
    try {
      normalized = normalizeSubmissionUrl(raw);
    } catch {
      continue; // not a URL; nothing to submit
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/* ── retry policy ─────────────────────────────────────────────────────────── */

/** Attempts before an event is parked as FAILED for an operator to see. */
export const SUBMISSION_MAX_ATTEMPTS = 5;

/**
 * Exponential backoff with a ceiling. A search engine being down is not an
 * emergency — the page is already published and will be crawled eventually —
 * so retries are patient rather than aggressive.
 */
export function nextRetryDelayMs(attempt: number): number {
  const minutes = Math.min(2 ** Math.max(attempt - 1, 0), 60);
  return minutes * 60_000;
}

export function nextRetryAt(attempt: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + nextRetryDelayMs(attempt));
}

/**
 * Whether a response code means "stop trying". 4xx other than 429 is our
 * mistake (bad key, wrong host) and retrying cannot fix it; 429 and 5xx are
 * transient.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/* ── SEO health ───────────────────────────────────────────────────────────── */

export type SeoIssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface SeoIssue {
  code: string;
  severity: SeoIssueSeverity;
  /** Persian, shown directly in the admin. */
  titleFa: string;
  count: number;
  /** Deep link into the admin surface that fixes it, when there is one. */
  href?: string;
}

/**
 * Weight per *affected item*, capped per issue code so one bad import cannot
 * drive the score to zero and hide everything else.
 */
const SEVERITY_WEIGHT: Record<SeoIssueSeverity, number> = { ERROR: 4, WARNING: 1.5, INFO: 0.25 };
const MAX_DEDUCTION_PER_CODE = 20;

/**
 * A deterministic score, derived only from the issues below — no curve, no
 * hidden constant. Every point lost is attributable to a listed issue, which is
 * what stops it becoming a vanity metric: the number cannot move unless a
 * specific, countable problem moved.
 */
export function seoHealthScore(issues: readonly SeoIssue[]): number {
  const deduction = issues.reduce((total, issue) => {
    const raw = issue.count * SEVERITY_WEIGHT[issue.severity];
    return total + Math.min(raw, MAX_DEDUCTION_PER_CODE);
  }, 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction)));
}

/** Sort for display: errors first, then by how many items are affected. */
export function sortIssues(issues: readonly SeoIssue[]): SeoIssue[] {
  const rank: Record<SeoIssueSeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
  return [...issues].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count || a.code.localeCompare(b.code),
  );
}

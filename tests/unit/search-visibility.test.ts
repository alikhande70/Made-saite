/**
 * Search visibility rules — unit level.
 *
 * These are the decisions that determine what a crawler keeps. Every test here
 * is written to fail if the rule is loosened, not merely to confirm the happy
 * path: the falsification block at the end exists because "no admin URL in the
 * sitemap" is a claim, and a claim needs an attempt to break it.
 */
import { describe, expect, it } from 'vitest';
import {
  SITEMAP_INDEX_MAX_ENTRIES,
  SITEMAP_MAX_URLS,
  SITEMAP_URLS_PER_FILE,
  assertSitemapCoherent,
  canonicalPath,
  canonicalUrl,
  dedupeUrls,
  hasFacetParams,
  isForbiddenInSitemap,
  isLandingPageIndexable,
  isRetryableStatus,
  isSitemapGroup,
  landingPageMinProducts,
  listingRobots,
  nextRetryDelayMs,
  normalizeSubmissionUrl,
  parseSitemapFileName,
  seoHealthScore,
  sitemapFileName,
  sitemapOffset,
  sitemapPageCount,
  sortIssues,
  stripTrailingSlash,
  type SeoIssue,
} from '@/domain/search-visibility';
import { indexNowKeyFilePath, isValidIndexNowKey } from '@/application/search-visibility/indexnow-adapter';

const BASE = 'https://madesaite.example';

describe('protocol limits', () => {
  it('keeps the per-file chunk well inside the sitemap protocol ceiling', () => {
    expect(SITEMAP_MAX_URLS).toBe(50_000);
    expect(SITEMAP_INDEX_MAX_ENTRIES).toBe(50_000);
    expect(SITEMAP_URLS_PER_FILE).toBeLessThanOrEqual(SITEMAP_MAX_URLS);
  });
});

describe('canonical authority', () => {
  it('builds one canonical per resource kind', () => {
    expect(canonicalPath({ kind: 'home' })).toBe('/');
    expect(canonicalPath({ kind: 'products' })).toBe('/products');
    expect(canonicalPath({ kind: 'product', slug: 'oil-filter' })).toBe('/products/oil-filter');
    expect(canonicalPath({ kind: 'category', slug: 'filters' })).toBe('/categories/filters');
    expect(canonicalPath({ kind: 'brand', slug: 'bosch' })).toBe('/brands/bosch');
    expect(canonicalPath({ kind: 'vehicleLanding', categorySlug: 'filters', modelSlug: 'peugeot-206' }))
      .toBe('/parts/filters/peugeot-206');
  });

  it('encodes a Persian slug exactly once, whether given raw or pre-encoded', () => {
    const raw = canonicalPath({ kind: 'product', slug: 'فیلتر-روغن' });
    const preEncoded = canonicalPath({ kind: 'product', slug: encodeURIComponent('فیلتر-روغن') });
    // Double-encoding is the specific bug this authority exists to prevent:
    // it would produce two canonicals for one product.
    expect(raw).toBe(preEncoded);
    expect(raw).not.toContain('%25');
    expect(decodeURIComponent(raw)).toBe('/products/فیلتر-روغن');
  });

  it('produces an absolute URL without a doubled slash', () => {
    expect(canonicalUrl(`${BASE}/`, { kind: 'product', slug: 'x' })).toBe(`${BASE}/products/x`);
    expect(canonicalUrl(BASE, { kind: 'home' })).toBe(`${BASE}/`);
  });

  it('strips a trailing slash idempotently', () => {
    expect(stripTrailingSlash(`${BASE}/`)).toBe(BASE);
    expect(stripTrailingSlash(BASE)).toBe(BASE);
  });
});

describe('indexability of listings', () => {
  it('indexes only the bare listing URL', () => {
    expect(listingRobots({})).toEqual({ index: true, follow: true });
    expect(listingRobots({ slug: 'filters' })).toEqual({ index: true, follow: true });
  });

  it('marks every filtered, sorted or paginated variant noindex, follow', () => {
    for (const params of [
      { brand: 'bosch' },
      { sort: 'price' },
      { page: '2' },
      { brand: ['a', 'b'] },
      { vehicleModel: 'peugeot-206' },
    ]) {
      expect(listingRobots(params)).toEqual({ index: false, follow: true });
    }
  });

  it('never withdraws follow, so products behind a filter stay reachable', () => {
    expect(listingRobots({ brand: 'x', sort: 'price', page: '9' }).follow).toBe(true);
  });

  it('ignores empty values, so ?brand= is not treated as a facet', () => {
    expect(hasFacetParams({ brand: '' })).toBe(false);
    expect(hasFacetParams({ brand: [] })).toBe(false);
    expect(hasFacetParams({ brand: undefined })).toBe(false);
  });

  it('lets a page own a param that is part of its identity', () => {
    expect(listingRobots({ q: 'فیلتر' }, ['q'])).toEqual({ index: true, follow: true });
  });
});

describe('vehicle landing thresholds', () => {
  const base = { productCount: 5, hasPositiveFitment: true, categoryActive: true, modelActive: true };

  it('indexes a pairing with real, sufficient evidence', () => {
    expect(isLandingPageIndexable(base, 3)).toBe(true);
  });

  it('refuses a thin pairing', () => {
    expect(isLandingPageIndexable({ ...base, productCount: 2 }, 3)).toBe(false);
  });

  it('refuses a pairing with no positive fitment, however many products match', () => {
    // Absence of evidence is never compatibility — the rule this shop exists to honour.
    expect(isLandingPageIndexable({ ...base, productCount: 500, hasPositiveFitment: false }, 3)).toBe(false);
  });

  it('refuses a pairing whose category or model is deactivated', () => {
    expect(isLandingPageIndexable({ ...base, categoryActive: false }, 3)).toBe(false);
    expect(isLandingPageIndexable({ ...base, modelActive: false }, 3)).toBe(false);
  });

  it('reads a configurable threshold and rejects nonsense values', () => {
    expect(landingPageMinProducts({ SEO_LANDING_MIN_PRODUCTS: '8' } as unknown as NodeJS.ProcessEnv)).toBe(8);
    expect(landingPageMinProducts({ SEO_LANDING_MIN_PRODUCTS: '0' } as unknown as NodeJS.ProcessEnv)).toBe(3);
    expect(landingPageMinProducts({} as unknown as NodeJS.ProcessEnv)).toBe(3);
  });
});

describe('sitemap chunking', () => {
  it('is deterministic and one-based', () => {
    expect(sitemapPageCount(0)).toBe(1);
    expect(sitemapPageCount(1)).toBe(1);
    expect(sitemapPageCount(SITEMAP_URLS_PER_FILE)).toBe(1);
    expect(sitemapPageCount(SITEMAP_URLS_PER_FILE + 1)).toBe(2);
    expect(sitemapPageCount(100_000)).toBe(10);
    expect(sitemapOffset(1)).toBe(0);
    expect(sitemapOffset(3)).toBe(SITEMAP_URLS_PER_FILE * 2);
  });

  it('round-trips a file name', () => {
    expect(parseSitemapFileName(sitemapFileName('products', 4))).toEqual({ group: 'products', page: 4 });
  });

  it('rejects file names that would give one chunk two URLs', () => {
    // A leading zero is a second spelling of the same page — a duplicate URL.
    expect(parseSitemapFileName('products-01.xml')).toBeNull();
    expect(parseSitemapFileName('products-0.xml')).toBeNull();
    expect(parseSitemapFileName('products--1.xml')).toBeNull();
    expect(parseSitemapFileName('unknown-1.xml')).toBeNull();
    expect(parseSitemapFileName('products-1.txt')).toBeNull();
    expect(parseSitemapFileName('../../etc/passwd')).toBeNull();
  });

  it('recognises exactly the defined groups', () => {
    expect(isSitemapGroup('products')).toBe(true);
    expect(isSitemapGroup('orders')).toBe(false);
  });
});

describe('submission URL handling', () => {
  it('drops query and fragment so one page is one submission', () => {
    expect(normalizeSubmissionUrl(`${BASE}/products/x?utm_source=a#top`)).toBe(`${BASE}/products/x`);
  });

  it('treats a trailing slash as the same page', () => {
    expect(normalizeSubmissionUrl(`${BASE}/products/x/`)).toBe(`${BASE}/products/x`);
  });

  it('collapses duplicates while preserving order', () => {
    const out = dedupeUrls([
      `${BASE}/a`, `${BASE}/a?x=1`, `${BASE}/b`, `${BASE}/a#frag`, 'not-a-url',
    ]);
    expect(out).toEqual([`${BASE}/a`, `${BASE}/b`]);
  });
});

describe('retry policy', () => {
  it('backs off exponentially and caps at an hour', () => {
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(120_000);
    expect(nextRetryDelayMs(3)).toBe(240_000);
    expect(nextRetryDelayMs(50)).toBe(3_600_000);
  });

  it('retries only what retrying can fix', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    // A bad key or a host mismatch is our mistake; retrying just earns a 429.
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe('IndexNow key rules', () => {
  it('accepts keys the specification allows', () => {
    expect(isValidIndexNowKey('a'.repeat(8))).toBe(true);
    expect(isValidIndexNowKey('a'.repeat(128))).toBe(true);
    expect(isValidIndexNowKey('AbC-123-xyz')).toBe(true);
  });

  it('rejects keys it does not', () => {
    expect(isValidIndexNowKey('short')).toBe(false);
    expect(isValidIndexNowKey('a'.repeat(129))).toBe(false);
    expect(isValidIndexNowKey('has space')).toBe(false);
    expect(isValidIndexNowKey('has_underscore!')).toBe(false);
  });

  it('places the key file exactly where the specification requires', () => {
    expect(indexNowKeyFilePath('abcd1234')).toBe('/abcd1234.txt');
  });
});

describe('SEO health score', () => {
  const issue = (severity: SeoIssue['severity'], count: number, code: string = severity): SeoIssue =>
    ({ code, severity, titleFa: code, count });

  it('is 100 with no issues', () => {
    expect(seoHealthScore([])).toBe(100);
  });

  it('deducts more for errors than warnings than info', () => {
    expect(seoHealthScore([issue('ERROR', 1)])).toBeLessThan(seoHealthScore([issue('WARNING', 1)]));
    expect(seoHealthScore([issue('WARNING', 1)])).toBeLessThan(seoHealthScore([issue('INFO', 1)]));
  });

  it('caps one issue code so a single bad import cannot hide everything else', () => {
    // Without the cap, 10,000 products missing an image would floor the score
    // and make every other problem invisible.
    expect(seoHealthScore([issue('ERROR', 10_000)])).toBe(80);
  });

  it('never leaves the 0..100 range', () => {
    const many = Array.from({ length: 40 }, (_, i) => issue('ERROR', 1_000, `code-${i}`));
    const score = seoHealthScore(many);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('is deterministic — the same issues always give the same number', () => {
    const issues = [issue('ERROR', 3), issue('WARNING', 7), issue('INFO', 11)];
    expect(seoHealthScore(issues)).toBe(seoHealthScore([...issues].reverse()));
  });

  it('sorts errors first, then by how many items are affected', () => {
    const sorted = sortIssues([issue('INFO', 99, 'i'), issue('WARNING', 1, 'w'), issue('ERROR', 1, 'e')]);
    expect(sorted.map((i) => i.severity)).toEqual(['ERROR', 'WARNING', 'INFO']);
  });
});

/* ── falsification ────────────────────────────────────────────────────────── */

describe('falsification: things that must never reach a sitemap', () => {
  const entry = (path: string) => ({ url: `${BASE}${path}`, lastModified: null });

  it.each([
    '/admin', '/admin/products', '/account', '/account/orders',
    '/cart', '/checkout', '/orders', '/orders/track/SECRET-TOKEN',
    '/api/health', '/payment/sandbox', '/login', '/register', '/search',
  ])('refuses %s', (path) => {
    expect(isForbiddenInSitemap(path)).toBe(true);
    expect(() => assertSitemapCoherent(entry(path), BASE)).toThrow();
  });

  it('refuses a URL on a different origin', () => {
    expect(() => assertSitemapCoherent({ url: 'https://evil.example/products/x', lastModified: null }, BASE))
      .toThrow(/canonical origin/);
  });

  it('refuses a URL carrying a query string or fragment', () => {
    expect(() => assertSitemapCoherent(entry('/products?sort=price'), BASE)).toThrow(/query or fragment/);
    expect(() => assertSitemapCoherent(entry('/products#a'), BASE)).toThrow(/query or fragment/);
  });

  it('allows the legitimate public surfaces', () => {
    for (const path of ['/', '/products', '/products/فیلتر', '/categories/x', '/brands/y', '/parts/a/b', '/faq']) {
      expect(isForbiddenInSitemap(path)).toBe(false);
      expect(() => assertSitemapCoherent(entry(path), BASE)).not.toThrow();
    }
  });

  it('does not let a prefix match swallow a legitimate path', () => {
    // `/searchable-parts` is not `/search`.
    expect(isForbiddenInSitemap('/searchable-parts')).toBe(false);
    expect(isForbiddenInSitemap('/administrative-guide')).toBe(false);
  });
});

/**
 * Faceted-navigation indexability (ADR-004).
 *
 * A catalogue with n filters has 2^n reachable URLs. Letting a crawler index
 * them produces thin, near-duplicate pages and burns crawl budget on states no
 * human would ever link to. So exactly one URL per listing surface is
 * indexable — the bare one — and every filtered, sorted or paginated variant
 * is served normally but marked `noindex, follow`: the crawler still walks
 * through to the products, it just does not keep the intermediate page.
 */
import type { Metadata } from 'next';

export type RawParams = Record<string, string | string[] | undefined>;

/** Params that describe the page's identity rather than a filter over it. */
const IDENTITY_KEYS = new Set(['slug', 'category', 'vehicle']);

function hasFacetParams(params: RawParams, ignore: readonly string[] = []): boolean {
  const ignored = new Set([...IDENTITY_KEYS, ...ignore]);
  return Object.entries(params).some(([key, value]) => {
    if (ignored.has(key)) return false;
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== '';
  });
}

/**
 * `index` only for the bare listing URL. `follow` is kept in every case so
 * link equity still flows to the products themselves.
 *
 * @param ignore extra params that do not make the page a facet (e.g. a page
 *               that legitimately owns `q`).
 */
export function listingRobots(params: RawParams, ignore: readonly string[] = []): Metadata['robots'] {
  return hasFacetParams(params, ignore)
    ? { index: false, follow: true }
    : { index: true, follow: true };
}

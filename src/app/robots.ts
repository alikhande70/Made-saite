import type { MetadataRoute } from 'next';
import { siteUrl } from '@/application/settings-service';
import { SITEMAP_FORBIDDEN_PREFIXES } from '@/domain/search-visibility';

/**
 * `disallow` and `noindex` do different jobs, and confusing them is the classic
 * way to keep a page in the index permanently: a crawler that is blocked from
 * fetching a URL can never see the `noindex` on it.
 *
 * So the disallow list here is only surfaces that must never be *fetched* —
 * transactional, personal and administrative paths, none of which a crawler has
 * any business requesting. Faceted and filtered listings are deliberately
 * absent: they are crawlable and carry `noindex, follow`, which is what lets
 * the crawler walk through them to the products without keeping the
 * intermediate page.
 *
 * The one deliberate exception is `/search`, which is both disallowed and
 * `noindex`. Search-result pages generate unbounded distinct URLs from user
 * input, so the crawl-budget argument outweighs the redundancy.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...SITEMAP_FORBIDDEN_PREFIXES],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

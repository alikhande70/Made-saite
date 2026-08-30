import type { MetadataRoute } from 'next';
import { listAllActiveSlugs, listVehicleLandingPages } from '@/application/catalog-service';
import { siteUrl } from '@/application/settings-service';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

/**
 * Sitemap built from live database state — only active products, categories and
 * brands appear. Transactional and account pages are excluded (they are also
 * `noindex`), so nothing private or session-dependent is advertised.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/products`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/categories`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/brands`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/vehicles`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/shipping`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/faq`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    /*
     * Landing pages come from live fitment counts and only above the
     * indexability threshold, so a pairing that loses its stock leaves the
     * sitemap on the next request rather than lingering as a thin page.
     */
    const [{ products, categories, brands }, landingPages] = await Promise.all([
      listAllActiveSlugs(),
      listVehicleLandingPages().catch(() => []),
    ]);
    return [
      ...staticRoutes,
      ...landingPages.map((p) => ({
        url: `${base}/parts/${encodeURIComponent(p.categorySlug)}/${encodeURIComponent(p.modelSlug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.75,
      })),
      ...categories.map((c) => ({
        url: `${base}/categories/${encodeURIComponent(c.slug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
      ...brands.map((b) => ({
        url: `${base}/brands/${encodeURIComponent(b.slug)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
      ...products.map((p) => ({
        url: `${base}/products/${encodeURIComponent(p.slug)}`,
        lastModified: p.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ];
  } catch {
    // A sitemap must never 500 the crawler; fall back to the static routes.
    return staticRoutes;
  }
}

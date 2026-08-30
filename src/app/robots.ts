import type { MetadataRoute } from 'next';
import { siteUrl } from '@/application/settings-service';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Transactional, personal and administrative surfaces are never indexed.
        disallow: ['/admin', '/account', '/cart', '/checkout', '/orders', '/api', '/payment', '/login', '/register', '/search'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

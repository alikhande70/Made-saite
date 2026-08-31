/**
 * Sitemap index.
 *
 * A route handler rather than Next's `sitemap.ts` convention, because the
 * convention produces one flat URL set and this needs an index pointing at
 * per-group chunk files. The protocol allows 50,000 URLs per file; a shop that
 * grows past that would silently emit an invalid sitemap under the convention,
 * whereas the index grows a chunk.
 */
import { NextResponse } from 'next/server';
import { renderSitemapIndex, sitemapIndex } from '@/application/search-visibility';
import { siteUrl } from '@/application/settings-service';
import { logEvent, reportError } from '@/lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const base = siteUrl();
  try {
    const entries = await sitemapIndex(base);
    logEvent('info', { event: 'seo.sitemap.generated', kind: 'index', entries: entries.length });
    return new NextResponse(renderSitemapIndex(entries), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        // Crawlers re-fetch on their own schedule; an hour keeps a busy shop
        // from regenerating this on every bot hit without going stale.
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    reportError(error, { event: 'seo.sitemap.failed', kind: 'index' });
    // Never 500 a crawler: an empty but valid index is recoverable, an error
    // page teaches the engine the sitemap is broken.
    return new NextResponse(renderSitemapIndex([]), {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

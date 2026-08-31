/**
 * One sitemap chunk, e.g. `/sitemaps/products-2.xml`.
 *
 * The file name is parsed by the domain rather than trusted: an unrecognised
 * group or a page number with a leading zero is a 404, so there is exactly one
 * URL per chunk and a crawler cannot generate infinite variants of it.
 */
import { NextResponse } from 'next/server';
import {
  countGroup, renderUrlSet, sitemapEntries,
} from '@/application/search-visibility';
import { parseSitemapFileName, sitemapPageCount } from '@/domain/search-visibility';
import { siteUrl } from '@/application/settings-service';
import { logEvent, reportError } from '@/lib/observability';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await ctx.params;
  const parsed = parseSitemapFileName(file);
  if (!parsed) return new NextResponse('Not found', { status: 404 });

  const base = siteUrl();
  try {
    // A page beyond the group's real extent is a 404 rather than an empty file,
    // so a crawler that guesses `products-999.xml` learns it does not exist.
    const total = await countGroup(parsed.group);
    if (parsed.page > sitemapPageCount(total)) {
      return new NextResponse('Not found', { status: 404 });
    }

    const entries = await sitemapEntries(parsed.group, parsed.page, base);
    logEvent('info', {
      event: 'seo.sitemap.generated',
      kind: 'chunk', group: parsed.group, page: parsed.page, entries: entries.length,
    });
    return new NextResponse(renderUrlSet(entries), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    reportError(error, { event: 'seo.sitemap.failed', kind: 'chunk', group: parsed.group });
    return new NextResponse(renderUrlSet([]), {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

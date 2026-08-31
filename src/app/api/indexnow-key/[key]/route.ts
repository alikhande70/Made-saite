/**
 * IndexNow key file.
 *
 * The protocol requires the key at `https://<host>/<key>.txt`, containing the
 * key and nothing else. Two approaches were rejected before this one:
 *
 *   - a root dynamic route (`app/[key]/route.ts`) swallows every unmatched root
 *     path and replaces the application's 404 page;
 *   - middleware makes Next compile an Edge bundle, which drags
 *     `instrumentation.ts` — and therefore `pg` — into a runtime that has no
 *     `fs`, breaking the production build.
 *
 * So a rewrite in `next.config.ts` maps `/{key}.txt` here, and this handler
 * decides. The rewrite's pattern requires 8–128 characters, which is the
 * protocol's own key length and conveniently cannot match `robots.txt`.
 *
 * The key is not secret in the sense a password is — the protocol publishes it
 * at a well-known URL by design, to prove host control — but it is still read
 * from the environment so a deployment can rotate it without a rebuild.
 */
import { NextResponse } from 'next/server';

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const configured = process.env.INDEXNOW_KEY;
  if (!configured || !KEY_PATTERN.test(configured)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { key } = await ctx.params;
  // Only the configured key is served. Any other name 404s, so this cannot be
  // used to probe whether a key is set.
  if (key !== configured) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(configured, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}

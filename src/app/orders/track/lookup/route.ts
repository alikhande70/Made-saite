/**
 * Server-side tracking lookup.
 *
 * Lets the tracking form work as a plain HTML GET form — no JavaScript
 * required — by resolving the token here and redirecting to the order page (or
 * back to the form with a Persian error). The client component layers a fetch
 * on top for a faster response, but the form is functional without it.
 *
 * The static `lookup` segment takes priority over `[token]`; tracking tokens
 * are 32 URL-safe random characters, so they can never collide with it.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getOrderByTrackingToken } from '@/application/order-service';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/session';
import { siteUrl } from '@/application/settings-service';

export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get('token') ?? '').trim().slice(0, 128);
  const base = siteUrl();

  if (!token) {
    return NextResponse.redirect(new URL('/orders/track?error=empty', base), 303);
  }

  const limit = await consumeRateLimit('trackingLookup', `ip:${await getClientIp()}`);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL('/orders/track?error=rate', base), 303);
  }

  const order = await getOrderByTrackingToken(token);
  if (!order) {
    return NextResponse.redirect(new URL('/orders/track?error=notfound', base), 303);
  }

  return NextResponse.redirect(new URL(`/orders/track/${encodeURIComponent(token)}`, base), 303);
}

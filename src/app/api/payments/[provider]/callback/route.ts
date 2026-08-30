/**
 * Gateway return / webhook endpoint.
 *
 * This URL is reachable by anyone, so it proves nothing on its own: the
 * provider adapter authenticates the result (signature or server-to-server
 * verification) and `handlePaymentCallback` re-checks the amount and the order's
 * current status before anything is settled. Repeat calls are idempotent.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { handlePaymentCallback } from '@/application/order-service';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/session';
import { siteUrl } from '@/application/settings-service';

function collect(request: NextRequest, extra: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { ...params, ...extra };
}

async function handle(request: NextRequest, providerId: string, extra: Record<string, string> = {}) {
  const limit = await consumeRateLimit('paymentCallback', `ip:${await getClientIp()}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'تعداد درخواست‌ها بیش از حد مجاز است.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  let result;
  try {
    result = await handlePaymentCallback(providerId, collect(request, extra));
  } catch (e) {
    console.error('[payments] callback failed:', e);
    return NextResponse.redirect(new URL('/orders/failed', siteUrl()), 303);
  }

  // Browsers arriving from the gateway are redirected to a human page; a
  // server-to-server webhook (no Accept: text/html) gets JSON instead.
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsHtml) {
    return NextResponse.json({ ok: result.outcome !== 'FAILED', outcome: result.outcome, message: result.message });
  }

  const target =
    result.outcome === 'SUCCEEDED' || result.outcome === 'ALREADY_SETTLED'
      ? `/orders/confirmation/${result.trackingToken}`
      : `/orders/failed?order=${encodeURIComponent(result.orderId ?? '')}&reason=${encodeURIComponent(result.message)}`;

  return NextResponse.redirect(new URL(target, siteUrl()), 303);
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return handle(request, provider);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  let body: Record<string, string> = {};
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      body = (await request.json()) as Record<string, string>;
    } else if (contentType.includes('form')) {
      const form = await request.formData();
      form.forEach((value, key) => {
        if (typeof value === 'string') body[key] = value;
      });
    }
  } catch {
    /* an unparseable body simply yields no extra params */
  }
  return handle(request, provider, body);
}

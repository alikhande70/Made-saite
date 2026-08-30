/**
 * Order placement. Every monetary figure is recomputed by the checkout service;
 * this handler only forwards the customer's *choices*.
 */
import type { NextRequest } from 'next/server';
import { checkoutSchema } from '@/lib/validation';
import { placeOrder } from '@/application/checkout-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { getAnonCartToken, getCurrentUser, rateLimitIdentity } from '@/lib/session';
import { consumeRateLimit } from '@/lib/rate-limit';
import { errors } from '@/domain/errors';
import { siteUrl } from '@/application/settings-service';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();

    const limit = await consumeRateLimit('checkout', await rateLimitIdentity(user));
    if (!limit.allowed) throw errors.rateLimited();

    const input = checkoutSchema.parse(await readJson(request));
    const anonToken = (await getAnonCartToken()) ?? null;

    const result = await placeOrder(
      user ? { userId: user.id } : { anonToken },
      input,
      { userId: user?.id ?? null, siteUrl: siteUrl() },
    );
    return jsonOk(result);
  } catch (e) {
    return jsonError(e);
  }
}

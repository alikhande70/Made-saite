/**
 * Cart mutations. Thin: validate → resolve identity → call the service.
 * No business logic lives in this file.
 */
import type { NextRequest } from 'next/server';
import { addToCartSchema, updateCartItemSchema, uuidSchema } from '@/lib/validation';
import { addToCart, getCartView, removeFromCart, updateCartQuantity } from '@/application/cart-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { ensureAnonCartToken, getAnonCartToken, getCurrentUser, rateLimitIdentity } from '@/lib/session';
import { consumeRateLimit } from '@/lib/rate-limit';
import { errors } from '@/domain/errors';
import type { AuthUser } from '@/application/auth-service';

/** Signed-in users own a user cart; guests get an httpOnly cookie-backed one. */
async function identity(create: boolean) {
  const user = await getCurrentUser();
  if (user) return { identity: { userId: user.id }, user };
  const anonToken = create ? await ensureAnonCartToken() : ((await getAnonCartToken()) ?? null);
  return { identity: { anonToken }, user: null };
}

async function guard(user: AuthUser | null) {
  const limit = await consumeRateLimit('cartWrite', await rateLimitIdentity(user));
  if (!limit.allowed) throw errors.rateLimited();
}

export async function GET() {
  try {
    const { identity: id } = await identity(false);
    return jsonOk(await getCartView(id));
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { identity: id, user } = await identity(true);
    await guard(user);
    const input = addToCartSchema.parse(await readJson(request));
    return jsonOk(await addToCart(id, input.productId, input.quantity));
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { identity: id, user } = await identity(false);
    await guard(user);
    const input = updateCartItemSchema.parse(await readJson(request));
    return jsonOk(await updateCartQuantity(id, input.productId, input.quantity));
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { identity: id, user } = await identity(false);
    await guard(user);
    const productId = uuidSchema.parse(new URL(request.url).searchParams.get('productId'));
    return jsonOk(await removeFromCart(id, productId));
  } catch (e) {
    return jsonError(e);
  }
}

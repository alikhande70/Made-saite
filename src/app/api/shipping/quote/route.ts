/** Live shipping prices for the checkout form. Read-only. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { provinceSchema } from '@/lib/validation';
import { quoteCheckout } from '@/application/checkout-service';
import { jsonError, jsonOk } from '@/lib/http';
import { getAnonCartToken, getCurrentUser } from '@/lib/session';

const querySchema = z.object({
  province: provinceSchema,
  method: z.string().trim().max(40).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const input = querySchema.parse({
      province: params.get('province'),
      method: params.get('method') ?? undefined,
    });

    const user = await getCurrentUser();
    const identity = user ? { userId: user.id } : { anonToken: (await getAnonCartToken()) ?? null };
    const quote = await quoteCheckout(identity, input.province, input.method ?? null);

    return jsonOk({
      shippingOptions: quote.shippingOptions,
      selectedShipping: quote.selectedShipping,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      shippingTotal: quote.shippingTotal,
      grandTotal: quote.grandTotal,
      itemCount: quote.cart.itemCount,
    });
  } catch (e) {
    return jsonError(e);
  }
}

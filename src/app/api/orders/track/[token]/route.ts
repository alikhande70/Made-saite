/**
 * Public order tracking by unguessable token. Returns only customer-visible
 * fields; internal events are filtered out by the service.
 */
import type { NextRequest } from 'next/server';
import { getOrderByTrackingToken } from '@/application/order-service';
import { jsonError, jsonOk } from '@/lib/http';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/session';
import { errors } from '@/domain/errors';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const limit = await consumeRateLimit('trackingLookup', `ip:${await getClientIp()}`);
    if (!limit.allowed) throw errors.rateLimited();

    const { token } = await ctx.params;
    const order = await getOrderByTrackingToken(token);
    if (!order) throw errors.notFound('سفارشی با این کد پیگیری یافت نشد.');

    return jsonOk({
      orderNumber: order.orderNumber,
      status: order.status,
      placedAt: order.placedAt,
      grandTotal: order.grandTotal,
      items: order.items.map((i) => ({ titleFa: i.titleFa, sku: i.sku, quantity: i.quantity })),
      shipment: order.shipment,
      events: order.events,
    });
  } catch (e) {
    return jsonError(e);
  }
}

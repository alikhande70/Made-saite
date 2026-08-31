/**
 * Order lifecycle, payment callbacks and the reservation sweeper.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { closePool, getDb } from '@/infrastructure/db/client';
import { orderEvents, orders, payments, sessions, shipments } from '@/infrastructure/db/schema';
import { addToCart } from '@/application/cart-service';
import { placeOrder } from '@/application/checkout-service';
import {
  cancelOrder, expireStaleOrders, getOrderByTrackingToken, getOrderForUser,
  handlePaymentCallback, listOrdersForUser, setShipmentTracking, settleCashPayment,
  transitionOrder, getDashboardSummary,
} from '@/application/order-service';
import { signMockCallback } from '@/application/payment/mock-provider';
import { DomainError } from '@/domain/errors';
import { createProduct, createShippingMethod, createUser, resetDatabase, stockOf } from '../helpers/factory';

const SITE = 'http://localhost:3000';
const address = {
  fullName: 'مریم احمدی', phone: '09121234567', province: 'تهران', city: 'تهران',
  postalAddress: 'خیابان نمونه، پلاک ۲۲', postalCode: '1234567890',
};

beforeEach(resetDatabase);
afterAll(closePool);

/** Places a one-line order and returns its identifiers plus the product. */
async function placeTestOrder(opts: { stock?: number; price?: number; qty?: number; userId?: string | null } = {}) {
  await createShippingMethod({ code: 'post', baseCost: 0 });
  const product = await createProduct({ stock: opts.stock ?? 5, price: opts.price ?? 1_000_000 });
  const identity = opts.userId ? { userId: opts.userId } : { anonToken: `t-${Math.random()}` };
  await addToCart(identity, product.id, opts.qty ?? 1);
  const result = await placeOrder(identity, { ...address, shippingMethodCode: 'post' },
    { userId: opts.userId ?? null, siteUrl: SITE });
  return { ...result, product };
}

/** Builds the signed sandbox-gateway return parameters for an order. */
async function callbackParams(orderId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED', amount: number) {
  const [row] = await getDb().select({ providerRef: payments.providerRef }).from(payments)
    .where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt)).limit(1);
  const ref = row!.providerRef!;
  return {
    order: orderId, ref, status: outcome, amount: String(amount),
    sig: signMockCallback(orderId, ref, outcome, amount),
  };
}

describe('successful payment', () => {
  it('marks the order paid, deducts stock and records an audit trail', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    const result = await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));

    expect(result.outcome).toBe('SUCCEEDED');
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PAID');
    expect(row!.paidAt).not.toBeNull();
    expect(row!.reservationExpiresAt).toBeNull();

    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(3);
    expect(s.quantityReserved).toBe(0);

    const [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('SUCCEEDED');
    expect(payment!.transactionId).toBeTruthy();

    const events = await getDb().select().from(orderEvents).where(eq(orderEvents.orderId, order.orderId));
    expect(events.map((e) => e.eventType)).toContain('PAYMENT_CONFIRMED');
  });

  it('is idempotent when the gateway retries the callback', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    const params = await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal);

    const first = await handlePaymentCallback('mock', params);
    const second = await handlePaymentCallback('mock', params);
    const third = await handlePaymentCallback('mock', params);

    expect(first.outcome).toBe('SUCCEEDED');
    expect(second.outcome).toBe('ALREADY_SETTLED');
    expect(third.outcome).toBe('ALREADY_SETTLED');

    // Stock must have been deducted exactly once.
    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(3);
    expect(s.quantityReserved).toBe(0);
  });

  it('settles only once under concurrent duplicate callbacks', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    const params = await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal);

    const results = await Promise.all([
      handlePaymentCallback('mock', params),
      handlePaymentCallback('mock', params),
    ]);
    expect(results.filter((r) => r.outcome === 'SUCCEEDED')).toHaveLength(1);

    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(3);
  });
});

describe('payment callback security', () => {
  it('rejects a forged callback with no signature', async () => {
    const order = await placeTestOrder();
    const result = await handlePaymentCallback('mock', {
      order: order.orderId, ref: 'MOCK-forged', status: 'SUCCEEDED', amount: String(order.grandTotal),
    });
    expect(result.outcome).toBe('FAILED');
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');
  });

  it('rejects a callback signed with the wrong secret', async () => {
    const order = await placeTestOrder();
    const params = await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal);
    const result = await handlePaymentCallback('mock', { ...params, sig: 'f'.repeat(64) });

    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('امضا');
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');
  });

  it('rejects a callback whose amount was tampered with', async () => {
    const order = await placeTestOrder({ price: 1_000_000 });
    // Correctly signed — but for 1 Toman instead of the order total.
    const params = await callbackParams(order.orderId, 'SUCCEEDED', 1);
    const result = await handlePaymentCallback('mock', params);

    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('مبلغ');
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');

    const events = await getDb().select().from(orderEvents).where(eq(orderEvents.orderId, order.orderId));
    expect(events.map((e) => e.eventType)).toContain('PAYMENT_AMOUNT_MISMATCH');
  });

  it('rejects a callback from a provider the order was not created with', async () => {
    const order = await placeTestOrder();
    await getDb().update(orders).set({ paymentProvider: 'cod' }).where(eq(orders.id, order.orderId));
    const result = await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    expect(result.outcome).toBe('FAILED');
    expect(result.message).toContain('مطابقت ندارد');
  });

  it('reports failure for an unknown order id without leaking whether it exists', async () => {
    const result = await handlePaymentCallback('mock', {
      order: '00000000-0000-0000-0000-000000000000', ref: 'x', status: 'SUCCEEDED', amount: '1', sig: 'y',
    });
    expect(result.outcome).toBe('FAILED');
  });
});

describe('failed payment', () => {
  it('leaves the order unpaid with its stock still reserved so the customer can retry', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    const result = await handlePaymentCallback('mock', await callbackParams(order.orderId, 'FAILED', order.grandTotal));

    expect(result.outcome).toBe('FAILED');
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');

    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(5);
    expect(s.quantityReserved).toBe(2);

    const [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('FAILED');
  });

  it('records a cancelled payment when the customer aborts at the gateway', async () => {
    const order = await placeTestOrder();
    const result = await handlePaymentCallback('mock', await callbackParams(order.orderId, 'CANCELLED', order.grandTotal));
    expect(result.outcome).toBe('CANCELLED');
    const [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('CANCELLED');
  });

  it('lets a retried payment succeed after an earlier failure', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 1 });
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'FAILED', order.grandTotal));
    const retry = await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    expect(retry.outcome).toBe('SUCCEEDED');
    expect((await stockOf(order.product.id)).quantityOnHand).toBe(4);
  });
});

describe('reservation expiry sweeper', () => {
  it('cancels expired unpaid orders and releases their stock', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 3 });
    await getDb().update(orders)
      .set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, order.orderId));

    expect(await expireStaleOrders()).toBe(1);

    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('CANCELLED');

    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(5);
    expect(s.quantityReserved).toBe(0);
  });

  it('leaves orders inside their payment window alone', async () => {
    const order = await placeTestOrder();
    expect(await expireStaleOrders()).toBe(0);
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');
  });

  it('is safe to run twice', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    await getDb().update(orders).set({ reservationExpiresAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, order.orderId));
    expect(await expireStaleOrders()).toBe(1);
    expect(await expireStaleOrders()).toBe(0);
    expect((await stockOf(order.product.id)).quantityReserved).toBe(0);
  });

  /*
   * The tests above prove `expireStaleOrders`. This one proves the job that
   * actually runs in production calls it.
   *
   * The production image contains neither `tsx` nor the `src` tree, so the
   * cron-driven `npm run db:sweep` cannot run inside a container at all. The
   * in-process scheduler is the only thing releasing stranded stock there, and
   * its failure mode is silent: the shop simply stops being able to sell items
   * that are sitting on the shelf.
   */
  it('runSweep releases stranded stock and prunes expired sessions', async () => {
    const { runSweep } = await import('@/lib/scheduler');
    const order = await placeTestOrder({ stock: 5, qty: 4 });
    await getDb().update(orders)
      .set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, order.orderId));

    // An expired session, which the same job is responsible for pruning.
    const user = await createUser('customer');
    await getDb().insert(sessions).values({
      userId: user.id,
      tokenHash: 'expired-session-token-hash-for-sweeper-test',
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(await runSweep()).toEqual({ cancelled: 1 });

    const stock = await stockOf(order.product.id);
    expect(stock.quantityReserved).toBe(0);
    expect(stock.quantityOnHand).toBe(5);

    const remaining = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('admin fulfilment flow', () => {
  it('walks paid → processing → packed → shipped → delivered', async () => {
    const admin = await createUser('admin');
    const order = await placeTestOrder({ stock: 5, qty: 1 });
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));

    for (const status of ['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] as const) {
      await transitionOrder(order.orderId, status, { actorType: 'admin', actorUserId: admin.id });
    }

    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('DELIVERED');

    const [shipment] = await getDb().select().from(shipments).where(eq(shipments.orderId, order.orderId));
    expect(shipment!.status).toBe('DELIVERED');
    expect(shipment!.shippedAt).not.toBeNull();
    expect(shipment!.deliveredAt).not.toBeNull();
  });

  it('refuses to skip the payment step', async () => {
    const order = await placeTestOrder();
    await expect(
      transitionOrder(order.orderId, 'SHIPPED', { actorType: 'admin' }),
    ).rejects.toThrow(DomainError);
    const [row] = await getDb().select().from(orders).where(eq(orders.id, order.orderId));
    expect(row!.status).toBe('PENDING_PAYMENT');
  });

  it('refuses to move a delivered order backwards', async () => {
    const order = await placeTestOrder();
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    for (const s of ['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] as const) {
      await transitionOrder(order.orderId, s, { actorType: 'admin' });
    }
    await expect(transitionOrder(order.orderId, 'PROCESSING', { actorType: 'admin' })).rejects.toThrow(DomainError);
  });

  it('stores a tracking code and exposes it to the customer', async () => {
    const admin = await createUser('admin');
    const order = await placeTestOrder();
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    await transitionOrder(order.orderId, 'PROCESSING', { actorType: 'admin', actorUserId: admin.id });
    await transitionOrder(order.orderId, 'PACKED', { actorType: 'admin', actorUserId: admin.id });
    const code = await setShipmentTracking(order.orderId, { carrier: 'پست پیشتاز', generate: true }, admin.id);
    await transitionOrder(order.orderId, 'SHIPPED', { actorType: 'admin', actorUserId: admin.id });

    expect(code).toMatch(/^\d{16}$/);
    const tracked = await getOrderByTrackingToken(order.trackingToken);
    expect(tracked!.shipment!.trackingCode).toBe(code);
    expect(tracked!.status).toBe('SHIPPED');
  });
});

describe('cancellation and refunds', () => {
  it('releases held stock when an unpaid order is cancelled', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    await cancelOrder(order.orderId, { actorType: 'customer', reason: 'انصراف مشتری' });

    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(5);
    expect(s.quantityReserved).toBe(0);
  });

  it('returns already-deducted stock when a paid order is cancelled', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 2 });
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    expect((await stockOf(order.product.id)).quantityOnHand).toBe(3);

    await cancelOrder(order.orderId, { actorType: 'admin' });
    const s = await stockOf(order.product.id);
    expect(s.quantityOnHand).toBe(5);
    expect(s.quantityReserved).toBe(0);
  });

  it('restocks and marks the payment refunded on a refund', async () => {
    const order = await placeTestOrder({ stock: 5, qty: 1 });
    await handlePaymentCallback('mock', await callbackParams(order.orderId, 'SUCCEEDED', order.grandTotal));
    await transitionOrder(order.orderId, 'REFUNDED', { actorType: 'admin' });

    expect((await stockOf(order.product.id)).quantityOnHand).toBe(5);
    const [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('REFUNDED');
  });

  it('refuses to cancel an already-cancelled order', async () => {
    const order = await placeTestOrder();
    await cancelOrder(order.orderId, { actorType: 'admin' });
    await expect(cancelOrder(order.orderId, { actorType: 'admin' })).rejects.toThrow(DomainError);
  });
});

describe('cash on delivery settlement', () => {
  it('keeps the payment outstanding until an admin settles it', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const product = await createProduct({ stock: 5, price: 500_000 });
    const identity = { anonToken: 'cod-1' };
    await addToCart(identity, product.id, 1);
    const order = await placeOrder(identity, { ...address, shippingMethodCode: 'post', paymentProvider: 'cod' },
      { userId: null, siteUrl: SITE });

    let [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('INITIATED');

    const admin = await createUser('admin');
    await settleCashPayment(order.orderId, admin.id);
    [payment] = await getDb().select().from(payments).where(eq(payments.orderId, order.orderId));
    expect(payment!.status).toBe('SUCCEEDED');

    await expect(settleCashPayment(order.orderId, admin.id)).rejects.toThrow(DomainError);
  });
});

describe('customer-facing reads', () => {
  it('hides internal notes from the public tracking page', async () => {
    const order = await placeTestOrder();
    await getDb().insert(orderEvents).values({
      orderId: order.orderId, eventType: 'INTERNAL_NOTE',
      message: 'یادداشت داخلی — نباید به مشتری نشان داده شود.', actorType: 'admin', isPublic: false,
    });

    const tracked = await getOrderByTrackingToken(order.trackingToken);
    expect(tracked!.events.every((e) => e.isPublic)).toBe(true);
    expect(JSON.stringify(tracked)).not.toContain('یادداشت داخلی');
  });

  it('returns nothing for an unknown tracking token', async () => {
    expect(await getOrderByTrackingToken('definitely-not-a-real-token')).toBeNull();
  });

  it('refuses to return another customer’s order (IDOR)', async () => {
    const owner = await createUser('customer', '09120001111');
    const stranger = await createUser('customer', '09120002222');
    const order = await placeTestOrder({ userId: owner.id });

    expect(await getOrderForUser(order.orderId, owner.id)).not.toBeNull();
    expect(await getOrderForUser(order.orderId, stranger.id)).toBeNull();
  });

  it('lists a customer’s own orders only', async () => {
    const a = await createUser('customer', '09120003333');
    const b = await createUser('customer', '09120004444');
    await placeTestOrder({ userId: a.id });
    await placeTestOrder({ userId: b.id });

    expect(await listOrdersForUser(a.id)).toHaveLength(1);
    expect(await listOrdersForUser(b.id)).toHaveLength(1);
  });
});

describe('dashboard aggregates', () => {
  it('counts orders by status and excludes unpaid ones from revenue', async () => {
    const paid = await placeTestOrder({ stock: 10, price: 1_000_000 });
    await handlePaymentCallback('mock', await callbackParams(paid.orderId, 'SUCCEEDED', paid.grandTotal));
    await placeTestOrder({ stock: 10, price: 2_000_000 }); // left unpaid

    const summary = await getDashboardSummary();
    expect(summary.totalOrders).toBe(2);
    expect(summary.byStatus.PAID).toBe(1);
    expect(summary.byStatus.PENDING_PAYMENT).toBe(1);
    expect(summary.revenueTotal).toBe(1_000_000);
    expect(summary.recentOrders).toHaveLength(2);
  });
});

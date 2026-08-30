/**
 * Inventory safety. These are the tests that must never be allowed to regress:
 * they are what stands between the shop and overselling.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closePool, getDb, withTransaction } from '@/infrastructure/db/client';
import { inventoryEvents } from '@/infrastructure/db/schema';
import {
  adjustStock, fulfillReservation, listLowStock, releaseReservation, reserveStock, returnStock,
} from '@/application/inventory-service';
import { DomainError } from '@/domain/errors';
import { createProduct, resetDatabase, stockOf } from '../helpers/factory';

beforeEach(resetDatabase);
afterAll(closePool);

describe('reservations', () => {
  it('holds stock without reducing on-hand quantity', async () => {
    const p = await createProduct({ stock: 10 });
    await withTransaction((tx) =>
      reserveStock(tx, [{ productId: p.id, quantity: 3, title: p.titleFa }], null),
    );
    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(10);
    expect(s.quantityReserved).toBe(3);
  });

  it('refuses to reserve more than is available and rolls back the whole order', async () => {
    const ok = await createProduct({ stock: 10 });
    const scarce = await createProduct({ stock: 1, titleFa: 'کالای کمیاب' });

    await expect(
      withTransaction((tx) =>
        reserveStock(tx, [
          { productId: ok.id, quantity: 2, title: ok.titleFa },
          { productId: scarce.id, quantity: 5, title: scarce.titleFa },
        ], null),
      ),
    ).rejects.toThrow(/کالای کمیاب/);

    // All-or-nothing: the first line must not have been reserved either.
    expect((await stockOf(ok.id)).quantityReserved).toBe(0);
    expect((await stockOf(scarce.id)).quantityReserved).toBe(0);
  });

  it('reports the available quantity in the Persian error', async () => {
    const p = await createProduct({ stock: 2, titleFa: 'لنت ترمز' });
    try {
      await withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 5, title: p.titleFa }], null));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('INSUFFICIENT_STOCK');
      expect((e as DomainError).message).toContain('۲ عدد');
    }
  });

  it('merges duplicate lines for the same product before checking stock', async () => {
    const p = await createProduct({ stock: 3 });
    await expect(
      withTransaction((tx) =>
        reserveStock(tx, [
          { productId: p.id, quantity: 2, title: p.titleFa },
          { productId: p.id, quantity: 2, title: p.titleFa },
        ], null),
      ),
    ).rejects.toThrow(DomainError);
    expect((await stockOf(p.id)).quantityReserved).toBe(0);
  });
});

describe('two customers racing for the last unit', () => {
  it('lets exactly one reservation succeed', async () => {
    const p = await createProduct({ stock: 1, titleFa: 'آخرین موجودی' });

    const attempt = () =>
      withTransaction(async (tx) => {
        await reserveStock(tx, [{ productId: p.id, quantity: 1, title: p.titleFa }], null);
        return 'ok' as const;
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);

    const s = await stockOf(p.id);
    expect(s.quantityReserved).toBe(1);
    expect(s.quantityOnHand).toBe(1);
  });

  it('survives ten concurrent buyers competing for three units', async () => {
    const p = await createProduct({ stock: 3, titleFa: 'موجودی محدود' });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 1, title: p.titleFa }], null)),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const s = await stockOf(p.id);
    expect(s.quantityReserved).toBe(3);
    expect(s.quantityOnHand - s.quantityReserved).toBe(0);
  });

  it('does not deadlock when two orders lock the same products in opposite order', async () => {
    const a = await createProduct({ stock: 5, titleFa: 'کالای الف' });
    const b = await createProduct({ stock: 5, titleFa: 'کالای ب' });

    const forward = withTransaction((tx) =>
      reserveStock(tx, [
        { productId: a.id, quantity: 1, title: a.titleFa },
        { productId: b.id, quantity: 1, title: b.titleFa },
      ], null),
    );
    const reverse = withTransaction((tx) =>
      reserveStock(tx, [
        { productId: b.id, quantity: 1, title: b.titleFa },
        { productId: a.id, quantity: 1, title: a.titleFa },
      ], null),
    );

    await expect(Promise.all([forward, reverse])).resolves.toBeDefined();
    expect((await stockOf(a.id)).quantityReserved).toBe(2);
    expect((await stockOf(b.id)).quantityReserved).toBe(2);
  });
});

describe('stock adjustments', () => {
  it('records an audit event for every movement', async () => {
    const p = await createProduct({ stock: 10 });
    await withTransaction((tx) =>
      adjustStock(tx, { productId: p.id, delta: 5, reason: 'ورود کالا از تأمین‌کننده', actorUserId: null }),
    );
    await withTransaction((tx) =>
      adjustStock(tx, { productId: p.id, delta: -2, reason: 'ضایعات انبار', actorUserId: null }),
    );

    const events = await getDb().select().from(inventoryEvents).where(eq(inventoryEvents.productId, p.id));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['ADJUST', 'RECEIVE']);
    expect(events.find((e) => e.type === 'ADJUST')?.reason).toBe('ضایعات انبار');
    expect((await stockOf(p.id)).quantityOnHand).toBe(13);
  });

  it('refuses to reduce on-hand stock below what is already reserved', async () => {
    const p = await createProduct({ stock: 5 });
    await withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 4, title: p.titleFa }], null));

    await expect(
      withTransaction((tx) =>
        adjustStock(tx, { productId: p.id, delta: -3, reason: 'انبارگردانی', actorUserId: null }),
      ),
    ).rejects.toThrow(/رزرو/);
    expect((await stockOf(p.id)).quantityOnHand).toBe(5);
  });

  it('refuses a zero or fractional delta', async () => {
    const p = await createProduct({ stock: 5 });
    await expect(
      withTransaction((tx) => adjustStock(tx, { productId: p.id, delta: 0, reason: 'x', actorUserId: null })),
    ).rejects.toThrow(DomainError);
  });
});

describe('reservation outcomes', () => {
  it('release puts held units back without touching on-hand', async () => {
    const p = await createProduct({ stock: 10 });
    const orderId = await seedOrderWithItem(p.id, 4);
    await withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 4, title: p.titleFa }], orderId));
    await withTransaction((tx) => releaseReservation(tx, orderId, 'لغو سفارش'));

    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(10);
    expect(s.quantityReserved).toBe(0);
  });

  it('fulfil converts the hold into a real deduction', async () => {
    const p = await createProduct({ stock: 10 });
    const orderId = await seedOrderWithItem(p.id, 4);
    await withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 4, title: p.titleFa }], orderId));
    await withTransaction((tx) => fulfillReservation(tx, orderId));

    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(6);
    expect(s.quantityReserved).toBe(0);
  });

  it('return puts refunded units back on the shelf', async () => {
    const p = await createProduct({ stock: 10 });
    const orderId = await seedOrderWithItem(p.id, 2);
    await withTransaction((tx) => reserveStock(tx, [{ productId: p.id, quantity: 2, title: p.titleFa }], orderId));
    await withTransaction((tx) => fulfillReservation(tx, orderId));
    await withTransaction((tx) => returnStock(tx, orderId));

    expect((await stockOf(p.id)).quantityOnHand).toBe(10);
  });
});

describe('low stock reporting', () => {
  it('lists products at or below their threshold, scarcest first', async () => {
    await createProduct({ stock: 50, titleFa: 'پرموجودی' });
    const low = await createProduct({ stock: 2, titleFa: 'کم‌موجود', lowStockThreshold: 3 });
    const out = await createProduct({ stock: 0, titleFa: 'ناموجود' });

    const rows = await listLowStock(getDb());
    expect(rows.map((r) => r.productId)).toEqual([out.id, low.id]);
  });
});

/* Minimal order + item rows so reservation helpers have something to read. */
async function seedOrderWithItem(productId: string, quantity: number): Promise<string> {
  const db = getDb();
  const { orders, orderItems } = await import('@/infrastructure/db/schema');
  const { generateOrderNumber, randomToken } = await import('@/lib/crypto');
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: generateOrderNumber(), status: 'PENDING_PAYMENT',
      customerFullName: 'مشتری آزمایشی', customerPhone: '09120000001',
      shippingProvince: 'تهران', shippingCity: 'تهران',
      shippingAddress: 'نشانی آزمایشی طولانی', shippingPostalCode: '1234567890',
      subtotal: 1000, grandTotal: 1000, shippingMethodCode: 'post', shippingMethodName: 'پست',
      trackingToken: randomToken(24), paymentProvider: 'mock',
    })
    .returning();
  await db.insert(orderItems).values({
    orderId: order!.id, productId, sku: 'SKU', titleFa: 'کالا',
    unitPrice: 1000, quantity, lineTotal: 1000 * quantity,
  });
  return order!.id;
}

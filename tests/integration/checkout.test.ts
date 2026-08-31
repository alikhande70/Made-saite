/**
 * Checkout: server-side pricing, stock validation and the immutable order
 * snapshot. The recurring theme is that nothing the client sends about money is
 * believed.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closePool, getDb } from '@/infrastructure/db/client';
import { orderItems, orders, products } from '@/infrastructure/db/schema';
import { addToCart, getCartView } from '@/application/cart-service';
import { placeOrder, quoteCheckout } from '@/application/checkout-service';
import { DomainError } from '@/domain/errors';
import { createProduct, createShippingMethod, createUser, resetDatabase, stockOf } from '../helpers/factory';

const SITE = 'http://localhost:3000';

const address = {
  fullName: 'علی رضایی',
  phone: '09123456789',
  province: 'تهران',
  city: 'تهران',
  postalAddress: 'خیابان نمونه، کوچهٔ آزمایش، پلاک ۱۰',
  postalCode: '1234567890',
};

beforeEach(resetDatabase);
afterAll(closePool);

describe('checkout quote', () => {
  it('prices the cart and lists shipping options for the destination', async () => {
    await createShippingMethod({ code: 'post', nameFa: 'پست پیشتاز', baseCost: 85_000, perKgCost: 18_000 });
    await createShippingMethod({ code: 'courier', nameFa: 'پیک تهران', baseCost: 95_000, availableProvinces: ['تهران'], sortOrder: 1 });
    await createShippingMethod({ code: 'shiraz-only', nameFa: 'ویژه فارس', baseCost: 10_000, availableProvinces: ['فارس'] });

    const p = await createProduct({ price: 1_000_000, salePrice: 850_000, stock: 5, weightGrams: 1_200 });
    const identity = { anonToken: 'guest-1' };
    await addToCart(identity, p.id, 2);

    const quote = await quoteCheckout(identity, 'تهران', 'post');
    expect(quote.subtotal).toBe(1_700_000);
    expect(quote.discountTotal).toBe(300_000);
    expect(quote.shippingOptions.map((o) => o.methodCode).sort()).toEqual(['courier', 'post']);
    // 2 × 1200g = 2.4kg → 3 billable kg
    expect(quote.selectedShipping?.cost).toBe(85_000 + 18_000 * 3);
    expect(quote.grandTotal).toBe(1_700_000 + 139_000);
  });
});

describe('placing an order', () => {
  it('computes every total server-side and snapshots the line items', async () => {
    await createShippingMethod({ code: 'post', baseCost: 85_000, perKgCost: 0 });
    const p = await createProduct({ titleFa: 'لنت ترمز جلو', price: 1_000_000, salePrice: 850_000, stock: 5, weightGrams: 1_000 });
    const identity = { anonToken: 'guest-2' };
    await addToCart(identity, p.id, 2);

    const result = await placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE });

    expect(result.orderNumber).toMatch(/^MS-/);
    expect(result.grandTotal).toBe(1_700_000 + 85_000);
    expect(result.requiresPayment).toBe(true);
    expect(result.redirectUrl).toContain('/payment/sandbox');

    const [order] = await getDb().select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.status).toBe('PENDING_PAYMENT');
    expect(order!.subtotal).toBe(1_700_000);
    expect(order!.shippingTotal).toBe(85_000);
    expect(order!.grandTotal).toBe(1_785_000);
    expect(order!.reservationExpiresAt).not.toBeNull();

    const items = await getDb().select().from(orderItems).where(eq(orderItems.orderId, result.orderId));
    expect(items).toHaveLength(1);
    expect(items[0]!.unitPrice).toBe(850_000);
    expect(items[0]!.titleFa).toBe('لنت ترمز جلو');
    expect(items[0]!.lineTotal).toBe(1_700_000);
  });

  it('reserves stock and empties the cart', async () => {
    await createShippingMethod({ code: 'post' });
    const p = await createProduct({ stock: 5 });
    const identity = { anonToken: 'guest-3' };
    await addToCart(identity, p.id, 2);

    await placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE });

    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(5);
    expect(s.quantityReserved).toBe(2);
    expect((await getCartView(identity)).lines).toHaveLength(0);
  });

  it('keeps the order snapshot immutable when the product price later changes', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ price: 1_000_000, stock: 5 });
    const identity = { anonToken: 'guest-4' };
    await addToCart(identity, p.id, 1);
    const result = await placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE });

    await getDb().update(products).set({ price: 9_999_000 }).where(eq(products.id, p.id));

    const items = await getDb().select().from(orderItems).where(eq(orderItems.orderId, result.orderId));
    expect(items[0]!.unitPrice).toBe(1_000_000);
    const [order] = await getDb().select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.grandTotal).toBe(1_000_000);
  });

  it('charges the price at submit time, not the price the cart page rendered', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ price: 1_000_000, stock: 5 });
    const identity = { anonToken: 'guest-5' };
    await addToCart(identity, p.id, 1);

    // A sale starts between the cart page render and the submit.
    await getDb().update(products).set({ salePrice: 700_000 }).where(eq(products.id, p.id));

    const result = await placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE });
    expect(result.grandTotal).toBe(700_000);
  });

  it('rejects a shipping method that does not serve the destination province', async () => {
    await createShippingMethod({ code: 'courier', nameFa: 'پیک تهران', availableProvinces: ['تهران'] });
    const p = await createProduct({ stock: 5 });
    const identity = { anonToken: 'guest-6' };
    await addToCart(identity, p.id, 1);

    await expect(
      placeOrder(identity, { ...address, province: 'فارس', city: 'شیراز', shippingMethodCode: 'courier' },
        { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(/در دسترس نیست/);
    expect(await getDb().select().from(orders)).toHaveLength(0);
  });

  it('rejects an unknown shipping method code', async () => {
    await createShippingMethod({ code: 'post' });
    const p = await createProduct({ stock: 5 });
    const identity = { anonToken: 'guest-7' };
    await addToCart(identity, p.id, 1);
    await expect(
      placeOrder(identity, { ...address, shippingMethodCode: 'free-shipping-hack' }, { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(DomainError);
  });

  it('refuses to place an order for an empty cart', async () => {
    await createShippingMethod({ code: 'post' });
    await expect(
      placeOrder({ anonToken: 'guest-8' }, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(/سبد خرید/);
  });

  it('refuses to sell a product deactivated after it entered the cart', async () => {
    await createShippingMethod({ code: 'post' });
    const p = await createProduct({ titleFa: 'کالای حذف‌شده', stock: 5 });
    const identity = { anonToken: 'guest-9' };
    await addToCart(identity, p.id, 1);
    await getDb().update(products).set({ isActive: false }).where(eq(products.id, p.id));

    await expect(
      placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(/کالای حذف‌شده/);
    expect(await getDb().select().from(orders)).toHaveLength(0);
  });

  it('refuses to place an order when stock ran out after the cart was filled', async () => {
    await createShippingMethod({ code: 'post' });
    const p = await createProduct({ titleFa: 'کالای تمام‌شده', stock: 2 });
    const identity = { anonToken: 'guest-10' };
    await addToCart(identity, p.id, 2);

    const { withTransaction } = await import('@/infrastructure/db/client');
    const { adjustStock } = await import('@/application/inventory-service');
    await withTransaction((tx) => adjustStock(tx, { productId: p.id, delta: -2, reason: 'ضایعات', actorUserId: null }));

    await expect(
      placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(/کالای تمام‌شده/);
    expect(await getDb().select().from(orders)).toHaveLength(0);
  });

  it('links the order to a signed-in customer', async () => {
    await createShippingMethod({ code: 'post' });
    const user = await createUser('customer');
    const p = await createProduct({ stock: 5 });
    const identity = { userId: user.id };
    await addToCart(identity, p.id, 1);

    const result = await placeOrder(identity, { ...address, shippingMethodCode: 'post' }, { userId: user.id, siteUrl: SITE });
    const [order] = await getDb().select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.userId).toBe(user.id);
  });

  it('gives cash-on-delivery orders no payment redirect and no reservation TTL', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ price: 500_000, stock: 5 });
    const identity = { anonToken: 'guest-11' };
    await addToCart(identity, p.id, 1);

    const result = await placeOrder(
      identity, { ...address, shippingMethodCode: 'post', paymentProvider: 'cod' },
      { userId: null, siteUrl: SITE },
    );

    expect(result.requiresPayment).toBe(false);
    expect(result.redirectUrl).toContain('/orders/confirmation/');

    const [order] = await getDb().select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.status).toBe('PAID');           // confirmed, collect on delivery
    expect(order!.reservationExpiresAt).toBeNull();

    // Stock is deducted for real once the order is confirmed.
    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(4);
    expect(s.quantityReserved).toBe(0);
  });

  it('rejects an unconfigured payment gateway instead of falling back to sandbox', async () => {
    await createShippingMethod({ code: 'post' });
    const p = await createProduct({ stock: 5 });
    const identity = { anonToken: 'guest-12' };
    await addToCart(identity, p.id, 1);

    await expect(
      placeOrder(identity, { ...address, shippingMethodCode: 'post', paymentProvider: 'zarinpal' },
        { userId: null, siteUrl: SITE }),
    ).rejects.toThrow(/در دسترس نیست/);
  });
});

describe('two customers checking out the last unit at the same time', () => {
  it('creates exactly one order and never oversells', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ titleFa: 'آخرین قطعه', stock: 1, price: 1_000_000 });

    await addToCart({ anonToken: 'racer-a' }, p.id, 1);
    await addToCart({ anonToken: 'racer-b' }, p.id, 1);

    const results = await Promise.allSettled([
      placeOrder({ anonToken: 'racer-a' }, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
      placeOrder({ anonToken: 'racer-b' }, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const allOrders = await getDb().select().from(orders);
    expect(allOrders).toHaveLength(1);

    const s = await stockOf(p.id);
    expect(s.quantityOnHand).toBe(1);
    expect(s.quantityReserved).toBe(1);
  });
});

describe('one customer submitting checkout twice (double-click)', () => {
  /**
   * The reliability case the two-customer race does not cover.
   *
   * Two racers competing for the *last* unit are separated by the inventory
   * lock. One customer double-clicking «ثبت سفارش» on a well-stocked product
   * has no such contention: both transactions read the same cart, both find
   * stock available, and both would happily create an order — leaving the
   * customer with two orders and twice the stock reserved.
   */
  it('creates exactly one order and reserves stock once', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ titleFa: 'قطعهٔ پرموجودی', stock: 50, price: 1_000_000 });
    await addToCart({ anonToken: 'double-clicker' }, p.id, 2);

    const submit = () =>
      placeOrder(
        { anonToken: 'double-clicker' },
        { ...address, shippingMethodCode: 'post' },
        { userId: null, siteUrl: SITE },
      );

    const results = await Promise.allSettled([submit(), submit()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const allOrders = await getDb().select().from(orders);
    expect(allOrders, 'a double-click must not produce two orders').toHaveLength(1);

    const s = await stockOf(p.id);
    expect(s.quantityReserved, 'stock must be reserved once, not twice').toBe(2);
  });

  it('is still idempotent when the two submits are sequential', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ titleFa: 'قطعه', stock: 50, price: 1_000_000 });
    await addToCart({ anonToken: 'resubmitter' }, p.id, 1);

    await placeOrder({ anonToken: 'resubmitter' }, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE });

    // The browser's back button and a resubmitted form both look like this.
    await expect(
      placeOrder({ anonToken: 'resubmitter' }, { ...address, shippingMethodCode: 'post' }, { userId: null, siteUrl: SITE }),
    ).rejects.toThrow();

    expect(await getDb().select().from(orders)).toHaveLength(1);
    expect((await stockOf(p.id)).quantityReserved).toBe(1);
  });

  it('survives eight simultaneous submits of the same cart', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const p = await createProduct({ titleFa: 'قطعه', stock: 100, price: 1_000_000 });
    await addToCart({ anonToken: 'spammer' }, p.id, 3);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        placeOrder(
          { anonToken: 'spammer' },
          { ...address, shippingMethodCode: 'post' },
          { userId: null, siteUrl: SITE },
        )),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await getDb().select().from(orders)).toHaveLength(1);
    expect((await stockOf(p.id)).quantityReserved).toBe(3);
  });
});

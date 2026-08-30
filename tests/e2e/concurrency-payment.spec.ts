/**
 * Critical flow 3: two customers race for the last unit — no overselling.
 * Critical flow 4: payment failure leaves order and inventory correct.
 */
import { expect, test } from '@playwright/test';
import { CHECKOUT_ADDRESS, query, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('concurrency') });

/** Reduces a product's stock to exactly one available unit. */
async function makeLastUnit(): Promise<{ id: string; slug: string; titleFa: string }> {
  const rows = await query<{ id: string; slug: string; title_fa: string }>(
    `select p.id, p.slug, p.title_fa from products p
     join inventory i on i.product_id = p.id
     where p.is_active and i.quantity_reserved = 0 and i.quantity_on_hand > 1
     order by i.quantity_on_hand asc limit 1`,
  );
  const product = rows[0]!;
  await query(`update inventory set quantity_on_hand = 1, quantity_reserved = 0 where product_id = $1`, [product.id]);
  return { id: product.id, slug: product.slug, titleFa: product.title_fa };
}

test.describe('inventory safety under concurrency', () => {
  test('two customers checking out the last unit produce exactly one order', async ({ browser }) => {
    const product = await makeLastUnit();

    // Two independent browser contexts = two independent guest carts.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const [apiA, apiB] = [contextA.request, contextB.request];

    await apiA.post('/api/cart/items', { data: { productId: product.id, quantity: 1 } });
    await apiB.post('/api/cart/items', { data: { productId: product.id, quantity: 1 } });

    const payload = { ...CHECKOUT_ADDRESS, shippingMethodCode: 'post-pishtaz' };
    const [resA, resB] = await Promise.all([
      apiA.post('/api/checkout', { data: payload }),
      apiB.post('/api/checkout', { data: payload }),
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const loser = resA.status() === 200 ? resB : resA;
    const loserBody = (await loser.json()) as { message: string };
    expect(loserBody.message).toMatch(/موجودی|ناموجود|پایان/);

    const orders = await query<{ n: string }>(
      `select count(*)::text as n from orders o
       join order_items oi on oi.order_id = o.id
       where oi.product_id = $1 and o.status <> 'CANCELLED'`,
      [product.id],
    );
    expect(Number(orders[0]!.n)).toBe(1);

    const stock = await query<{ quantity_on_hand: number; quantity_reserved: number }>(
      `select quantity_on_hand, quantity_reserved from inventory where product_id = $1`, [product.id],
    );
    // Never oversold: reserved can never exceed on-hand.
    expect(stock[0]!.quantity_reserved).toBeLessThanOrEqual(stock[0]!.quantity_on_hand);
    expect(stock[0]!.quantity_reserved).toBe(1);

    await contextA.close();
    await contextB.close();
  });

  test('the second customer sees the product as unavailable afterwards', async ({ browser }) => {
    const product = await makeLastUnit();

    const buyer = await browser.newContext();
    await buyer.request.post('/api/cart/items', { data: { productId: product.id, quantity: 1 } });
    const placed = await buyer.request.post('/api/checkout', {
      data: { ...CHECKOUT_ADDRESS, shippingMethodCode: 'post-pishtaz' },
    });
    expect(placed.status()).toBe(200);

    const browsing = await buyer.newPage();
    await browsing.goto(`/products/${encodeURIComponent(product.slug)}`);
    await expect(browsing.getByText('ناموجود').first()).toBeVisible();

    await buyer.close();
  });
});

test.describe('payment failure', () => {
  test('a failed payment leaves the order unpaid and the stock still reserved', async ({ page, request }) => {
    const rows = await query<{ id: string }>(
      `select p.id from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 2 limit 1`,
    );
    const productId = rows[0]!.id;

    const before = await query<{ quantity_on_hand: number; quantity_reserved: number }>(
      `select quantity_on_hand, quantity_reserved from inventory where product_id = $1`, [productId],
    );

    await request.post('/api/cart/items', { data: { productId, quantity: 2 } });
    const checkout = await request.post('/api/checkout', {
      data: { ...CHECKOUT_ADDRESS, shippingMethodCode: 'post-pishtaz' },
    });
    const { data: order } = (await checkout.json()) as { data: { orderId: string; redirectUrl: string } };

    // Fail the payment at the sandbox gateway.
    await page.goto(order.redirectUrl);
    await page.getByRole('link', { name: 'پرداخت ناموفق' }).click();
    await page.waitForURL(/\/orders\/failed/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('پرداخت ناموفق بود');

    const orderRow = await query<{ status: string }>(`select status from orders where id = $1`, [order.orderId]);
    expect(orderRow[0]!.status).toBe('PENDING_PAYMENT');

    const payment = await query<{ status: string }>(
      `select status from payments where order_id = $1 order by created_at desc limit 1`, [order.orderId],
    );
    expect(payment[0]!.status).toBe('FAILED');

    // On-hand unchanged; the units stay reserved so the customer can retry.
    const after = await query<{ quantity_on_hand: number; quantity_reserved: number }>(
      `select quantity_on_hand, quantity_reserved from inventory where product_id = $1`, [productId],
    );
    expect(after[0]!.quantity_on_hand).toBe(before[0]!.quantity_on_hand);
    expect(after[0]!.quantity_reserved).toBe(before[0]!.quantity_reserved + 2);
  });

  test('a forged payment callback cannot mark an order paid', async ({ request }) => {
    const rows = await query<{ id: string }>(
      `select p.id from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0 limit 1`,
    );
    await request.post('/api/cart/items', { data: { productId: rows[0]!.id, quantity: 1 } });
    const checkout = await request.post('/api/checkout', {
      data: { ...CHECKOUT_ADDRESS, shippingMethodCode: 'post-pishtaz' },
    });
    const { data: order } = (await checkout.json()) as { data: { orderId: string; grandTotal: number } };

    // Correct shape, invalid signature.
    await request.get(
      `/api/payments/mock/callback?order=${order.orderId}&ref=MOCK-forged&status=SUCCEEDED` +
      `&amount=${order.grandTotal}&sig=${'0'.repeat(64)}`,
    );

    const status = await query<{ status: string }>(`select status from orders where id = $1`, [order.orderId]);
    expect(status[0]!.status).toBe('PENDING_PAYMENT');
  });
});

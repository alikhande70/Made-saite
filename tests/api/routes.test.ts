/**
 * HTTP-boundary tests: validation, CSRF, authorization, rate limiting and error
 * shape. These run the real route handlers, not a re-implementation.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ctx, makeRequest, readResponse, resetContext, signIn, signOut } from '../helpers/api';
import { closePool, getDb } from '@/infrastructure/db/client';
import { createProduct, createShippingMethod, createUser, createVehicle, resetDatabase, stockOf } from '../helpers/factory';
import { eq } from 'drizzle-orm';
import { products } from '@/infrastructure/db/schema';

beforeEach(async () => {
  await resetDatabase();
  resetContext();
});
afterAll(closePool);

/* ── cart ─────────────────────────────────────────────────────────────── */

describe('POST /api/cart/items', () => {
  it('adds a product to a guest cart and mints a cart cookie', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const product = await createProduct({ stock: 5, price: 1_000_000 });

    const res = await readResponse(
      await POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 2 } }) as never),
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(ctx.cookies.get('ms_cart')).toBeTruthy();
    expect((res.body.data as { subtotal: number }).subtotal).toBe(2_000_000);
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const product = await createProduct({ stock: 5 });

    const res = await readResponse(
      await POST(makeRequest('/api/cart/items', {
        method: 'POST',
        origin: 'https://evil.example',
        body: { productId: product.id, quantity: 1 },
      }) as never),
    );

    expect(res.status).toBe(403);
  });

  it('rejects a malformed product id with a Persian validation error', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const res = await readResponse(
      await POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: 'not-a-uuid', quantity: 1 } }) as never),
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fields?.productId).toMatch(/[؀-ۿ]/);
  });

  it('rejects a quantity above the per-line cap', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const product = await createProduct({ stock: 100 });
    const res = await readResponse(
      await POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 999 } }) as never),
    );
    expect(res.status).toBe(422);
  });

  it('reports insufficient stock as 409 with a Persian message', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const product = await createProduct({ titleFa: 'کالای کمیاب', stock: 1 });
    const res = await readResponse(
      await POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 3 } }) as never),
    );
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('کالای کمیاب');
  });

  it('returns 422 for a body that is not JSON', async () => {
    const { POST } = await import('@/app/api/cart/items/route');
    const request = new Request('http://localhost:3000/api/cart/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: 'not json at all',
    });
    const res = await readResponse(await POST(request as never));
    expect(res.status).toBe(422);
  });
});

/* ── checkout ─────────────────────────────────────────────────────────── */

describe('POST /api/checkout', () => {
  const address = {
    fullName: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', province: 'تهران', city: 'تهران',
    postalAddress: 'خیابان نمونه، پلاک ۱۰', postalCode: '۱۲۳۴۵۶۷۸۹۰',
  };

  async function fillCart(productId: string, quantity = 1) {
    const { POST } = await import('@/app/api/cart/items/route');
    await POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId, quantity } }) as never);
  }

  it('places an order and normalises Persian digits in the address', async () => {
    await createShippingMethod({ code: 'post', baseCost: 85_000, perKgCost: 0 });
    const product = await createProduct({ stock: 5, price: 1_000_000 });
    await fillCart(product.id, 2);

    const { POST } = await import('@/app/api/checkout/route');
    const res = await readResponse<{ orderNumber: string; grandTotal: number }>(
      await POST(makeRequest('/api/checkout', {
        method: 'POST',
        body: { ...address, shippingMethodCode: 'post' },
      }) as never),
    );

    expect(res.status).toBe(200);
    expect(res.body.data!.grandTotal).toBe(2_085_000);

    const { orders } = await import('@/infrastructure/db/schema');
    const [order] = await getDb().select().from(orders);
    expect(order!.customerPhone).toBe('09123456789');
    expect(order!.shippingPostalCode).toBe('1234567890');
  });

  it('ignores any price the client tries to send', async () => {
    await createShippingMethod({ code: 'post', baseCost: 85_000, perKgCost: 0 });
    const product = await createProduct({ stock: 5, price: 1_000_000 });
    await fillCart(product.id, 1);

    const { POST } = await import('@/app/api/checkout/route');
    const res = await readResponse<{ grandTotal: number }>(
      await POST(makeRequest('/api/checkout', {
        method: 'POST',
        body: {
          ...address, shippingMethodCode: 'post',
          // Hostile extras — none of these may influence the charge.
          grandTotal: 1, subtotal: 1, shippingTotal: 0, price: 1, discountTotal: 999_999_999,
        },
      }) as never),
    );

    expect(res.status).toBe(200);
    expect(res.body.data!.grandTotal).toBe(1_085_000);
  });

  it('rejects an invalid province', async () => {
    await createShippingMethod({ code: 'post' });
    const product = await createProduct({ stock: 5 });
    await fillCart(product.id, 1);

    const { POST } = await import('@/app/api/checkout/route');
    const res = await readResponse(
      await POST(makeRequest('/api/checkout', {
        method: 'POST',
        body: { ...address, province: 'Tehran', shippingMethodCode: 'post' },
      }) as never),
    );
    expect(res.status).toBe(422);
    expect(res.body.fields?.province).toContain('استان');
  });

  it('rejects an empty cart', async () => {
    await createShippingMethod({ code: 'post' });
    const { POST } = await import('@/app/api/checkout/route');
    const res = await readResponse(
      await POST(makeRequest('/api/checkout', { method: 'POST', body: { ...address, shippingMethodCode: 'post' } }) as never),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CART_EMPTY');
  });
});

/* ── auth ─────────────────────────────────────────────────────────────── */

describe('auth routes', () => {
  it('registers, sets a session cookie and merges the guest cart', async () => {
    const product = await createProduct({ stock: 5 });
    const cart = await import('@/app/api/cart/items/route');
    await cart.POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 2 } }) as never);
    expect(ctx.cookies.get('ms_cart')).toBeTruthy();

    const { POST } = await import('@/app/api/auth/register/route');
    const res = await readResponse(
      await POST(makeRequest('/api/auth/register', {
        method: 'POST',
        body: { fullName: 'زهرا کریمی', phone: '09121112233', password: 'Password@123' },
      }) as never),
    );

    expect(res.status).toBe(201);
    expect(ctx.cookies.get('ms_session')).toBeTruthy();
    expect(ctx.cookies.get('ms_cart')).toBeUndefined();

    const { getCartItemCount } = await import('@/application/cart-service');
    const { resolveSession } = await import('@/application/auth-service');
    const user = await resolveSession(ctx.cookies.get('ms_session'));
    expect(await getCartItemCount({ userId: user!.id })).toBe(2);
  });

  it('rejects a weak password with a Persian message', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await readResponse(
      await POST(makeRequest('/api/auth/register', {
        method: 'POST',
        body: { fullName: 'کاربر آزمایشی', phone: '09121112244', password: 'weak' },
      }) as never),
    );
    expect(res.status).toBe(422);
    expect(res.body.fields?.password).toContain('رمز عبور');
  });

  it('rate limits repeated failed logins', async () => {
    const { POST: register } = await import('@/app/api/auth/register/route');
    await register(makeRequest('/api/auth/register', {
      method: 'POST',
      body: { fullName: 'کاربر آزمایشی', phone: '09121112255', password: 'Password@123' },
    }) as never);

    const { POST: login } = await import('@/app/api/auth/login/route');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await readResponse(
        await login(makeRequest('/api/auth/login', {
          method: 'POST',
          body: { phone: '09121112255', password: 'WrongPassword1' },
        }) as never),
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });

  it('signs out and clears the session cookie', async () => {
    const user = await createUser('customer');
    await signIn(user.id);
    const { POST } = await import('@/app/api/auth/logout/route');
    const res = await readResponse(await POST(makeRequest('/api/auth/logout', { method: 'POST' }) as never));
    expect(res.status).toBe(200);
    expect(ctx.cookies.get('ms_session')).toBeUndefined();
  });
});

/* ── authorization ────────────────────────────────────────────────────── */

describe('admin route authorization', () => {
  it('refuses an anonymous caller with 401', async () => {
    const { GET } = await import('@/app/api/admin/products/route');
    const res = await readResponse(await GET(makeRequest('/api/admin/products') as never, undefined as never));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a signed-in customer with 403, not 404', async () => {
    const customer = await createUser('customer');
    await signIn(customer.id);

    const { GET } = await import('@/app/api/admin/products/route');
    const res = await readResponse(await GET(makeRequest('/api/admin/products') as never, undefined as never));
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('مدیران');
  });

  it('allows an admin', async () => {
    const admin = await createUser('admin');
    await signIn(admin.id);

    const { GET } = await import('@/app/api/admin/products/route');
    const res = await readResponse(await GET(makeRequest('/api/admin/products') as never, undefined as never));
    expect(res.status).toBe(200);
  });

  it('refuses a customer trying to change stock', async () => {
    const customer = await createUser('customer');
    const product = await createProduct({ stock: 5 });
    await signIn(customer.id);

    const { POST } = await import('@/app/api/admin/inventory/route');
    const res = await readResponse(
      await POST(makeRequest('/api/admin/inventory', {
        method: 'POST',
        body: { productId: product.id, delta: 1000, reason: 'تلاش غیرمجاز' },
      }) as never, undefined as never),
    );

    expect(res.status).toBe(403);
    expect((await stockOf(product.id)).quantityOnHand).toBe(5);
  });

  it('refuses a customer trying to advance an order', async () => {
    const customer = await createUser('customer');
    await signIn(customer.id);

    const { POST } = await import('@/app/api/admin/orders/[id]/route');
    const res = await readResponse(
      await POST(
        makeRequest('/api/admin/orders/x', { method: 'POST', body: { action: 'transition', status: 'DELIVERED' } }) as never,
        { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) } as never,
      ),
    );
    expect(res.status).toBe(403);
  });

  it('rejects a cross-site admin write even with a valid admin session', async () => {
    const admin = await createUser('admin');
    await signIn(admin.id);

    const { POST } = await import('@/app/api/admin/brands/route');
    const res = await readResponse(
      await POST(makeRequest('/api/admin/brands', {
        method: 'POST', origin: 'https://evil.example', body: { nameFa: 'برند مهاجم' },
      }) as never, undefined as never),
    );
    expect(res.status).toBe(403);
  });
});

/* ── admin happy paths ────────────────────────────────────────────────── */

describe('admin product lifecycle over HTTP', () => {
  it('creates a draft, stocks it, publishes it, and it appears in the shop', async () => {
    const admin = await createUser('admin');
    await signIn(admin.id);

    const products = await import('@/app/api/admin/products/route');
    const created = await readResponse<{ id: string; slug: string }>(
      await products.POST(makeRequest('/api/admin/products', {
        method: 'POST',
        body: {
          sku: 'NEW-PART-001', titleFa: 'قطعهٔ جدید آزمایشی', price: 1_500_000,
          isActive: false, initialStock: 7,
          images: [{ url: '/demo/oil-filter.svg' }],
          specs: [{ specKey: 'جنس', specValue: 'فولاد' }],
          tags: ['آزمایشی'],
        },
      }) as never, undefined as never),
    );

    expect(created.status).toBe(201);
    const productId = created.body.data!.id;
    expect((await stockOf(productId)).quantityOnHand).toBe(7);

    // Draft products stay out of the storefront.
    const { searchProducts } = await import('@/application/catalog-service');
    const { productQuerySchema } = await import('@/lib/validation');
    expect((await searchProducts(productQuerySchema.parse({ q: 'قطعهٔ جدید آزمایشی' }))).total).toBe(0);

    const detail = await import('@/app/api/admin/products/[id]/route');
    const published = await readResponse(
      await detail.PATCH(
        makeRequest(`/api/admin/products/${productId}`, { method: 'PATCH', body: { isActive: true } }) as never,
        { params: Promise.resolve({ id: productId }) } as never,
      ),
    );
    expect(published.status).toBe(200);

    const found = await searchProducts(productQuerySchema.parse({ q: 'قطعهٔ جدید آزمایشی' }));
    expect(found.total).toBe(1);
    expect(found.items[0]!.sku).toBe('NEW-PART-001');
    expect(found.items[0]!.quantityAvailable).toBe(7);
  });

  it('rejects a sale price that is not below the list price', async () => {
    const admin = await createUser('admin');
    await signIn(admin.id);

    const { POST } = await import('@/app/api/admin/products/route');
    const res = await readResponse(
      await POST(makeRequest('/api/admin/products', {
        method: 'POST',
        body: { sku: 'BAD-PRICE-1', titleFa: 'کالای قیمت نادرست', price: 1_000_000, salePrice: 2_000_000, isActive: true },
      }) as never, undefined as never),
    );
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('کمتر از قیمت اصلی');
  });

  it('rejects a duplicate SKU', async () => {
    const admin = await createUser('admin');
    await signIn(admin.id);
    await createProduct({ sku: 'DUPLICATE-1' });

    const { POST } = await import('@/app/api/admin/products/route');
    const res = await readResponse(
      await POST(makeRequest('/api/admin/products', {
        method: 'POST',
        body: { sku: 'DUPLICATE-1', titleFa: 'کالای تکراری', price: 100_000, isActive: false },
      }) as never, undefined as never),
    );
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('SKU');
  });
});

/* ── public reads ─────────────────────────────────────────────────────── */

describe('public read endpoints', () => {
  it('returns suggestions for a Persian query', async () => {
    await createProduct({ titleFa: 'لنت ترمز جلو پژو ۲۰۶' });
    const { GET } = await import('@/app/api/search/suggest/route');
    const res = await readResponse<{ titleFa: string }[]>(
      await GET(makeRequest('/api/search/suggest?q=لنت') as never),
    );
    expect(res.status).toBe(200);
    expect(res.body.data!.length).toBeGreaterThan(0);
  });

  it('quotes shipping for a valid province and rejects an invalid one', async () => {
    await createShippingMethod({ code: 'post', baseCost: 85_000 });
    const product = await createProduct({ stock: 5, price: 500_000 });
    const cart = await import('@/app/api/cart/items/route');
    await cart.POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 1 } }) as never);

    const { GET } = await import('@/app/api/shipping/quote/route');
    const ok = await readResponse<{ shippingTotal: number }>(
      await GET(makeRequest('/api/shipping/quote?province=تهران') as never),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data!.shippingTotal).toBeGreaterThan(0);

    const bad = await readResponse(await GET(makeRequest('/api/shipping/quote?province=Nowhere') as never));
    expect(bad.status).toBe(422);
  });

  it('exposes an order by tracking token but not by order id', async () => {
    await createShippingMethod({ code: 'post', baseCost: 0 });
    const product = await createProduct({ stock: 5, price: 400_000 });
    const cart = await import('@/app/api/cart/items/route');
    await cart.POST(makeRequest('/api/cart/items', { method: 'POST', body: { productId: product.id, quantity: 1 } }) as never);

    const checkout = await import('@/app/api/checkout/route');
    const placed = await readResponse<{ orderId: string; trackingToken: string }>(
      await checkout.POST(makeRequest('/api/checkout', {
        method: 'POST',
        body: {
          fullName: 'علی رضایی', phone: '09123456789', province: 'تهران', city: 'تهران',
          postalAddress: 'خیابان نمونه، پلاک ۱۰', postalCode: '1234567890', shippingMethodCode: 'post',
        },
      }) as never),
    );

    const { GET } = await import('@/app/api/orders/track/[token]/route');

    const good = await readResponse(
      await GET(makeRequest('/api/orders/track/x') as never,
        { params: Promise.resolve({ token: placed.body.data!.trackingToken }) } as never),
    );
    expect(good.status).toBe(200);

    // The order's UUID is not a tracking token.
    const bad = await readResponse(
      await GET(makeRequest('/api/orders/track/x') as never,
        { params: Promise.resolve({ token: placed.body.data!.orderId }) } as never),
    );
    expect(bad.status).toBe(404);
  });
});

/* ── account ownership ────────────────────────────────────────────────── */

describe('account address ownership', () => {
  it('does not let one customer delete another customer’s address', async () => {
    const owner = await createUser('customer', '09120001111');
    const stranger = await createUser('customer', '09120002222');

    await signIn(owner.id);
    const addresses = await import('@/app/api/account/addresses/route');
    const created = await readResponse<{ id: string }>(
      await addresses.POST(makeRequest('/api/account/addresses', {
        method: 'POST',
        body: {
          fullName: 'علی رضایی', phone: '09123456789', province: 'تهران', city: 'تهران',
          postalAddress: 'خیابان نمونه، پلاک ۱۰', postalCode: '1234567890',
        },
      }) as never),
    );
    expect(created.status).toBe(201);
    const addressId = created.body.data!.id;

    signOut();
    await signIn(stranger.id);
    const attack = await readResponse(
      await addresses.DELETE(makeRequest(`/api/account/addresses?id=${addressId}`, { method: 'DELETE' }) as never),
    );
    expect(attack.status).toBe(404);

    signOut();
    await signIn(owner.id);
    const list = await readResponse<unknown[]>(await addresses.GET());
    expect(list.body.data!.length).toBe(1);
  });

  it('requires authentication for the address book', async () => {
    const addresses = await import('@/app/api/account/addresses/route');
    const res = await readResponse(await addresses.GET());
    expect(res.status).toBe(401);
  });
});

/* ── vehicle selection, garage and bulk import ────────────────────────── */

describe('POST /api/vehicle', () => {
  it('lets a guest choose a vehicle and sets the cookie', async () => {
    const { model, engine } = await createVehicle();
    const { POST } = await import('@/app/api/vehicle/route');

    const res = await readResponse<{ id: string; modelSlug: string }>(
      await POST(makeRequest('/api/vehicle', {
        method: 'POST',
        body: { vehicleModelId: model.id, vehicleEngineId: engine.id, year: 1398 },
      }) as never),
    );

    expect(res.status).toBe(200);
    expect(res.body.data!.modelSlug).toBe(model.slug);
    // The cookie holds a public taxonomy id, not a credential.
    expect(ctx.cookies.get('ms_vehicle')).toBe(res.body.data!.id);
  });

  it('rejects a cross-site vehicle change', async () => {
    const { model } = await createVehicle();
    const { POST } = await import('@/app/api/vehicle/route');
    const res = await readResponse(
      await POST(makeRequest('/api/vehicle', {
        method: 'POST', origin: 'https://evil.example', body: { vehicleModelId: model.id },
      }) as never),
    );
    expect(res.status).toBe(403);
  });

  it('rejects a model id that is not a UUID', async () => {
    const { POST } = await import('@/app/api/vehicle/route');
    const res = await readResponse(
      await POST(makeRequest('/api/vehicle', { method: 'POST', body: { vehicleModelId: "1' or '1'='1" } }) as never),
    );
    expect(res.status).toBe(422);
  });
});

describe('/api/account/garage', () => {
  it('requires authentication', async () => {
    const garage = await import('@/app/api/account/garage/route');
    expect((await readResponse(await garage.GET())).status).toBe(401);
  });

  it('does not let one customer touch another’s vehicle', async () => {
    const owner = await createUser('customer', '09120000021');
    const stranger = await createUser('customer', '09120000022');
    const { model } = await createVehicle();
    const garage = await import('@/app/api/account/garage/route');

    await signIn(owner.id);
    const created = await readResponse<{ id: string }>(
      await garage.POST(makeRequest('/api/account/garage', {
        method: 'POST', body: { vehicleModelId: model.id, nickname: 'خودروی من' },
      }) as never),
    );
    expect(created.status).toBe(201);
    const vehicleId = created.body.data!.id;

    signOut();
    await signIn(stranger.id);
    // 404, not 403: the stranger must not learn that the id exists.
    expect((await readResponse(
      await garage.DELETE(makeRequest(`/api/account/garage?id=${vehicleId}`, { method: 'DELETE' }) as never),
    )).status).toBe(404);
    expect((await readResponse(
      await garage.PATCH(makeRequest('/api/account/garage', { method: 'PATCH', body: { vehicleId } }) as never),
    )).status).toBe(404);
    expect((await readResponse<unknown[]>(await garage.GET())).body.data).toHaveLength(0);

    signOut();
    await signIn(owner.id);
    expect((await readResponse<unknown[]>(await garage.GET())).body.data).toHaveLength(1);
  });
});

describe('/api/admin/imports', () => {
  const csv = 'sku,title_fa,price,stock\nAPI-IMP-1,فیلتر آزمایشی,۲۵۰٬۰۰۰,۴';

  it('refuses an anonymous caller and a signed-in customer', async () => {
    const imports = await import('@/app/api/admin/imports/route');
    expect((await readResponse(
      await imports.GET(makeRequest('/api/admin/imports') as never, undefined as never),
    )).status).toBe(401);

    const customer = await createUser('customer', '09120000031');
    await signIn(customer.id);
    expect((await readResponse(
      await imports.POST(makeRequest('/api/admin/imports', {
        method: 'POST', body: { content: csv },
      }) as never, undefined as never),
    )).status).toBe(403);
  });

  it('rejects a cross-site import even with a valid admin session', async () => {
    const admin = await createUser('admin', '09120000032');
    await signIn(admin.id);
    const imports = await import('@/app/api/admin/imports/route');
    const res = await readResponse(
      await imports.POST(makeRequest('/api/admin/imports', {
        method: 'POST', origin: 'https://evil.example', body: { content: csv },
      }) as never, undefined as never),
    );
    expect(res.status).toBe(403);
  });

  it('rejects a payload above the byte limit, counting UTF-8 bytes', async () => {
    const admin = await createUser('admin', '09120000033');
    await signIn(admin.id);
    const imports = await import('@/app/api/admin/imports/route');

    // Persian is 2 bytes per character in UTF-8, so this is ~6 MB of body from
    // 3M characters — a character-counted limit would let it through.
    const oversized = 'ف'.repeat(3 * 1024 * 1024);
    const res = await readResponse(
      await imports.POST(makeRequest('/api/admin/imports', {
        method: 'POST', body: { content: oversized },
      }) as never, undefined as never),
    );
    expect(res.status).toBe(422);
  });

  it('previews without writing, then commits once', async () => {
    const admin = await createUser('admin', '09120000034');
    await signIn(admin.id);
    const imports = await import('@/app/api/admin/imports/route');

    const preview = await readResponse<{ jobId: string; validRows: number }>(
      await imports.POST(makeRequest('/api/admin/imports', {
        method: 'POST', body: { filename: 'supplier.csv', content: csv },
      }) as never, undefined as never),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data!.validRows).toBe(1);

    // Nothing written yet.
    const before = await getDb().select().from(products).where(eq(products.sku, 'API-IMP-1'));
    expect(before).toHaveLength(0);

    const commit = await readResponse<{ created: number }>(
      await imports.PUT(makeRequest('/api/admin/imports', {
        method: 'PUT', body: { jobId: preview.body.data!.jobId },
      }) as never, undefined as never),
    );
    expect(commit.status).toBe(200);
    expect(commit.body.data!.created).toBe(1);

    // Re-submitting the same job is a no-op, not a double import.
    const replay = await readResponse(
      await imports.PUT(makeRequest('/api/admin/imports', {
        method: 'PUT', body: { jobId: preview.body.data!.jobId },
      }) as never, undefined as never),
    );
    expect(replay.status).toBe(409);
    expect(await getDb().select().from(products).where(eq(products.sku, 'API-IMP-1'))).toHaveLength(1);
  });
});

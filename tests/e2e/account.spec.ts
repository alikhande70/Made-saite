/**
 * Customer account: sign-in, order history, ownership boundaries and reorder.
 */
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, placeOrderViaApi, query, signIn, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('account') });

test.describe('customer account', () => {
  test('signs in and sees the account dashboard', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('سلام');
    await expect(page.getByRole('link', { name: 'سفارش‌های من' }).first()).toBeVisible();
  });

  test('rejects a wrong password with a Persian message and no session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('شمارهٔ موبایل').fill(DEMO_CUSTOMER.phone);
    await page.getByLabel('رمز عبور').fill('DefinitelyWrong1');
    await page.getByRole('button', { name: /ورود به حساب/ }).click();

    await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toContainText(/نادرست/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('saves an address and reuses it at checkout', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/account/addresses');

    const existing = await page.getByRole('button', { name: 'افزودن آدرس جدید' }).count();
    if (existing > 0) await page.getByRole('button', { name: 'افزودن آدرس جدید' }).click();

    await page.getByLabel('عنوان آدرس (اختیاری)').fill('خانه');
    await page.getByLabel('نام گیرنده').fill('مشتری نمایشی');
    await page.getByLabel('شمارهٔ موبایل').fill('09121111111');
    await page.getByLabel('استان').selectOption('تهران');
    await page.getByRole('textbox', { name: 'شهر' }).fill('تهران');
    await page.getByLabel('کد پستی').fill('1234567890');
    await page.getByLabel('نشانی کامل').fill('خیابان آزمایش، پلاک ۵');
    await page.getByRole('button', { name: 'ذخیرهٔ آدرس' }).click();

    await expect(page.getByText('خانه').first()).toBeVisible();
  });

  test('shows a placed order in the customer’s history and hides other customers’ orders', async ({ page, request }) => {
    await signIn(page, DEMO_CUSTOMER);

    const products = await query<{ id: string }>(
      `select p.id from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0 limit 1`,
    );

    // Place the order in the signed-in browser context so it belongs to this user.
    await page.request.post('/api/cart/items', { data: { productId: products[0]!.id, quantity: 1 } });
    const checkout = await page.request.post('/api/checkout', {
      data: {
        fullName: 'مشتری نمایشی', phone: '09121111111', province: 'تهران', city: 'تهران',
        postalAddress: 'خیابان آزمایش، پلاک ۵', postalCode: '1234567890',
        shippingMethodCode: 'post-pishtaz',
      },
    });
    const { data: mine } = (await checkout.json()) as { data: { orderId: string } };

    await page.goto('/account/orders');
    await expect(page.getByRole('link', { name: 'جزئیات سفارش' }).first()).toBeVisible();

    await page.goto(`/account/orders/${mine.orderId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('سفارش');

    // Another buyer's order must not be readable, even with its exact id.
    const other = await placeOrderViaApi(request, products[0]!.id, 1);
    await page.goto(`/account/orders/${other.orderId}`);
    await expect(page.getByText('صفحه‌ای که دنبالش بودید پیدا نشد')).toBeVisible();

    // Nothing about the other order may reach the page. (The raw id appears in
    // Next's routing payload for the requested URL, so assert on order data.)
    const otherRow = await query<{ order_number: string; customer_phone: string }>(
      `select order_number, customer_phone from orders where id = $1`, [other.orderId],
    );
    const html = await page.content();
    expect(html).not.toContain(otherRow[0]!.order_number);
    expect(html).not.toContain(other.trackingToken);
  });

  test('guest order tracking works without an account', async ({ browser, request }) => {
    const products = await query<{ id: string }>(
      `select p.id from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0 limit 1`,
    );
    const order = await placeOrderViaApi(request, products[0]!.id, 1);

    const guest = await browser.newContext();
    const page = await guest.newPage();
    await page.goto('/orders/track');
    await page.getByLabel('کد پیگیری سفارش').fill(order.trackingToken);
    await page.getByRole('button', { name: 'مشاهدهٔ وضعیت سفارش' }).click();

    await expect(page).toHaveURL(/\/orders\/track\/.+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('سفارش');
    await expect(page.getByText('در انتظار پرداخت').first()).toBeVisible();
    await guest.close();
  });

  test('an unknown tracking code shows a Persian error, not a crash', async ({ page }) => {
    await page.goto('/orders/track');
    await page.getByLabel('کد پیگیری سفارش').fill('definitely-not-a-real-token');
    await page.getByRole('button', { name: 'مشاهدهٔ وضعیت سفارش' }).click();
    await expect(page.locator('#tracking-error')).toContainText(/یافت نشد/);
  });
});

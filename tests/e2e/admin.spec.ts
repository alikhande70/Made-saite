/**
 * Critical flow 2: admin creates a product, stocks it, publishes it, and it
 * becomes buyable in the shop.
 * Critical flow 5: paid → processing → shipped, with tracking visible.
 */
import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, DEMO_CUSTOMER, placeOrderViaApi, query, signIn, signSandboxCallback, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('admin') });

test.describe('admin', () => {
  test('creates a product, publishes it, and it appears in the shop', async ({ page }) => {
    await signIn(page, DEMO_ADMIN);

    await page.goto('/admin/products/new');
    const sku = `E2E-${Date.now()}`;

    await page.getByRole('textbox', { name: /^عنوان فارسی/ }).fill('واشر آزمایشی سرسیلندر E2E');
    await page.getByRole('textbox', { name: /^کد کالا \(SKU\)/ }).fill(sku);
    await page.getByRole('textbox', { name: /^قیمت \(تومان\)/ }).fill('2500000');
    await page.getByRole('textbox', { name: /^موجودی اولیه/ }).fill('4');

    await page.getByRole('button', { name: 'افزودن تصویر' }).click();
    await page.getByLabel('نشانی تصویر').selectOption('/demo/engine-part.svg');

    await page.getByRole('button', { name: 'افزودن مشخصه' }).click();
    await page.getByRole('textbox', { name: 'عنوان', exact: true }).fill('ضخامت');
    await page.getByRole('textbox', { name: 'مقدار', exact: true }).fill('۱٫۲');

    await page.getByLabel('انتشار در فروشگاه').check();
    await page.getByRole('button', { name: 'ایجاد کالا' }).click();

    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'ویرایش کالا' })).toBeVisible();

    // Visible to a shopper, with the stock the admin entered.
    await page.goto(`/search?q=${encodeURIComponent(sku)}`);
    const card = page.locator('article').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('واشر آزمایشی سرسیلندر E2E');
    await expect(card).toContainText('موجود');
  });

  test('a customer cannot reach the admin panel', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER);
    await page.goto('/admin');
    // Redirected away, never shown the panel.
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByRole('heading', { name: 'پنل مدیریت فروشگاه' })).toHaveCount(0);
  });

  test('an anonymous visitor is sent to sign in', async ({ page }) => {
    await page.goto('/admin/orders');
    await expect(page).toHaveURL(/\/login/);
  });

  test('walks a paid order to shipped and shows the tracking code to the customer', async ({ page, request }) => {
    const products = await query<{ id: string }>(
      `select p.id from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 2 limit 1`,
    );
    const order = await placeOrderViaApi(request, products[0]!.id, 1);

    // Pay through the sandbox gateway.
    const payments = await query<{ provider_ref: string }>(
      `select provider_ref from payments where order_id = $1 order by created_at desc limit 1`,
      [order.orderId],
    );
    const sig = signSandboxCallback(order.orderId, payments[0]!.provider_ref, 'SUCCEEDED', order.grandTotal);
    await request.get(
      `/api/payments/mock/callback?order=${order.orderId}&ref=${payments[0]!.provider_ref}` +
      `&status=SUCCEEDED&amount=${order.grandTotal}&sig=${sig}`,
    );

    await signIn(page, DEMO_ADMIN);
    await page.goto(`/admin/orders/${order.orderId}`);
    await expect(page.getByText('پرداخت‌شده').first()).toBeVisible();

    await page.getByRole('button', { name: 'در حال آماده‌سازی', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('وضعیت سفارش به «در حال آماده‌سازی» تغییر کرد.');

    await page.getByRole('button', { name: 'بسته‌بندی‌شده', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('وضعیت سفارش به «بسته‌بندی‌شده» تغییر کرد.');

    await page.getByLabel('شرکت حمل').fill('پست پیشتاز');
    await page.getByRole('button', { name: 'تولید خودکار' }).click();
    await expect(page.getByRole('status')).toContainText('کد رهگیری تولید شد.');

    await page.getByRole('button', { name: 'ارسال‌شده', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('وضعیت سفارش به «ارسال‌شده» تغییر کرد.');

    // The customer's public tracking page shows the status and the code.
    const shipment = await query<{ tracking_code: string }>(
      `select tracking_code from shipments where order_id = $1`, [order.orderId],
    );
    expect(shipment[0]!.tracking_code).toMatch(/^\d{16}$/);

    await page.goto(`/orders/track/${order.trackingToken}`);
    await expect(page.getByText('ارسال‌شده').first()).toBeVisible();
    await expect(page.getByText(shipment[0]!.tracking_code, { exact: true })).toBeVisible();
  });

  test('adjusts stock with a reason and records an audit event', async ({ page }) => {
    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin/inventory?q=فیلتر روغن');

    await page.getByRole('button', { name: 'تغییر موجودی' }).first().click();
    await page.getByLabel('مقدار تغییر').fill('5');
    await page.getByLabel('دلیل (الزامی)').fill('ورود کالا از تأمین‌کننده — آزمون E2E');
    await page.getByRole('button', { name: 'ثبت', exact: true }).click();

    await expect(page.getByRole('status')).toContainText('موجودی به‌روزرسانی شد.');

    const events = await query<{ reason: string; delta: number }>(
      `select reason, delta from inventory_events where reason like '%آزمون E2E%' limit 1`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.delta).toBe(5);
  });

  test('refuses a stock reduction below the reserved quantity', async ({ page, request }) => {
    const products = await query<{ id: string; title_fa: string }>(
      `select p.id, p.title_fa from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0
       order by i.quantity_on_hand asc limit 1`,
    );
    const product = products[0]!;
    await placeOrderViaApi(request, product.id, 1); // leaves 1 unit reserved, unpaid

    const stock = await query<{ quantity_on_hand: number; quantity_reserved: number }>(
      `select quantity_on_hand, quantity_reserved from inventory where product_id = $1`, [product.id],
    );

    await signIn(page, DEMO_ADMIN);
    await page.goto(`/admin/inventory?q=${encodeURIComponent(product.title_fa)}`);
    await page.getByRole('button', { name: 'تغییر موجودی' }).first().click();
    await page.getByLabel('مقدار تغییر').fill(`-${stock[0]!.quantity_on_hand}`);
    await page.getByLabel('دلیل (الزامی)').fill('تلاش برای صفر کردن موجودی رزروشده');
    await page.getByRole('button', { name: 'ثبت', exact: true }).click();

    await expect(page.locator('[role="alert"]').filter({ hasText: 'کاهش موجودی' })).toBeVisible();
  });
});

test.describe('bulk import', () => {
  /**
   * The import must be visibly two-phase: nothing changes until an
   * administrator has seen the errors and pressed apply.
   */
  test('a messy supplier file is previewed with errors before anything is written', async ({ page }) => {
    await signIn(page, DEMO_ADMIN);

    const existing = (await query<{ sku: string; price: string }>(
      // No sale price, so a bare price update is a valid row on its own.
      `select sku, price::text from products where is_active and sale_price is null order by sku limit 1`,
    ))[0]!;
    const newSku = `E2E-IMP-${Date.now()}`;

    await page.goto('/admin/imports');
    await expect(page.getByRole('heading', { level: 1, name: /درون‌ریزی گروهی/ })).toBeVisible();

    // Persian digits, a thousands separator, one unreadable price and one
    // unknown vehicle — all of which a supplier file really does contain.
    const csv = [
      'کد کالا,نام کالا,قیمت,موجودی,سازگاری',
      `${existing.sku},,۹۹۹٬۰۰۰,۷,`,
      `${newSku},قطعهٔ آزمایشی درون‌ریزی,۴۵۰۰۰۰,۳,`,
      `${newSku}-BAD,قطعهٔ خراب,تماس بگیرید,۲,`,
      `${newSku}-GHOST,قطعهٔ ناشناخته,۱۰۰۰۰۰,۱,ghost-model||||DIRECT`,
    ].join('\n');

    await page.getByLabel('فایل درون‌ریزی').setInputFiles({
      name: 'supplier.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    // Errors are shown before the apply button is reachable.
    await expect(page.getByText('خطاهای یافت‌شده — این ردیف‌ها اعمال نخواهند شد')).toBeVisible();
    await expect(page.getByText('مقدار «تماس بگیرید» عدد معتبر نیست.')).toBeVisible();
    await expect(page.getByText(/ghost-model/)).toBeVisible();

    // Nothing has been written yet.
    const untouched = await query<{ price: string }>(`select price::text from products where sku = $1`, [existing.sku]);
    expect(untouched[0]!.price).toBe(existing.price);
    expect(await query(`select 1 from products where sku = $1`, [newSku])).toHaveLength(0);

    await page.getByRole('button', { name: /اعمال .* ردیف معتبر/ }).click();
    await expect(page.getByText(/اعمال شد/)).toBeVisible();

    // Only the two valid rows landed.
    const updated = await query<{ price: string }>(`select price::text from products where sku = $1`, [existing.sku]);
    expect(updated[0]!.price).toBe('999000');
    expect(await query(`select 1 from products where sku = $1`, [newSku])).toHaveLength(1);
    expect(await query(`select 1 from products where sku = $1`, [`${newSku}-BAD`])).toHaveLength(0);
    expect(await query(`select 1 from products where sku = $1`, [`${newSku}-GHOST`])).toHaveLength(0);

    // The action is recorded in the audit log.
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: /گزارش فعالیت/ })).toBeVisible();
    // Scoped to the table: the same label also exists in the filter dropdown.
    await expect(page.getByRole('cell', { name: 'اعمال فایل ورودی' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /اعمال فایل درون‌ریزی/ }).first()).toBeVisible();
  });

  test('the audit log is admin-only', async ({ request }) => {
    const response = await request.get('/admin/audit', { maxRedirects: 0 });
    // Unauthenticated visitors are bounced to the login page, never shown the log.
    expect([302, 307]).toContain(response.status());
    expect(response.headers()['location']).toContain('/login');
  });
});

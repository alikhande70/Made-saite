/**
 * Critical flow 1: home → search → product detail → cart → checkout → order.
 */
import { expect, test } from '@playwright/test';
import { CHECKOUT_ADDRESS, query, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('storefront') });

test.describe('customer purchase journey', () => {
  test('search a part, add it to the cart and place an order', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');

    // Search from the header.
    // Desktop and mobile header search boxes both exist; use whichever is shown.
    await page.getByPlaceholder(/نام قطعه/).filter({ visible: true }).first().fill('لنت ترمز پژو');
    await page.getByRole('button', { name: 'جست‌وجو', exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/search\?/);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('لنت ترمز پژو');
    const firstProduct = page.locator('article h3 a').first();
    await expect(firstProduct).toBeVisible();
    const productTitle = (await firstProduct.textContent())?.trim() ?? '';
    await firstProduct.click();

    // Product detail
    await expect(page).toHaveURL(/\/products\/.+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(productTitle);
    await expect(page.getByRole('heading', { name: 'مشخصات فنی' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'خودروهای سازگار' })).toBeVisible();

    // Add two units.
    await page.getByRole('button', { name: 'افزایش تعداد' }).click();
    await page.getByRole('button', { name: /افزودن به سبد خرید/ }).click();
    await expect(page.getByRole('button', { name: /به سبد اضافه شد/ })).toBeVisible();

    // Cart
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'سبد خرید' })).toBeVisible();
    await expect(page.locator('li').filter({ hasText: productTitle }).first()).toBeVisible();

    await page.getByRole('link', { name: /ادامه و تکمیل سفارش/ }).click();
    await expect(page).toHaveURL(/\/checkout/);

    // Checkout
    await page.getByLabel('نام و نام خانوادگی').fill(CHECKOUT_ADDRESS.fullName);
    await page.getByLabel('شمارهٔ موبایل').fill(CHECKOUT_ADDRESS.phone);
    await page.getByLabel('استان').selectOption('تهران');
    await page.getByRole('textbox', { name: 'شهر' }).fill(CHECKOUT_ADDRESS.city);
    await page.getByLabel('کد پستی').fill(CHECKOUT_ADDRESS.postalCode);
    await page.getByLabel('نشانی پستی').fill(CHECKOUT_ADDRESS.postalAddress);

    await expect(page.getByText('مبلغ قابل پرداخت')).toBeVisible();
    await page.getByRole('button', { name: /پرداخت و ثبت سفارش/ }).click();

    // Sandbox gateway
    await page.waitForURL(/\/payment\/sandbox/);
    await expect(page.getByText('درگاه پرداخت آزمایشی')).toBeVisible();
    await page.getByRole('link', { name: 'پرداخت موفق' }).click();

    // Confirmation
    await page.waitForURL(/\/orders\/confirmation\//);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('سفارش شما با موفقیت ثبت شد');

    const orders = await query<{ status: string; grand_total: string; customer_phone: string }>(
      `select status, grand_total, customer_phone from orders order by placed_at desc limit 1`,
    );
    expect(orders[0]!.status).toBe('PAID');
    expect(orders[0]!.customer_phone).toBe(CHECKOUT_ADDRESS.phone);
  });

  test('filter parts by vehicle from the home page picker', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('برند خودرو').selectOption('irankhodro');
    await page.getByLabel('مدل خودرو').selectOption('peugeot-206');
    await page.getByRole('button', { name: 'نمایش قطعات سازگار' }).click();

    await expect(page).toHaveURL(/vehicleModel=peugeot-206/);
    const cards = page.locator('article');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    // Everything shown must actually list Peugeot 206 as compatible. Follow the
    // card's own href rather than tapping it, so the assertion does not depend
    // on viewport-specific hit-testing.
    const href = await cards.first().locator('h3 a').getAttribute('href');
    expect(href).toMatch(/^\/products\/.+/);
    await page.goto(href!);

    const compatibility = page.locator('table').filter({ hasText: 'پژو ۲۰۶' });
    await expect(compatibility.first()).toBeVisible();
  });

  test('search finds a part by its OEM number', async ({ page }) => {
    await page.goto('/search?q=1109AY');
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article').first()).toContainText('فیلتر روغن');
  });

  test('an out-of-stock product cannot be added to the cart', async ({ page }) => {
    const rows = await query<{ slug: string }>(
      `select p.slug from products p
       join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved <= 0
       limit 1`,
    );
    test.skip(rows.length === 0, 'no out-of-stock demo product');

    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);
    await expect(page.getByRole('button', { name: 'ناموجود' }).first()).toBeDisabled();
  });
});

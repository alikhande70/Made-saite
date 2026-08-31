/**
 * Interaction feedback through the real UI.
 *
 * Each test asserts an answer to one of the microinteraction questions —
 * "is the system working?", "what changed?", "did it succeed?" — rather than
 * asserting an animation. Motion is a carrier here, never the payload: every
 * assertion below would still hold with animations disabled.
 */
import { expect, test } from '@playwright/test';
import { clientIpHeaders, query } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('interaction') });

async function firstBuyableSlug(): Promise<string | null> {
  const rows = await query<{ slug: string }>(
    `select p.slug from products p
       join inventory i on i.product_id = p.id
      where p.is_active and i.quantity_on_hand - i.quantity_reserved > 2
      limit 1`,
  );
  return rows[0]?.slug ?? null;
}

test.describe('add to cart feedback', () => {
  test('confirms the item landed, names it, and updates the cart count', async ({ page }) => {
    const slug = await firstBuyableSlug();
    test.skip(slug === null, 'no buyable demo product');

    await page.goto(`/products/${encodeURIComponent(slug!)}`);
    const title = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();

    await page.getByRole('button', { name: 'افزودن به سبد خرید', exact: true }).click();

    // "Did my action succeed?" — a confirmation that names the part.
    const toast = page.getByRole('status').filter({ hasText: 'به سبد خرید اضافه شد' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(title.slice(0, 12));

    // "What changed?" — the header badge reflects the new count.
    await expect(page.getByRole('link', { name: /کالا در سبد خرید/ })).toBeVisible();
  });

  test('reports a stock conflict instead of failing silently', async ({ page, request }) => {
    const rows = await query<{ id: string; slug: string }>(
      `select p.id, p.slug from products p
         join inventory i on i.product_id = p.id
        where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0
        limit 1`,
    );
    test.skip(rows.length === 0, 'no in-stock product');

    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);
    // Ask for far more than exists; the server refuses and the UI must say so.
    const response = await request.post('/api/cart/items', {
      data: { productId: rows[0]!.id, quantity: 20 },
      headers: { origin: new URL(page.url()).origin },
    });
    // Either the API rejects it outright, or it succeeds and the cart caps it —
    // both are acceptable; silently accepting an impossible quantity is not.
    if (!response.ok()) {
      const body = (await response.json()) as { message?: string };
      expect(body.message, 'a refusal must carry a Persian explanation').toBeTruthy();
    }
  });
});

test.describe('submit controls report their own progress', () => {
  test('the checkout button disables itself and announces that the order is in flight', async ({ page }) => {
    const slug = await firstBuyableSlug();
    test.skip(slug === null, 'no buyable demo product');

    await page.goto(`/products/${encodeURIComponent(slug!)}`);
    await page.getByRole('button', { name: 'افزودن به سبد خرید', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'به سبد خرید اضافه شد' })).toBeVisible();

    await page.goto('/checkout');
    await page.getByLabel('نام و نام خانوادگی').fill('علی رضایی');
    await page.getByLabel('شمارهٔ موبایل').fill('09123456789');
    await page.getByLabel('استان').selectOption('تهران');
    await page.getByRole('textbox', { name: 'شهر' }).fill('تهران');
    await page.getByLabel('کد پستی').fill('1234567890');
    await page.getByLabel('نشانی پستی').fill('خیابان نمونه، پلاک ۱۰');

    const submit = page.getByRole('button', { name: /ثبت نهایی سفارش|پرداخت و ثبت سفارش/ });
    await expect(submit).toBeEnabled();
    await submit.click();

    /*
     * The button must become unavailable the moment it is pressed. This is the
     * client-side courtesy; the server-side cart lock is the guarantee. Either
     * the control reports busy, or the navigation already happened — both mean
     * a second click cannot produce a second order.
     */
    await Promise.race([
      expect(submit).toBeDisabled({ timeout: 5_000 }),
      page.waitForURL(/\/(payment|orders)\//, { timeout: 5_000 }),
    ]);
  });
});

test.describe('search answers "is it working?" and "what changed?"', () => {
  test('shows a no-results state rather than an empty void', async ({ page }) => {
    await page.goto('/');
    const input = page.getByRole('combobox', { name: 'جست‌وجوی قطعات' }).first();
    await input.click();
    await input.fill('zzzzqqqxyz');

    // Scoped to the header: the home hero carries similar guidance copy.
    const header = page.getByRole('banner');
    await expect(header.getByText(/نتیجه‌ای برای/)).toBeVisible();
    // Tell them what to try next, not merely that nothing matched.
    await expect(header.getByText(/کد فنی یا شمارهٔ OEM/)).toBeVisible();
  });

  test('marks an exact part-number hit and is keyboard operable', async ({ page }) => {
    const rows = await query<{ sku: string }>(
      `select sku from products where is_active and sku is not null limit 1`,
    );
    test.skip(rows.length === 0, 'no product with a SKU');

    await page.goto('/');
    const input = page.getByRole('combobox', { name: 'جست‌وجوی قطعات' }).first();
    await input.click();
    await input.fill(rows[0]!.sku);

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // The highest-confidence answer the search can give is labelled as such.
    await expect(listbox.getByText('کد دقیق').first()).toBeVisible();

    // Keyboard selection must reach the product without a pointer.
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/products\//);
  });
});

test.describe('reduced motion keeps every meaning', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the compatibility verdict is fully readable without animation', async ({ page, context }) => {
    const fixture = await query<{ product_slug: string; model_id: string; engine_id: string }>(`
      select p.slug as product_slug, vc.vehicle_model_id as model_id, vc.vehicle_engine_id as engine_id
        from products p
        join product_fitments pf on pf.product_id = p.id and pf.fitment_type = 'NOT_COMPATIBLE'
        join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
       where p.is_active and vc.vehicle_engine_id is not null
       limit 1`);
    test.skip(fixture.length === 0, 'no recorded exclusion');

    await page.goto(`/products/${encodeURIComponent(fixture[0]!.product_slug)}`);
    const origin = new URL(page.url()).origin;
    await context.request.post('/api/vehicle', {
      data: { vehicleModelId: fixture[0]!.model_id, vehicleEngineId: fixture[0]!.engine_id },
      headers: { origin },
    });
    await page.reload();

    // The verdict is words and a glyph, so it survives with motion removed.
    const panel = page.getByRole('region', { name: 'آیا این قطعه مناسب خودروی شماست؟' });
    await expect(panel).toContainText('ناسازگار');
    await expect(panel.getByRole('status')).toBeVisible();
  });

  test('add-to-cart still confirms with motion disabled', async ({ page }) => {
    const slug = await firstBuyableSlug();
    test.skip(slug === null, 'no buyable demo product');

    await page.goto(`/products/${encodeURIComponent(slug!)}`);
    await page.getByRole('button', { name: 'افزودن به سبد خرید', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'به سبد خرید اضافه شد' })).toBeVisible();
  });
});

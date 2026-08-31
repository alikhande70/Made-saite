/**
 * RTL correctness and responsive behaviour.
 *
 * The tests assert *layout* facts rather than screenshots: reading direction,
 * absence of horizontal overflow, direction-aware icon mirroring, and Persian
 * numerals in customer-facing figures.
 */
import { expect, test, type Page } from '@playwright/test';
import { query, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('rtl') });

const PAGES: [string, string][] = [
  ['/', 'صفحهٔ اصلی'],
  ['/products', 'فهرست کالاها'],
  ['/categories', 'دسته‌بندی‌ها'],
  ['/brands', 'برندها'],
  ['/vehicles', 'انتخاب بر اساس خودرو'],
  ['/search?q=لنت', 'نتایج جست‌وجو'],
  ['/cart', 'سبد خرید'],
  ['/orders/track', 'پیگیری سفارش'],
  ['/login', 'ورود'],
  ['/shipping', 'شیوه‌های ارسال'],
  ['/faq', 'پرسش‌های پرتکرار'],
];

/**
 * The breakpoint sweep. 360/390/430 are the phone widths Iranian traffic
 * actually arrives on, 768 and 1024 are the tablet boundaries either side of
 * the `lg:` layout switch, and 1440 is where the page must stop growing rather
 * than stretching lines past a readable measure.
 */
const BREAKPOINTS: [number, number, string][] = [
  [360, 780, 'phone-small'],
  [390, 844, 'phone'],
  [430, 932, 'phone-large'],
  [768, 1024, 'tablet'],
  [1024, 800, 'tablet-landscape'],
  [1440, 900, 'desktop'],
];

/** Reports the widest element that pushes the page past the viewport. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return null;
    let worst: { tag: string; cls: string; width: number } | null = null;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect();
      const overhang = Math.max(rect.right - doc.clientWidth, -rect.left);
      if (overhang > 1 && (!worst || overhang > worst.width)) {
        // Ignore elements that scroll inside their own container.
        let parent: HTMLElement | null = el.parentElement;
        let contained = false;
        while (parent) {
          if (getComputedStyle(parent).overflowX !== 'visible') { contained = true; break; }
          parent = parent.parentElement;
        }
        if (!contained) worst = { tag: el.tagName, cls: el.className.toString().slice(0, 80), width: overhang };
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, worst };
  });
}

test.describe('RTL layout', () => {
  for (const [path, label] of PAGES) {
    test(`${label} renders RTL with no horizontal overflow`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
      expect(await horizontalOverflow(page)).toBeNull();
    });
  }

  test('directional chevrons are mirrored for RTL', async ({ page }) => {
    await page.goto('/products');
    // `toHaveCSS` retries, so this does not race the stylesheet.
    // scaleX(-1) computes to matrix(-1, 0, 0, 1, 0, 0).
    await expect(page.locator('.flip-rtl').first()).toHaveCSS('transform', /matrix\(-1/);
  });

  test('product prices and quantities use Persian numerals', async ({ page }) => {
    await page.goto('/products');
    const priceText = await page.locator('article').first().textContent();
    expect(priceText).toMatch(/[۰-۹]/);
    expect(priceText).toContain('تومان');
  });

  test('part numbers stay in Latin script and left-to-right', async ({ page }) => {
    await page.goto('/search?q=1109AY');
    const sku = page.locator('.latin-id').filter({ hasText: 'FLT-OIL-206TU5' }).first();
    await expect(sku).toBeVisible();
    await expect(sku).toHaveCSS('direction', 'ltr');
  });

  test('the mobile drawer opens from the reading-start edge', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile only');
    await page.goto('/');
    await page.getByRole('button', { name: 'باز کردن منو' }).click();

    const dialog = page.getByRole('dialog', { name: 'منوی دسته‌بندی‌ها' });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const width = page.viewportSize()!.width;
    // In RTL the drawer's inline-start edge is the right side of the screen.
    expect(box!.x + box!.width).toBeGreaterThan(width - 2);
  });

  test('no page overflows horizontally at any supported width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport is set explicitly');

    const rows = await query<{ slug: string }>(`select slug from products where is_active limit 1`);
    const landing = await query<{ category: string; model: string }>(`
      select c.slug as category, vm.slug as model
        from products p
        join categories c on c.id = p.category_id and c.is_active
        join product_fitments pf on pf.product_id = p.id and pf.fitment_type <> 'NOT_COMPATIBLE'
        join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
        join vehicle_models vm on vm.id = vc.vehicle_model_id
       where p.is_active group by 1, 2 limit 1`);

    const paths = [
      '/',
      '/products',
      '/vehicles',
      `/products/${encodeURIComponent(rows[0]!.slug)}`,
      ...(landing.length > 0 ? [`/parts/${landing[0]!.category}/${landing[0]!.model}`] : []),
      '/cart',
      '/checkout',
      '/login',
    ];

    for (const [width, height, name] of BREAKPOINTS) {
      await page.setViewportSize({ width, height });
      for (const path of paths) {
        await page.goto(path);
        const overflow = await horizontalOverflow(page);
        expect(overflow, `${path} overflows at ${width}px (${name})`).toBeNull();
      }
    }
  });

  test('primary actions keep a touch-sized target on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport is set explicitly');
    await page.setViewportSize({ width: 360, height: 780 });

    const rows = await query<{ slug: string }>(
      `select p.slug from products p join inventory i on i.product_id = p.id
        where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0 limit 1`,
    );
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);

    const addToCart = page.getByRole('button', { name: /افزودن به سبد/ }).first();
    const box = await addToCart.boundingBox();
    // 44px is the smallest reliably tappable target.
    expect(box!.height, 'add-to-cart must stay tappable at 360px').toBeGreaterThanOrEqual(44);
  });

  test('the compatibility module reads correctly at phone width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport is set explicitly');
    await page.setViewportSize({ width: 360, height: 780 });

    const rows = await query<{ slug: string }>(`select slug from products where is_active limit 1`);
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);

    const panel = page.getByRole('region', { name: 'آیا این قطعه مناسب خودروی شماست؟' });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(360);
    expect(await horizontalOverflow(page)).toBeNull();
  });

  test('the product page is usable at 360px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile only');
    const rows = await query<{ slug: string }>(`select slug from products where is_active limit 1`);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);

    expect(await horizontalOverflow(page)).toBeNull();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /افزودن به سبد/ }).first()).toBeVisible();

    // Wide spec tables must scroll inside their own container.
    const table = page.locator('.scroll-x').first();
    await expect(table).toHaveCSS('overflow-x', 'auto');
  });
});

test.describe('accessibility basics', () => {
  test('every page has exactly one h1 and a skip link', async ({ page }) => {
    for (const [path] of PAGES.slice(0, 6)) {
      await page.goto(path);
      const h1 = page.locator('h1');
      expect(await h1.count(), `${path} should have one <h1>`).toBe(1);
      await expect(page.getByRole('link', { name: 'پرش به محتوای اصلی' })).toHaveCount(1);
    }
  });

  test('form fields are labelled', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('شمارهٔ موبایل')).toBeVisible();
    await expect(page.getByLabel('رمز عبور')).toBeVisible();
  });

  test('images carry alt text', async ({ page }) => {
    await page.goto('/products');
    const missing = await page.evaluate(() =>
      Array.from(document.images).filter((img) => !img.hasAttribute('alt')).length,
    );
    expect(missing).toBe(0);
  });
});

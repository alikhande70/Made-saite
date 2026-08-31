/**
 * Search visibility, end to end against the running server.
 *
 * The unit and integration suites prove the rules and the queries. These prove
 * the wiring: that the sitemap index really is served at the advertised URL,
 * that chunk routes really 404 on a guessed name, and that the admin surface is
 * really behind authentication.
 */
import { expect, test } from '@playwright/test';
import { query, clientIpHeaders, signIn, DEMO_ADMIN } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('searchvis') });

test.describe('sitemap', () => {
  test('the index is served, well-formed, and lists every group', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');

    const xml = await response.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<sitemapindex');
    expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
    for (const group of ['static', 'products', 'categories', 'brands', 'vehicles']) {
      expect(xml).toContain(`/sitemaps/${group}-1.xml`);
    }
  });

  test('a chunk is served and contains only canonical product URLs', async ({ request }) => {
    const response = await request.get('/sitemaps/products-1.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain('<urlset');

    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc).toContain('/products/');
      expect(loc).not.toContain('?');
    }
  });

  test('every URL in the product sitemap actually answers 200', async ({ request }) => {
    // A sitemap that advertises a 404 is worse than one that omits the page.
    const xml = await (await request.get('/sitemaps/products-1.xml')).text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!).slice(0, 8);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const path = new URL(loc).pathname;
      expect((await request.get(path)).status(), `${path} must answer 200`).toBe(200);
    }
  });

  test('a guessed or malformed chunk name is a 404, not an empty file', async ({ request }) => {
    for (const name of ['products-999.xml', 'products-01.xml', 'orders-1.xml', 'products-1.txt']) {
      expect((await request.get(`/sitemaps/${name}`)).status(), name).toBe(404);
    }
  });

  test('no inactive product appears in the sitemap', async ({ request }) => {
    const inactive = await query<{ slug: string }>(
      `select slug from products where is_active = false limit 3`,
    );
    test.skip(inactive.length === 0, 'seed has no inactive product');
    const xml = await (await request.get('/sitemaps/products-1.xml')).text();
    for (const row of inactive) {
      expect(xml).not.toContain(encodeURIComponent(row.slug));
    }
  });

  test('no private surface appears anywhere in the sitemap', async ({ request }) => {
    const index = await (await request.get('/sitemap.xml')).text();
    const files = [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
    for (const file of files) {
      const xml = await (await request.get(new URL(file).pathname)).text();
      for (const forbidden of ['/admin', '/account', '/cart', '/checkout', '/orders', '/api', '/login', '/search']) {
        expect(xml, `${file} must not advertise ${forbidden}`).not.toContain(`<loc>${new URL(file).origin}${forbidden}`);
      }
    }
  });
});

test.describe('robots', () => {
  test('advertises the sitemap and blocks only private surfaces', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toMatch(/Sitemap:\s*http.*\/sitemap\.xml/i);
    for (const path of ['/admin', '/account', '/cart', '/checkout', '/orders', '/api']) {
      expect(body).toContain(`Disallow: ${path}`);
    }
    // Faceted listings must stay crawlable — they carry noindex instead, which
    // a blocked crawler could never see.
    expect(body).not.toMatch(/Disallow:\s*\/products\s*$/m);
    expect(body).not.toMatch(/Disallow:\s*\/categories/);
  });
});

test.describe('canonical and indexability', () => {
  test('a product page is indexable and self-canonical', async ({ page }) => {
    const rows = await query<{ slug: string }>(
      `select slug from products where is_active = true limit 1`,
    );
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/products/');
    const robots = await page.locator('meta[name="robots"]').count();
    if (robots > 0) {
      expect(await page.locator('meta[name="robots"]').getAttribute('content')).not.toContain('noindex');
    }
  });

  test('a filtered listing is noindex, follow and canonicalises to the bare URL', async ({ page }) => {
    await page.goto('/products?sort=price&page=2');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // follow must survive, or products only reachable behind a filter are stranded.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /follow/);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/\/products$/);
  });

  test('the bare listing is indexable', async ({ page }) => {
    await page.goto('/products');
    const content = await page.locator('meta[name="robots"]').getAttribute('content');
    if (content) expect(content).not.toContain('noindex');
  });
});

test.describe('structured data', () => {
  test('the visible breadcrumb and the BreadcrumbList agree', async ({ page }) => {
    const rows = await query<{ slug: string }>(
      `select p.slug from products p join categories c on c.id = p.category_id
       where p.is_active = true limit 1`,
    );
    test.skip(rows.length === 0, 'no categorised product');
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const crumbLd = blocks
      .map((b) => JSON.parse(b) as { '@type': string; itemListElement?: { name: string }[] })
      .find((d) => d['@type'] === 'BreadcrumbList');
    expect(crumbLd).toBeDefined();

    const ldNames = crumbLd!.itemListElement!.map((i) => i.name);
    const visible = await page.getByRole('navigation', { name: 'مسیر صفحه' }).getByRole('listitem').allInnerTexts();
    const visibleNames = visible.map((t) => t.trim()).filter(Boolean);

    // Structured data that contradicts the page is worse than none at all.
    expect(ldNames).toEqual(visibleNames);
  });

  test('never emits a rating, review or review count', async ({ page }) => {
    const rows = await query<{ slug: string }>(`select slug from products where is_active = true limit 3`);
    for (const row of rows) {
      await page.goto(`/products/${encodeURIComponent(row.slug)}`);
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      for (const block of blocks) {
        expect(block).not.toContain('aggregateRating');
        expect(block).not.toContain('reviewCount');
        expect(block).not.toContain('ratingValue');
      }
    }
  });

  test('the offer price is the Rial conversion of the stored Toman price', async ({ page }) => {
    const rows = await query<{ slug: string; effective: string }>(
      `select slug, coalesce(sale_price, price)::text as effective
         from products where is_active = true limit 1`,
    );
    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = blocks
      .map((b) => JSON.parse(b) as { '@type': string; offers?: { price: number; priceCurrency: string } })
      .find((d) => d['@type'] === 'Product');
    expect(product!.offers!.priceCurrency).toBe('IRR');
    expect(product!.offers!.price).toBe(Number(rows[0]!.effective) * 10);
  });
});

test.describe('admin search visibility', () => {
  test('is not reachable without signing in', async ({ page }) => {
    await page.goto('/admin/search-visibility');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the action endpoint rejects an anonymous caller', async ({ request }) => {
    const response = await request.post('/api/admin/search-visibility', {
      data: { action: 'drainNow', adapter: 'indexnow' },
    });
    expect(response.status()).toBe(401);
  });

  test('shows sitemap groups, engine status and health to an admin', async ({ page }) => {
    await signIn(page, DEMO_ADMIN);
    await page.goto('/admin/search-visibility');
    await expect(page.getByRole('heading', { name: 'دیده‌شدن در جست‌وجو' })).toBeVisible();
    await expect(page.getByText('امتیاز سلامت سئو')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'نقشهٔ سایت' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'موتورهای جست‌وجو' })).toBeVisible();
    // The sitemap table must name every group, not merely exist.
    for (const group of ['products', 'categories', 'brands', 'vehicles']) {
      await expect(page.getByRole('link', { name: `/sitemaps/${group}-1.xml` })).toBeVisible();
    }
  });
});

test.describe('IndexNow key file', () => {
  test('is not served when no key is configured', async ({ request }) => {
    // The E2E server runs without INDEXNOW_KEY, so nothing may answer here.
    const response = await request.get('/abcdefghijkl.txt');
    expect(response.status()).toBe(404);
  });

  test('robots.txt still resolves, and is not shadowed by the key-file matcher', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('User-Agent');
  });
});

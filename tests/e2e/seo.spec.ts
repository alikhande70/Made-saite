/**
 * SEO: metadata, canonical URLs, structured data derived from real state,
 * sitemap and robots.
 */
import { expect, test } from '@playwright/test';
import { query, clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('seo') });

test.describe('SEO', () => {
  test('the home page has Persian metadata and Open Graph tags', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/قطعات یدکی/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /قطعات/);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'fa_IR');
    // metadataBase + canonical '/' renders the bare origin.
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBe(new URL('/', page.url()).origin);
  });

  test('a product page emits Product structured data from real state', async ({ page }) => {
    const rows = await query<{ slug: string; sku: string; price: string; sale_price: string | null }>(
      `select p.slug, p.sku, p.price, p.sale_price from products p
       join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved > 0 limit 1`,
    );
    const product = rows[0]!;
    await page.goto(`/products/${encodeURIComponent(product.slug)}`);

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = blocks.map((b) => JSON.parse(b) as Record<string, unknown>);
    const productLd = parsed.find((b) => b['@type'] === 'Product') as
      | { sku: string; offers: { price: number; priceCurrency: string; availability: string }; aggregateRating?: unknown; review?: unknown }
      | undefined;

    expect(productLd).toBeDefined();
    expect(productLd!.sku).toBe(product.sku);

    // Price must match the database, expressed in Rial (Toman × 10).
    const effective = Number(product.sale_price ?? product.price);
    expect(productLd!.offers.price).toBe(effective * 10);
    expect(productLd!.offers.priceCurrency).toBe('IRR');
    expect(productLd!.offers.availability).toBe('https://schema.org/InStock');

    // The store has no review data, so none may be claimed.
    expect(productLd!.aggregateRating).toBeUndefined();
    expect(productLd!.review).toBeUndefined();

    expect(parsed.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true);
  });

  test('an out-of-stock product reports OutOfStock', async ({ page }) => {
    const rows = await query<{ slug: string }>(
      `select p.slug from products p join inventory i on i.product_id = p.id
       where p.is_active and i.quantity_on_hand - i.quantity_reserved <= 0 limit 1`,
    );
    test.skip(rows.length === 0, 'no out-of-stock demo product');

    await page.goto(`/products/${encodeURIComponent(rows[0]!.slug)}`);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const productLd = blocks
      .map((b) => JSON.parse(b) as { '@type': string; offers?: { availability: string } })
      .find((b) => b['@type'] === 'Product');
    expect(productLd!.offers!.availability).toBe('https://schema.org/OutOfStock');
  });

  test('the sitemap lists active products and excludes private routes', async ({ request }) => {
    /*
     * `/sitemap.xml` is now an index rather than a flat url set, so this walks
     * it. The assertion is unchanged in substance and deliberately kept: every
     * active product must still be advertised, and no private route may be.
     */
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    const indexXml = await index.text();
    expect(indexXml).toContain('<sitemapindex');

    const files = [...indexXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
    expect(files.length).toBeGreaterThan(0);

    let combined = '';
    for (const file of files) {
      const chunk = await request.get(new URL(file).pathname);
      expect(chunk.status(), `${file} must be served`).toBe(200);
      combined += await chunk.text();
    }

    expect(combined).toContain('/products');
    expect(combined).toContain('/categories');
    for (const forbidden of ['/admin', '/account', '/checkout', '/api/']) {
      expect(combined, `sitemap must not expose ${forbidden}`).not.toContain(forbidden);
    }

    const active = await query<{ n: string }>(`select count(*)::text as n from products where is_active`);
    const urlCount = (combined.match(/<loc>/g) ?? []).length;
    expect(urlCount).toBeGreaterThanOrEqual(Number(active[0]!.n));
  });

  test('robots.txt disallows transactional and admin paths', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    for (const path of ['/admin', '/account', '/cart', '/checkout', '/api']) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text).toContain('Sitemap:');
  });

  test('private pages are marked noindex', async ({ page }) => {
    for (const path of ['/cart', '/login', '/orders/track']) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots, `${path} should be noindex`).toContain('noindex');
    }
  });

  /*
   * Regression guard for a soft-404.
   *
   * A `loading.tsx` above these routes makes Next flush the response before
   * the page component runs, so `notFound()` can only swap the body and the
   * status stays 200 — a soft 404 that search engines index and monitoring
   * reads as healthy. Loading boundaries therefore live only on routes that
   * never call `notFound()`; this test fails if one is added above one that
   * does.
   */
  test('missing resources answer with a real 404 status, not a soft 404', async ({ request }) => {
    const missing = [
      '/products/no-such-product-slug',
      '/categories/no-such-category',
      '/brands/no-such-brand',
      '/parts/no-such-category/no-such-vehicle',
      '/orders/track/not-a-real-tracking-token',
    ];
    for (const path of missing) {
      const response = await request.get(path);
      expect(response.status(), `${path} must answer 404`).toBe(404);
    }
  });

  test('faceted catalogue URLs are noindex while the bare listing is indexable', async ({ page }) => {
    // The bare listing is the one canonical, indexable URL for the surface.
    await page.goto('/products');
    expect(await page.locator('meta[name="robots"]').first().getAttribute('content')).toContain('index');
    expect(await page.locator('meta[name="robots"]').first().getAttribute('content')).not.toContain('noindex');

    // Any filter, sort or page combination is served but not indexed (ADR-004).
    for (const query of ['?inStock=true', '?sort=price_asc', '?minPrice=100000&maxPrice=900000', '?page=2']) {
      await page.goto(`/products${query}`);
      const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
      expect(robots, `/products${query} must be noindex`).toContain('noindex');
      // `follow` is kept so link equity still reaches the products themselves.
      expect(robots, `/products${query} must stay followable`).toContain('follow');
    }
  });

  test('a vehicle landing page is indexable only above the inventory threshold', async ({ page }) => {
    const qualifying = await query<{ category: string; model: string }>(
      `select c.slug as category, vm.slug as model
         from products p
         join categories c on c.id = p.category_id and c.is_active
         join product_fitments pf on pf.product_id = p.id and pf.fitment_type <> 'NOT_COMPATIBLE'
         join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
         join vehicle_models vm on vm.id = vc.vehicle_model_id
        where p.is_active
        group by 1, 2
       having count(distinct p.id) >= 3
        limit 1`,
    );
    test.skip(qualifying.length === 0, 'no pairing clears the landing-page threshold');

    const { category, model } = qualifying[0]!;
    await page.goto(`/parts/${category}/${model}`);
    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots).toContain('index');
    expect(robots).not.toContain('noindex');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href', new RegExp(`/parts/${category}/${model}$`),
    );

    // A pairing below the threshold still renders, but must not be indexed.
    const thin = await query<{ category: string; model: string }>(
      `select c.slug as category, vm.slug as model
         from products p
         join categories c on c.id = p.category_id and c.is_active
         join product_fitments pf on pf.product_id = p.id and pf.fitment_type <> 'NOT_COMPATIBLE'
         join vehicle_configurations vc on vc.id = pf.vehicle_configuration_id
         join vehicle_models vm on vm.id = vc.vehicle_model_id
        where p.is_active
        group by 1, 2
       having count(distinct p.id) < 3
        limit 1`,
    );
    if (thin.length > 0) {
      await page.goto(`/parts/${thin[0]!.category}/${thin[0]!.model}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.locator('meta[name="robots"]').first().getAttribute('content')).toContain('noindex');
    }
  });

  test('security headers are present', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

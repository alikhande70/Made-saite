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
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();

    expect(xml).toContain('/products');
    expect(xml).toContain('/categories');
    for (const forbidden of ['/admin', '/account', '/checkout', '/api/']) {
      expect(xml, `sitemap must not expose ${forbidden}`).not.toContain(forbidden);
    }

    const active = await query<{ n: string }>(`select count(*)::text as n from products where is_active`);
    const urlCount = (xml.match(/<loc>/g) ?? []).length;
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

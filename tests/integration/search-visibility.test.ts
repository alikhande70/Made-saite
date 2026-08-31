/**
 * Search visibility — integration level, against a real database.
 *
 * The unit tests prove the rules. These prove the rules are actually applied to
 * live rows: that an inactive product really is absent from the sitemap, that
 * two edits really do collapse to one submission, and that a search engine
 * being broken really does not break saving a product.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closePool, getDb } from '@/infrastructure/db/client';
import { products, searchSubmissionEvents } from '@/infrastructure/db/schema';
import {
  countGroup, renderSitemapIndex, renderUrlSet, sitemapEntries, sitemapIndex,
} from '@/application/search-visibility/sitemap-service';
import {
  drainOutbox, enqueueSubmissions, retryFailedSubmissions, summariseOutbox,
} from '@/application/search-visibility/outbox';
import { notifyUrlsChanged, setAdaptersForTesting } from '@/application/search-visibility';
import { getSeoHealth } from '@/application/search-visibility/seo-health';
import { IndexNowAdapter } from '@/application/search-visibility/indexnow-adapter';
import type { SearchEngineAdapter, SubmissionOutcome } from '@/application/search-visibility/adapter';
import { SUBMISSION_MAX_ATTEMPTS } from '@/domain/search-visibility';
import { createBrand, createCategory, createProduct, resetDatabase } from '../helpers/factory';

const BASE = 'https://madesaite.example';
const db = getDb();

/** A stub adapter whose every call is recorded and whose verdict is scripted. */
function stubAdapter(outcome: SubmissionOutcome, id = 'stub'): SearchEngineAdapter & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    id,
    displayNameFa: 'آزمایشی',
    supportsInstantSubmission: true,
    maxBatchSize: 100,
    calls,
    validateConfiguration: () => ({ configured: true, reasonFa: null }),
    submitUrl: async (url) => { calls.push([url]); return outcome; },
    submitBatch: async (urls) => { calls.push([...urls]); return outcome; },
  };
}

const OK: SubmissionOutcome = { ok: true, status: 200, retryable: false, message: 'ok' };
const SOFT_FAIL: SubmissionOutcome = { ok: false, status: 503, retryable: true, message: 'unavailable' };
const HARD_FAIL: SubmissionOutcome = { ok: false, status: 403, retryable: false, message: 'bad key' };

/**
 * The test database is created empty, so each test builds the rows it needs.
 * Three active products and one inactive one is enough to prove the sitemap
 * follows database truth without making the fixtures the subject.
 */
beforeEach(async () => {
  await resetDatabase();
  const category = await createCategory('فیلترها');
  const brand = await createBrand('بوش');
  await createProduct({ titleFa: 'فیلتر روغن', categoryId: category.id, brandId: brand.id });
  await createProduct({ titleFa: 'فیلتر هوا', categoryId: category.id, brandId: brand.id });
  await createProduct({ titleFa: 'فیلتر بنزین', categoryId: category.id, brandId: brand.id });
  await createProduct({ titleFa: 'کالای غیرفعال', categoryId: category.id, brandId: brand.id, isActive: false });
});

afterAll(closePool);

describe('sitemap reflects database truth', () => {
  it('lists only active products', async () => {
    const [victim] = await db
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(eq(products.isActive, true))
      .limit(1);
    expect(victim).toBeDefined();

    const before = await sitemapEntries('products', 1, BASE);
    expect(before.some((e) => e.url.endsWith(encodeURIComponent(victim!.slug)))).toBe(true);

    await db.update(products).set({ isActive: false }).where(eq(products.id, victim!.id));
    try {
      const after = await sitemapEntries('products', 1, BASE);
      // The falsification: a deactivated product must leave the sitemap.
      expect(after.some((e) => e.url.endsWith(encodeURIComponent(victim!.slug)))).toBe(false);
      expect(after.length).toBe(before.length - 1);
    } finally {
      await db.update(products).set({ isActive: true }).where(eq(products.id, victim!.id));
    }
  });

  it('never emits a private, filtered or off-origin URL', async () => {
    for (const group of ['static', 'products', 'categories', 'brands', 'vehicles'] as const) {
      const entries = await sitemapEntries(group, 1, BASE);
      for (const entry of entries) {
        expect(entry.url.startsWith(`${BASE}/`)).toBe(true);
        expect(entry.url).not.toContain('?');
        expect(entry.url).not.toMatch(/\/(admin|account|cart|checkout|orders|api|login|register|search)(\/|$)/);
      }
    }
  });

  it('emits lastmod only where a real timestamp exists', async () => {
    const productEntries = await sitemapEntries('products', 1, BASE);
    expect(productEntries.every((e) => e.lastModified instanceof Date)).toBe(true);

    // Categories and brands have no meaningful modification time, so they must
    // not invent one — a synthesised lastmod is a false claim.
    for (const group of ['categories', 'brands', 'static'] as const) {
      const entries = await sitemapEntries(group, 1, BASE);
      expect(entries.every((e) => e.lastModified === null)).toBe(true);
    }
  });

  it('produces a well-formed index covering every group', async () => {
    const index = await sitemapIndex(BASE, db);
    const xml = renderSitemapIndex(index);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
    for (const group of ['static', 'products', 'categories', 'brands', 'vehicles']) {
      expect(xml).toContain(`/sitemaps/${group}-1.xml`);
    }
  });

  it('escapes XML and percent-encodes Persian slugs in the rendered urlset', async () => {
    const xml = renderUrlSet(await sitemapEntries('products', 1, BASE));
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      // Nothing inside a <loc> may be a raw markup character; `&` must already
      // be an entity if present at all.
      expect(loc).not.toMatch(/[<>"']/);
      expect(loc.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, '')).not.toContain('&');
    }
  });

  it('counts only active products, and pages beyond the group are empty', async () => {
    // Four products exist; one is inactive.
    expect(await countGroup('products', db)).toBe(3);
    // Page 2 of a small catalogue holds nothing; the route turns this into a 404.
    expect(await sitemapEntries('products', 2, BASE)).toEqual([]);
  });
});

describe('submission outbox', () => {
  it('enqueues one row per URL', async () => {
    const n = await enqueueSubmissions(
      { urls: [`${BASE}/products/a`, `${BASE}/products/b`], eventType: 'manual', adapterId: 'stub' },
      db,
    );
    expect(n).toBe(2);
  });

  it('deduplicates: repeated edits collapse to one pending submission', async () => {
    const url = `${BASE}/products/a`;
    const first = await enqueueSubmissions({ urls: [url], eventType: 'product.updated', adapterId: 'stub' }, db);
    const second = await enqueueSubmissions({ urls: [url], eventType: 'product.updated', adapterId: 'stub' }, db);
    const third = await enqueueSubmissions(
      { urls: [`${url}?utm=1`, `${url}#x`], eventType: 'product.updated', adapterId: 'stub' }, db,
    );
    expect(first).toBe(1);
    // The falsification: an afternoon of admin edits must not become a flood.
    expect(second).toBe(0);
    expect(third).toBe(0);

    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(searchSubmissionEvents);
    expect(rows[0]!.n).toBe(1);
  });

  it('re-enqueues once a previous submission has settled', async () => {
    const url = `${BASE}/products/a`;
    await enqueueSubmissions({ urls: [url], eventType: 'product.updated', adapterId: 'stub' }, db);
    await drainOutbox(stubAdapter(OK), {}, db);
    // Settled, so a genuinely new change is a genuinely new submission.
    expect(await enqueueSubmissions({ urls: [url], eventType: 'product.updated', adapterId: 'stub' }, db)).toBe(1);
  });

  it('marks a successful batch SUCCEEDED and submits every claimed URL once', async () => {
    await enqueueSubmissions(
      { urls: [`${BASE}/a`, `${BASE}/b`, `${BASE}/c`], eventType: 'manual', adapterId: 'stub' }, db,
    );
    const adapter = stubAdapter(OK);
    const result = await drainOutbox(adapter, {}, db);

    expect(result).toMatchObject({ claimed: 3, succeeded: 3, failed: 0 });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toHaveLength(3);

    const summary = await summariseOutbox(db);
    expect(summary.succeeded).toBe(3);
    expect(summary.pending).toBe(0);
  });

  it('returns a retryable failure to PENDING with a later next attempt', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    const before = new Date();
    await drainOutbox(stubAdapter(SOFT_FAIL), {}, db);

    const [row] = await db.select().from(searchSubmissionEvents);
    expect(row!.status).toBe('PENDING');
    expect(row!.attemptCount).toBe(1);
    expect(row!.lastError).toBe('unavailable');
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('schedules due-ness in database time', async () => {
    /*
     * Related to a CI-only failure where the claim compared a database-written
     * `next_attempt_at` against a `new Date()` from Node, so clock skew between
     * the two left a freshly enqueued row looking not-yet-due.
     *
     * Being honest about what this test does and does not prove: it pins the
     * *semantics* — scheduling is expressed and evaluated in database time —
     * but it cannot reproduce the skew itself, because here both clocks belong
     * to the same machine. It passes against the buggy implementation too. The
     * actual fix is structural (Node's clock no longer appears in the
     * comparison at all) and CI is what verifies it.
     */
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);

    // Scheduled one minute ahead in *database* time.
    await db.execute(sql`update search_submission_events set next_attempt_at = now() + interval '1 minute'`);
    expect((await drainOutbox(stubAdapter(OK), {}, db)).claimed).toBe(0);

    // Due in database time — must be claimed regardless of what Node's clock says.
    await db.execute(sql`update search_submission_events set next_attempt_at = now() - interval '1 minute'`);
    expect((await drainOutbox(stubAdapter(OK), {}, db)).claimed).toBe(1);
  });

  it('honours an explicitly pinned moment when one is given', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    // A caller that pins the past sees nothing due, whatever the row says.
    const past = new Date(Date.now() - 86_400_000);
    expect((await drainOutbox(stubAdapter(OK), { now: past }, db)).claimed).toBe(0);
  });

  it('does not re-claim a row before its next attempt is due', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    await drainOutbox(stubAdapter(SOFT_FAIL), {}, db);
    const second = stubAdapter(SOFT_FAIL);
    const result = await drainOutbox(second, {}, db);
    // Backoff is real, not decorative.
    expect(result.claimed).toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  it('parks a non-retryable failure immediately rather than burning attempts', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    const result = await drainOutbox(stubAdapter(HARD_FAIL), {}, db);
    expect(result.parked).toBe(1);
    const [row] = await db.select().from(searchSubmissionEvents);
    expect(row!.status).toBe('FAILED');
    expect(row!.attemptCount).toBe(1);
  });

  it('parks a retryable failure once its attempts are exhausted', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    for (let i = 0; i < SUBMISSION_MAX_ATTEMPTS; i += 1) {
      // Force the row due again so the loop is not fighting its own backoff.
      await db.update(searchSubmissionEvents).set({ nextAttemptAt: new Date(0) });
      await drainOutbox(stubAdapter(SOFT_FAIL), {}, db);
    }
    const [row] = await db.select().from(searchSubmissionEvents);
    expect(row!.status).toBe('FAILED');
    expect(row!.attemptCount).toBeGreaterThanOrEqual(SUBMISSION_MAX_ATTEMPTS);
  });

  it('requeues failures on demand', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'stub' }, db);
    await drainOutbox(stubAdapter(HARD_FAIL), {}, db);
    expect(await retryFailedSubmissions('stub', db)).toBe(1);
    const [row] = await db.select().from(searchSubmissionEvents);
    expect(row!.status).toBe('PENDING');
    expect(row!.attemptCount).toBe(0);
  });

  it('leaves rows untouched when the adapter is not configured', async () => {
    await enqueueSubmissions({ urls: [`${BASE}/a`], eventType: 'manual', adapterId: 'unconfigured' }, db);
    const adapter: SearchEngineAdapter = {
      ...stubAdapter(OK, 'unconfigured'),
      validateConfiguration: () => ({ configured: false, reasonFa: 'no key' }),
    };
    const result = await drainOutbox(adapter, {}, db);
    expect(result.claimed).toBe(0);
    // Still PENDING, so the backlog drains once a key is configured.
    const [row] = await db.select().from(searchSubmissionEvents);
    expect(row!.status).toBe('PENDING');
    expect(row!.attemptCount).toBe(0);
  });
});

describe('falsification: a broken search engine must not break the shop', () => {
  it('notifyUrlsChanged swallows an adapter that throws', async () => {
    const restore = setAdaptersForTesting([
      {
        id: 'exploding',
        displayNameFa: 'x',
        supportsInstantSubmission: true,
        maxBatchSize: 10,
        validateConfiguration: () => { throw new Error('boom'); },
        submitUrl: async () => { throw new Error('boom'); },
        submitBatch: async () => { throw new Error('boom'); },
      },
    ]);
    try {
      await expect(
        notifyUrlsChanged([{ kind: 'product', slug: 'x' }], 'product.updated', db),
      ).resolves.toBe(0);
    } finally {
      restore();
    }
  });

  it('an unconfigured IndexNow adapter reports why instead of throwing', async () => {
    const adapter = new IndexNowAdapter(() => undefined, () => BASE);
    expect(adapter.validateConfiguration().configured).toBe(false);
    const outcome = await adapter.submitBatch([`${BASE}/a`]);
    expect(outcome.ok).toBe(false);
    // Not retryable: waiting does not configure a key.
    expect(outcome.retryable).toBe(false);
  });

  it('refuses to submit from a non-HTTPS origin, which could only earn a 403', async () => {
    const adapter = new IndexNowAdapter(() => 'abcdef1234', () => 'http://localhost:3000');
    expect(adapter.validateConfiguration().configured).toBe(false);
  });

  it('sends the batch shape the specification defines, and treats 202 as success', async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const adapter = new IndexNowAdapter(() => 'abcdef1234', () => BASE, fakeFetch);
    const outcome = await adapter.submitBatch([`${BASE}/products/a`]);

    expect(outcome.ok).toBe(true);
    expect(captured!.url).toBe('https://api.indexnow.org/indexnow');
    expect(captured!.body).toMatchObject({
      host: 'madesaite.example',
      key: 'abcdef1234',
      keyLocation: `${BASE}/abcdef1234.txt`,
      urlList: [`${BASE}/products/a`],
    });
  });

  it('never leaks the key in a failure message', async () => {
    const fakeFetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    const adapter = new IndexNowAdapter(() => 'supersecretkey123', () => BASE, fakeFetch);
    const outcome = await adapter.submitBatch([`${BASE}/a`]);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).not.toContain('supersecretkey123');
  });
});

describe('SEO health', () => {
  it('reports a deterministic score with attributable issues', async () => {
    const first = await getSeoHealth(db);
    const second = await getSeoHealth(db);
    expect(first.score).toBe(second.score);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    for (const issue of first.issues) {
      expect(issue.count).toBeGreaterThan(0);
      expect(['ERROR', 'WARNING', 'INFO']).toContain(issue.severity);
      expect(issue.titleFa.length).toBeGreaterThan(0);
    }
  });

  it('notices a product that loses its category', async () => {
    const [victim] = await db
      .select({ id: products.id, categoryId: products.categoryId })
      .from(products)
      .where(eq(products.isActive, true))
      .limit(1);
    const before = await getSeoHealth(db);
    const beforeCount = before.issues.find((i) => i.code === 'product.no_category')?.count ?? 0;

    await db.update(products).set({ categoryId: null }).where(eq(products.id, victim!.id));
    try {
      const after = await getSeoHealth(db);
      const afterCount = after.issues.find((i) => i.code === 'product.no_category')?.count ?? 0;
      expect(afterCount).toBe(beforeCount + 1);
      // The score must actually move — an issue nobody is charged for is decoration.
      expect(after.score).toBeLessThan(before.score);
    } finally {
      await db.update(products).set({ categoryId: victim!.categoryId }).where(eq(products.id, victim!.id));
    }
  });
});

/**
 * Sitemap scale benchmark.
 *
 * Not a production performance measurement — it runs against a local database
 * with no network, no TLS and no concurrent load. Its job is narrower and more
 * useful: to find the failure modes that only appear with a real catalogue, and
 * that a 40-product demo seed can never reveal.
 *
 *   - a query that loads the whole table into memory;
 *   - generation time that grows with catalogue size rather than page size;
 *   - a chunk count that drifts from the protocol limits;
 *   - an N+1 hiding inside per-entry work.
 *
 *   npm run bench:sitemap            # 10,000 products
 *   BENCH_PRODUCTS=50000 npm run bench:sitemap
 *
 * The rows are inserted into the configured database and removed again at the
 * end, so it must not be pointed at production. It refuses to run unless the
 * database name looks like a development or test database.
 */
import './env';
import { sql } from 'drizzle-orm';
import { closePool, getDb } from '../src/infrastructure/db/client';
import { countGroup, sitemapEntries, sitemapIndex, renderUrlSet } from '../src/application/search-visibility/sitemap-service';
import { SITEMAP_URLS_PER_FILE, sitemapPageCount } from '../src/domain/search-visibility';

const BASE = 'https://bench.example';
const TARGET = Number(process.env.BENCH_PRODUCTS ?? 10_000);
const MARKER = 'bench-sitemap-';

function assertSafeDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test|dev|local|bench/i.test(name)) {
    throw new Error(
      `refusing to run against database "${name}" — the benchmark writes and deletes rows. ` +
      'Point DATABASE_URL at a development or test database.',
    );
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  assertSafeDatabase();
  const db = getDb();

  console.log(`▶ seeding ${TARGET.toLocaleString('en-US')} synthetic products`);
  const seedStart = Date.now();
  // One multi-row insert per batch; generate_series does the work server-side so
  // the benchmark is not measuring the seeding client.
  await db.execute(sql`
    insert into products (sku, slug, title_fa, price, is_active, published_at)
    select
      ${MARKER} || g,
      ${MARKER} || g,
      'کالای آزمایشی ' || g,
      1000000,
      true,
      now()
    from generate_series(1, ${TARGET}) g
    on conflict (sku) do nothing
  `);
  console.log(`  seeded in ${Date.now() - seedStart} ms`);

  const total = await countGroup('products', db);
  const pages = sitemapPageCount(total);
  console.log(`\n▶ catalogue: ${total.toLocaleString('en-US')} active products`);
  console.log(`  chunks: ${pages} × ${SITEMAP_URLS_PER_FILE.toLocaleString('en-US')} URLs`);

  // Index generation — one count per group, no row scans.
  const indexStart = Date.now();
  const index = await sitemapIndex(BASE, db);
  console.log(`\n▶ sitemap index: ${index.length} entries in ${Date.now() - indexStart} ms`);

  // First, middle and last chunk. Generation time must be flat across them: if
  // the last chunk is markedly slower, OFFSET is scanning rather than seeking.
  const probes = [1, Math.max(1, Math.ceil(pages / 2)), pages];
  let worstMs = 0;
  for (const page of probes) {
    const before = process.memoryUsage().heapUsed;
    const start = Date.now();
    const entries = await sitemapEntries('products', page, BASE, db);
    const xml = renderUrlSet(entries);
    const ms = Date.now() - start;
    worstMs = Math.max(worstMs, ms);
    const heap = process.memoryUsage().heapUsed - before;
    console.log(
      `  chunk ${String(page).padStart(3)}: ${String(entries.length).padStart(6)} URLs  ` +
      `${String(ms).padStart(5)} ms  xml=${mb(Buffer.byteLength(xml))}  heapΔ=${mb(Math.max(heap, 0))}`,
    );
    if (Buffer.byteLength(xml) > 52_428_800) {
      throw new Error(`chunk ${page} exceeds the 50 MB sitemap limit`);
    }
  }

  console.log('\n▶ cleanup');
  const deleted = await db.execute(sql`delete from products where sku like ${`${MARKER}%`}`);
  console.log(`  removed ${deleted.rowCount ?? 0} synthetic rows`);

  console.log(`\n✔ worst chunk generation: ${worstMs} ms at ${total.toLocaleString('en-US')} products`);
}

main()
  .catch((error) => {
    console.error('✖ benchmark failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());

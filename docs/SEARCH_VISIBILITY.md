# Search visibility

How Made-saite gets discovered, crawled and indexed — and, just as importantly,
how it stops itself from advertising pages that should not be indexed.

The design goal is **search-engine neutral**. Nothing below is written for one
engine's preferences. The sitemap and canonical rules follow published protocol
specifications, and change notification goes through an adapter interface so a
second engine is a new file rather than a change to the domain.

---

## 1. Architecture

```
src/domain/search-visibility.ts          pure rules — canonical, indexability,
                                         chunking, dedupe, retry, health scoring
src/application/search-visibility/
  index.ts                               SearchVisibilityService — the facade
  adapter.ts                             SearchEngineAdapter interface
  indexnow-adapter.ts                    IndexNow implementation
  outbox.ts                              submission queue: enqueue, drain, retry
  sitemap-service.ts                     bounded, truthful sitemap generation
  seo-health.ts                          counted SEO issues + deterministic score
```

Two rules hold this together:

1. **The domain layer is pure.** No database, no network, no environment beyond
   a caller-supplied base URL. Rules that can only be exercised through a
   running server are rules nobody tests properly.
2. **UI never decides.** A page component asks for a canonical or an
   indexability verdict; it does not compute one. Canonical URLs used to be
   built by hand in fourteen page files, which is how two URLs end up claiming
   to be the same resource.

Three decisions are deliberately separate and easy to conflate:

| Decision | Question | Where |
|---|---|---|
| Canonical | Which URL *is* this page? | `canonicalPath` / `canonicalUrl` |
| Indexable | May a crawler keep it? | `listingRobots`, `isLandingPageIndexable` |
| Sitemap-eligible | Should we advertise it? | `assertSitemapCoherent` + the queries |

Sitemap eligibility is strictly narrower than indexability. A page may never be
advertised without being indexable — a sitemap that lists a `noindex` URL is a
self-contradiction that crawlers report as an error.

---

## 2. Sitemap

### Structure

```
/sitemap.xml                    sitemap index (declared in robots.txt)
  └── /sitemaps/static-1.xml
  └── /sitemaps/products-1.xml, products-2.xml, …
  └── /sitemaps/categories-1.xml
  └── /sitemaps/brands-1.xml
  └── /sitemaps/vehicles-1.xml
```

Groups exist so a crawler can re-fetch only what changed, and so one runaway
table cannot push everything else out of a single file.

### Protocol limits

From [sitemaps.org/protocol.html](https://www.sitemaps.org/protocol.html):
50,000 URLs and 50 MB uncompressed per file; 50,000 sitemaps per index. We chunk
at **10,000 URLs per file**, far below both ceilings, so a chunk stays small
enough to generate from one bounded query. Measured at 50,000 products a chunk
renders to 1.2 MB.

Chunking is deterministic: `products-2.xml` is always rows 10,000–19,999 ordered
by `id`. Ordering by `id` rather than `updatedAt` keeps a product in the same
file when it is edited — ordering by modification time would reshuffle the whole
catalogue between files on every save.

### Truth rules

A URL appears only if it is public, active, canonical and expected to answer
200. The queries select exactly the rows the corresponding page would render,
and **every entry is additionally checked** by `assertSitemapCoherent`, which
throws on anything off-origin, carrying a query string, or under a private
prefix (`/admin`, `/account`, `/cart`, `/checkout`, `/orders`, `/api`,
`/payment`, `/login`, `/register`, `/search`).

That check is redundant if the queries are correct. That is precisely why it is
there: a future query bug cannot leak a private URL past it.

### lastmod

Emitted **only where a real timestamp exists** — products carry
`products.updated_at`; categories, brands, landing pages and static pages carry
none. A synthesised `lastmod` is a false claim about the page, and crawlers that
notice one stop trusting the field.

### Scale

`npm run bench:sitemap` (`BENCH_PRODUCTS=50000` to go bigger) seeds synthetic
products, measures generation, and deletes them. It refuses to run against a
database whose name does not look like test/dev/local/bench.

Measured on a local database:

| Catalogue | Chunks | Worst chunk | XML size | Heap delta |
|---|---|---|---|---|
| 10,040 products | 2 | 120 ms | 1.2 MB | 7.7 MB |
| 50,040 products | 6 | 132 ms | 1.2 MB | 7.5 MB |

Generation time is flat with catalogue size, which is the property that matters:
it confirms each chunk costs one bounded query rather than a scan that grows.
These are LAB numbers on a local database — not production figures.

---

## 3. Canonical rules

| Surface | Canonical |
|---|---|
| Product | `/products/{slug}` |
| Category | `/categories/{slug}` |
| Brand | `/brands/{slug}` |
| Vehicle × category landing | `/parts/{categorySlug}/{modelSlug}` |
| Listing with filters | the **bare** listing URL |
| Listing page 2..n | the **bare** listing URL |
| Search results | site root (the page is `noindex` anyway) |

Persian slugs are percent-encoded exactly once. `canonicalPath` decodes-once
before encoding, so a caller passing either the raw or the already-encoded form
lands on the same canonical — double-encoding is the specific bug that produced
two canonicals for one product.

---

## 4. Indexability and faceted navigation

A catalogue with *n* filters has 2^n reachable URLs. Letting a crawler index
them produces thin near-duplicate pages and burns crawl budget on states no
human would link to.

| URL shape | Directive |
|---|---|
| `/products` | `index, follow` |
| `/products?brand=…&sort=…&page=…` | `noindex, follow` |
| `/categories/{slug}` | `index, follow` |
| `/parts/{category}/{model}` above threshold | `index, follow` |
| `/parts/{category}/{model}` below threshold | `noindex, follow` |
| `/search?q=…` | `noindex, follow` + disallowed in robots.txt |

`follow` is **never** withdrawn. Withdrawing it would strand products that are
only reachable through a filter.

### Why filters are not blocked in robots.txt

`Disallow` and `noindex` do different jobs, and confusing them keeps a page in
the index permanently: a crawler blocked from fetching a URL can never see the
`noindex` on it. So robots.txt blocks only surfaces that must never be *fetched*.

`/search` is the one deliberate exception — both disallowed and `noindex` —
because search-result pages generate unbounded distinct URLs from user input and
the crawl-budget argument outweighs the redundancy.

---

## 5. Vehicle × part landing pages

This is the shop's structural SEO advantage and its biggest spam risk. The rule
that separates programmatic SEO from mass thin-page generation:

A pairing is indexable only when **all** of these hold:

- the category is active;
- the vehicle model is active;
- at least one **positive** fitment row exists (`fitment_type <> 'NOT_COMPATIBLE'`);
- the number of live products is at least `SEO_LANDING_MIN_PRODUCTS` (default 3).

Below the threshold the page is still **served** — a customer following a link
gets a real page — but it is `noindex` and absent from the sitemap.

Nothing here derives compatibility from a name or a category. Absence of
evidence is never compatibility.

---

## 6. Structured data

Emitted from database rows only. `Product`, `Offer`, `Brand`, `Manufacturer`,
`BreadcrumbList`, and `Organization`/`WebSite` on the root.

**Never emitted:** `aggregateRating`, `reviewCount`, `ratingValue`, fabricated
discounts, invented stock or shipping claims. If the data does not exist, the
property is omitted. An E2E test asserts this on every product page.

Currency: prices are stored as integer **Toman**. schema.org expects the
national currency, so `Offer.priceCurrency` is `IRR` and the price is
`toman × 10` — the same conversion boundary the payment adapters use.

The visible breadcrumb and the `BreadcrumbList` are built from **one array**.
They had drifted apart before this phase — the JSON-LD omitted a level the page
showed — and structured data that contradicts the page is worse than none.

---

## 7. Change notification (IndexNow)

### Why IndexNow first

IndexNow is a shared protocol, not one company's API: one submission is
forwarded to every participating engine (Bing, Yandex, Seznam, Naver and
others). One integration, several engines, no per-engine credentials.

**Google does not participate.** Google discovers changes through the sitemap
and Search Console. That is why the sitemap is the load-bearing part of this
subsystem and IndexNow is an accelerator on top of it.

### Setup

1. Generate a key — 8–128 characters from `[a-zA-Z0-9-]`:
   ```sh
   openssl rand -hex 16
   ```
2. Set it in `.env.production`:
   ```
   INDEXNOW_KEY=<the key>
   ```
3. The key file is served automatically at `https://<domain>/<key>.txt` by
   `src/middleware.ts`. Verify after deploy:
   ```sh
   curl https://<domain>/<key>.txt   # must return the key, nothing else
   ```

`SITE_URL` must be a real HTTPS domain. The adapter refuses to submit otherwise,
because an engine that cannot fetch the key file over HTTPS at the real domain
can only answer 403.

### The outbox

Nothing in a request path talks to a search engine. An admin saving a product
enqueues a row in `search_submission_events`; the background sweeper drains it.

```
PENDING ──claim──> PROCESSING ──ok──> SUCCEEDED
                        │
                        ├─ retryable failure ─> PENDING (backoff)
                        └─ fatal / attempts exhausted ─> FAILED
```

| Property | How |
|---|---|
| Crash-safe | The row commits with the write that caused it |
| Deduplicated | Partial unique index on `(url, adapter)` for unsettled rows |
| Retryable | Exponential backoff, 1 → 60 min, 5 attempts |
| Concurrent-safe | `FOR UPDATE SKIP LOCKED` — replicas split the work |
| Observable | Every row visible in the admin with its last error |

Retry is status-aware: 429 and 5xx are retried; 400, 403 and 422 are our mistake
and retrying would only earn a 429, so those park immediately for a human.

### What triggers a submission

Only SEO-relevant state changes — product created, activated, deactivated,
updated, or its slug changed. A slug change submits **both** URLs: the new one
so it is found, the old one so the engine re-crawls and drops it.

An inactive product is not enqueued: it has no indexable URL, and telling an
engine about a page that will 404 wastes the submission.

### Failure behaviour

`notifyUrlsChanged` never throws. A search engine being unreachable must not
fail an admin's save — the submission is a recoverable side effect, and the
sitemap remains the durable path to discovery whatever happens.

---

## 8. Admin — «دیده‌شدن در جست‌وجو»

`/admin/search-visibility` shows:

- **SEO health score** and every issue that produced it;
- **indexable inventory** per sitemap group, with chunk counts and links;
- **search engines**, their configuration status, and why one is unusable;
- **submission queue** — pending, succeeded, failed, with recent failures and
  their last error;
- actions: drain the queue now, or requeue failures.

### The score

Deterministic and fully attributable. Each issue deducts
`count × severity weight` (ERROR 4, WARNING 1.5, INFO 0.25), capped at 20 points
per issue code so one bad import cannot floor the score and hide everything
else. Every point lost maps to a listed, countable issue — the number cannot
move unless a specific problem moved. That is what stops it becoming a vanity
metric.

### Severity

| Level | Meaning | Examples |
|---|---|---|
| ERROR | Cannot be indexed correctly as it stands | active product with no category or no image |
| WARNING | Will be indexed, but weakly | missing SEO description, no fitment, orphan category |
| INFO | Optional enrichment, may legitimately stay absent | no MPN, no brand, no warranty value |

Genuinely optional business fields stay INFO. Many Iranian aftermarket parts
have no manufacturer part number at all, so a missing MPN is not a defect.

---

## 9. Search engine setup (after the domain is live)

Neither of these can be done before a real domain exists. No credentials are
committed; this is the runbook, not an integration.

### Google Search Console

1. <https://search.google.com/search-console> → add a **Domain** property.
2. Verify with the DNS TXT record it provides.
3. Sitemaps → submit `sitemap.xml`.
4. URL Inspection → test a product URL, a category URL and a landing page.
5. Watch **Pages** (indexing coverage) for the first two weeks. Expect filtered
   URLs to appear as “Excluded by ‘noindex’ tag” — that is the design working,
   not a fault.
6. Core Web Vitals appear once there is enough field traffic.

### Bing Webmaster Tools

1. <https://www.bing.com/webmasters> → add the site.
2. Verify (DNS, or import the Google Search Console property).
3. Submit `sitemap.xml`.
4. **IndexNow** → confirm the key file is reachable and submissions are being
   accepted.

---

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| Submissions stay PENDING | Adapter unconfigured — the admin page states why. Rows are deliberately left PENDING so the backlog drains once a key is set. |
| Failures with 403 | Key file not reachable at `https://<domain>/<key>.txt`, or `INDEXNOW_KEY` differs from the file's contents. |
| Failures with 422 | Submitted URLs are not on the same host as the key. Check `SITE_URL`. |
| Failures with 429 | Too many submissions. The dedupe index should prevent this; if it recurs, look for a write path enqueueing on every save rather than on SEO-relevant change. |
| A product is missing from the sitemap | It is inactive, or you are looking at the wrong chunk. `countGroup('products')` gives the total. |
| A chunk URL 404s | Only `{group}-{page}.xml` with no leading zeros is valid, and the page must be within the group's extent. |
| `/robots.txt` returns the IndexNow key | Would mean the middleware matcher is wrong; an E2E test covers this. |

---

## 11. Security

- `INDEXNOW_KEY` is read from the environment, never committed. The protocol
  publishes it at a well-known URL by design — its only purpose is to prove host
  control — but it is still rotatable without a code change.
- The key is never logged. Adapter failure messages are asserted in tests not to
  contain it.
- Admin SEO endpoints go through `adminRoute` (same-origin + admin role).
- All submission happens server-side from the background sweeper. No key
  reaches the client bundle.

---

## 12. Known limits

- **Slug-change redirects.** A changed slug submits the old URL for re-crawl but
  there is no `url_redirects` table, so the old URL 404s rather than 301-ing.
  Worth adding when slugs actually start changing in production; until then it
  would be untested machinery.
- **Root `force-dynamic` is load-bearing.** `SiteHeader` reads the session
  cookie and cart count on every page, so the root layout genuinely cannot be
  static. Removing the directive would not make pages cacheable; it would only
  move where Next reports the same fact. Making the catalogue cacheable requires
  moving the cart badge to a client component — a real change, out of scope for
  this phase, and one that trades a commerce-truth risk for a caching win.
  Per-request memoisation of the store profile was added instead, removing two
  redundant queries per page render.
- **No Search Console / Bing API integration.** The adapter interface is shaped
  to accept reporting later (impressions, clicks, position) without domain
  changes, but nothing consumes those APIs today.

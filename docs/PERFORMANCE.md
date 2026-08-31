# Performance

## What was measured, and where

All figures below come from a **production build served on localhost**
(`next start`, PostgreSQL on the same host), driven by headless Chromium.

That matters for how they should be read. Localhost has no network latency, no
TLS handshake, no CDN, no packet loss and no CPU throttling. These numbers are
therefore a measurement of **server render cost, payload size and hydration
cost** — the parts the application controls — and explicitly **not** a
prediction of field Core Web Vitals for a customer on Iranian mobile data.
Nothing here has been measured on a real network, a real device, or under load.

Reproduce with a production build running on port 3100 and Chromium at
`PW_CHROME_PATH`; the measurement script is not committed because it is a
throwaway harness, and its output is transcribed below rather than asserted in
CI.

## Field-relevant metrics (localhost, warm)

| Page | Viewport | LCP | CLS | TTFB | Requests | Transfer | DOM nodes |
| ---- | -------- | --- | --- | ---- | -------- | -------- | --------- |
| `/` | 1440×900 | 256 ms | 0.0000 | 31 ms | 52 | 57 KB | 813 |
| `/products` | 1440×900 | 264 ms | 0.0000 | 40 ms | 49 | 64 KB | 997 |
| `/parts/brake-pads/peugeot-206` | 1440×900 | 220 ms | 0.0000 | 40 ms | 37 | 34 KB | 381 |
| `/` | 360×780 | 224 ms | 0.0000 | 34 ms | 29 | 48 KB | 815 |
| `/products` | 360×780 | 220 ms | 0.0000 | 30 ms | 37 | 56 KB | 996 |
| `/parts/brake-pads/peugeot-206` | 360×780 | 184 ms | 0.0000 | 28 ms | 27 | 29 KB | 381 |

**CLS is 0.0000 on every page.** That is a design outcome, not luck: product
images sit in a fixed `aspect-square` box, the header is a fixed height, and
there is no late-injected banner or ad slot to push content down.

INP was not measured. It needs real interaction traces from real users; a
synthetic single-page run would produce a number with no meaning.

## Server response time

Ten sequential requests each, warm, measured with `curl`:

| Path | Mean |
| ---- | ---- |
| `/` | 70 ms |
| `/products` | 48 ms |
| `/search?q=فیلتر` | 66 ms |
| `/parts/brake-pads/peugeot-206` | 34 ms |

Every page is `force-dynamic` — prices and stock must never be served stale —
so these include the database round trips on every request.

## JavaScript

| Bundle | Size |
| ------ | ---- |
| Shared by all routes | 103 KB |
| ├ framework chunk | 54.2 KB |
| └ application chunk | 46.4 KB |
| `/` route | +3.04 KB |
| `/products` route | +0.2 KB |
| `/parts/[category]/[vehicle]` route | +0.2 KB |
| `/vehicles` route | +2.47 KB |

Almost the entire storefront is server-rendered. Client components exist only
where interaction genuinely requires them — the vehicle selector, filters,
quantity stepper, cart lines, search box, garage manager and the admin import
panel — which is why route-level JavaScript is measured in hundreds of bytes.

No third-party script is loaded. There is no analytics tag, no tag manager, no
font CDN (Vazirmatn is bundled), and no chat widget.

## Database

The catalogue is read through indexed queries, not cached, which is the right
default for a store whose stock changes with every order.

**No N+1 on any listing.** The compatibility badge on a page of results is the
case that would most naturally become one: `evaluateManyForConfiguration` reads
every fitment row for the whole page in a single query and then evaluates each
product purely in memory, so a 24-card grid costs one round trip rather than 24.

**Index coverage on the fitment path.** The vehicle-filtered listing is the
hottest query in the application. At demo scale (119 fitment rows) Postgres
chooses a sequential scan, which is correct — the table fits in a handful of
pages. Forcing `enable_seqscan = off` confirms the index path exists and is
what the planner switches to as the table grows:

```
Index Scan using vehicle_models_slug_unique on vehicle_models
  Bitmap Index Scan on vehicle_configurations_tuple_unique  (vehicle_model_id = …)
    Index Scan using product_fitments_configuration_idx     (vehicle_configuration_id = …)
      Index Scan using products_pkey                        (id = pf.product_id)
```

Persian search is covered by a GIN index on the generated `search_doc` tsvector
plus a `gin_trgm_ops` index on `search_plain` for typo tolerance — see
docs/SEARCH.md.

## Not measured

- **Field / real-user metrics.** No RUM, no CrUX data, no measurement over a
  real mobile network. INP in particular is absent for that reason.
- **Load and concurrency.** Correctness under concurrency is tested (the
  overselling suite races 2 and 10 simultaneous buyers); *throughput* under load
  is not. No sustained-load or soak test has been run.
- **Cold start.** All figures are warm. The first request after a deploy pays
  route compilation and connection setup.
- **Large-catalogue behaviour.** The demo catalogue is 40 products and 119
  fitment rows. Query plans at 100,000 products have not been observed, only
  reasoned about from the index definitions.
- **Image optimisation.** Demo assets are hand-written SVGs, so there is no
  raster pipeline to measure. A real catalogue with photography would need
  `next/image`, responsive sources and a CDN before these numbers mean anything.

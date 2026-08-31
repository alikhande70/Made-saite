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

## Cold-cache CLS — a fixed regression

Measured separately because a warm cache hides it entirely, and a first-time
visitor is precisely who does not have one.

| Page | Viewport | CLS before | CLS after |
| ---- | -------- | ---------- | --------- |
| `/` | 1440×900 | **0.2152** | **0.0045** |
| `/products` | 1440×900 | 0.0257 | 0.0017 |
| `/parts/{category}/{vehicle}` | 1440×900 | 0.0100 | 0.0006 |
| `/` | 360×780 | 0.0488 | 0.0021 |

**Cause.** Fontsource ships Vazirmatn with `font-display: swap`. The fallback
paints first, and when the real font arrives the hero heading re-wraps and the
entire page below it moves. The largest text on the site was moving under the
reader on every cold load, at 0.2152 — inside the "needs improvement" band
(> 0.1) and two-thirds of the way to "poor".

**Fix.** The faces are declared locally with `font-display: optional` and served
from `public/fonts/`, with the Arabic-range face preloaded. `optional` decides
the layout once: the font is used when it arrives inside the block window
(normal when self-served, always on a warm cache), and otherwise the fallback is
kept for the whole page view rather than swapped mid-render. Guarded by
`tests/unit/motion-system.test.ts`, which fails if any face returns to `swap`.

## Field-relevant metrics (localhost, warm)

Re-measured after the motion and font work.

| Page | Viewport | LCP | CLS | TTFB | Requests | Transfer | DOM nodes |
| ---- | -------- | --- | --- | ---- | -------- | -------- | --------- |
| `/` | 1440×900 | 328 ms | 0.0000 | 41 ms | 52 | 59 KB | 840 |
| `/products` | 1440×900 | 280 ms | 0.0017 | 41 ms | 49 | 65 KB | 1002 |
| `/parts/brake-pads/peugeot-206` | 1440×900 | 220 ms | 0.0006 | 38 ms | 37 | 35 KB | 378 |
| `/` | 360×780 | 216 ms | 0.0000 | 39 ms | 29 | 51 KB | 839 |
| `/products` | 360×780 | 208 ms | 0.0000 | 40 ms | 30 | 57 KB | 1002 |
| `/parts/brake-pads/peugeot-206` | 360×780 | 204 ms | 0.0000 | 37 ms | 27 | 30 KB | 382 |

The motion system cost roughly 1 KB of CSS and no measurable LCP or CLS
movement: every animation runs on `transform`/`opacity` only, nothing animates
without a user action, and no animation library was added.

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

## LAB Core Web Vitals under throttling

**These are LAB metrics.** They are not field data, not RUM, and not CrUX. No
real user has loaded this site. See "Not measured" below for what that leaves
open.

Conditions: production build, `next start` on localhost, PostgreSQL on the same
host, headless Chromium, **cold cache** (`Network.setCacheDisabled`), **4× CPU
throttling**, and **150 ms of latency injected per request**.

The latency is injected through a Playwright route handler rather than through
`Network.emulateNetworkConditions`, because **Chrome ignores CDP network
emulation on loopback**. That was verified rather than assumed: raising the
emulated latency from 0 ms to 1000 ms moved the measured TTFB from 39 ms to
30 ms — i.e. not at all. Any measurement here that relies on CDP network
throttling against localhost is meaningless, and an earlier run of this same
harness produced a misleading CLS of exactly 0.0000 on every page for that
reason.

### Desktop, 1440×900

| Page | LCP | CLS | FCP | Transfer | Verdict |
| ---- | --- | --- | --- | -------- | ------- |
| `/` | 804 ms | 0.0045 | 804 ms | 310 KB | good |
| `/products` | 1032 ms | 0.0003 | 652 ms | 308 KB | good |
| `/search?q=فیلتر روغن` | 1068 ms | 0.0001 | 624 ms | 270 KB | good |
| `/parts/brake-pads/peugeot-206` | 676 ms | 0.0006 | 676 ms | 258 KB | good |
| `/cart` | 592 ms | 0.0003 | 592 ms | 245 KB | good |

### Mobile, 360×780

| Page | LCP | CLS | FCP | Transfer | Verdict |
| ---- | --- | --- | --- | -------- | ------- |
| `/` | 712 ms | 0.0021 | 712 ms | 300 KB | good |
| `/products` | 1040 ms | 0.0003 | 592 ms | 293 KB | good |
| `/search?q=فیلتر روغن` | 984 ms | 0.0001 | 600 ms | 264 KB | good |
| `/parts/brake-pads/peugeot-206` | 648 ms | 0.0011 | 648 ms | 253 KB | good |
| `/cart` | 556 ms | 0.0006 | 556 ms | 236 KB | good |

Against Google's thresholds — LCP ≤ 2500 ms, CLS ≤ 0.1 — every page is inside
"good" with substantial headroom: the worst LCP is 1068 ms against a 2500 ms
budget, and the worst CLS is 0.0045 against 0.1.

**How much of that headroom survives contact with reality is unknown.** The
document is still served from the same machine, so real server latency, TLS
handshake, DNS, and Iranian mobile network conditions are all absent. The
honest reading is: **the application-controlled portion of LCP and CLS is
small enough that the network will dominate**, which is the right place for
the budget to be spent — but the field number is not predicted here.

TTFB in this table is not meaningful. The injected delay lands before
`requestStart`, so `responseStart - requestStart` excludes it and reports
12–46 ms. LCP, FCP and CLS are measured from navigation start and do include
it.

**INP is not measured at all.** It requires real interactions from real users;
a synthetic harness cannot produce it.

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

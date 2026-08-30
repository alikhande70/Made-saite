# Testing

Four layers, each testing what it is actually good at.

| Layer | Tool | Location | What it covers |
| ----- | ---- | -------- | -------------- |
| Unit | Vitest | `tests/unit` | Pure domain rules and library helpers — no I/O |
| Integration | Vitest + PostgreSQL | `tests/integration` | Services against a real database, including concurrency |
| API | Vitest + PostgreSQL | `tests/api` | Real route handlers: validation, CSRF, authorization, rate limits |
| E2E | Playwright | `tests/e2e` | The five critical flows through a production build, desktop and mobile |

```bash
npm run test            # unit + integration + API
npm run test:unit
npm run test:integration
npm run test:e2e        # builds and serves; needs PostgreSQL
npm run test:all
```

## Databases

Tests never touch development data.

- Vitest creates and migrates **`madesaite_test`** once per run
  (`tests/global-setup.ts`) and truncates every table between test cases.
  `fileParallelism` is off because the files share that one database.
- Playwright creates, migrates and **seeds `madesaite_e2e`**
  (`tests/e2e/global-setup.ts`), then runs against a production build on port
  3100. Seeding with the real demo catalogue means E2E exercises genuine Persian
  data rather than synthetic stubs.

## Notable cases

**Overselling** — the tests that must never be allowed to regress:
- two transactions racing for one unit: exactly one succeeds;
- ten concurrent buyers, three units: exactly three succeed;
- two orders locking the same two products in opposite order: no deadlock;
- two customers checking out the last unit over HTTP: one order exists, and
  `reserved <= on_hand` still holds.

**Money is never taken from the client** — a checkout request carrying
`grandTotal: 1`, `subtotal: 1`, `shippingTotal: 0` is charged the correct amount.
A sale that starts between page render and submit is honoured at the new price;
a price change after placement does not alter the order.

**Payment** — forged (unsigned) callback, wrongly-signed callback, correctly
signed callback for the wrong amount, callback from the wrong provider,
callback for an unknown order, duplicate callback, two concurrent duplicates,
and retry-after-failure. In every rejection case the order stays
`PENDING_PAYMENT` and stock stays reserved.

**Authorization** — anonymous → 401, customer → 403 (not 404), admin → 200, on
every admin surface; a customer attempting a stock change leaves stock unchanged;
cross-site admin write rejected even with a valid admin session; one customer
cannot read or delete another's order or address.

**Persian and RTL** — normalisation across Arabic/Persian letter forms,
Persian/Arabic-Indic/Latin digits, ZWNJ and harakat; part numbers stay LTR;
prices and quantities render in Persian numerals; every listed page renders
`dir="rtl"` with no horizontal overflow at 360/390 px; the mobile drawer opens
from the reading-start edge; directional chevrons are mirrored.

**SEO** — `Product` structured data matches the database row (SKU, price in Rial,
availability); no `aggregateRating` or `review` is ever emitted, because the store
has no review data; sitemap contains active products and excludes `/admin`,
`/account`, `/checkout` and `/api`; robots disallows the same; security headers
are present on a real response.

## Test-environment notes

- **Client IP per spec file.** The app rate-limits checkout and login per client
  IP, and every Playwright request comes from the same host, so each spec presents
  its own `X-Forwarded-For` (`clientIpHeaders()`). The limits stay active and are
  covered directly in `tests/api/routes.test.ts`; this only stops the suite from
  throttling itself.
- **Route handlers are called directly** in `tests/api`, with `next/headers`
  mocked to a per-request context. The handler code that runs is the real one —
  validation, CSRF, authorization and error mapping all execute.
- **Callback signing is reimplemented** in `tests/e2e/helpers.ts` rather than
  imported from the app, so an E2E test signs the way an external gateway would.
  A change to the app's signing scheme fails the test instead of silently
  agreeing with itself.

## What is not covered

- Load and performance testing.
- Visual regression testing.
- Browsers other than Chromium.
- Any real payment gateway (see docs/PAYMENTS.md).
- Accessibility beyond structural checks (one `h1`, labelled fields, image alt
  text, skip link) — no screen-reader or full WCAG audit.

# مِیدساخت — Persian RTL auto-parts e-commerce

A working Persian-first (fa-IR, RTL) online store for automotive spare parts:
storefront, vehicle-based part finder, cart, checkout, payment abstraction,
shipping, order lifecycle, order tracking, customer accounts and an admin panel.

> **This repository ships with clearly-marked synthetic demo data.** Products,
> prices, stock levels, accounts and the store's contact details are fabricated.
> The only payment provider that is switched on is a **sandbox gateway that moves
> no money**. See [Known limitations](#known-limitations).

---

## Quick start

### Requirements

- Node.js 20+ (developed on 22)
- PostgreSQL 14+ — **created with a UTF-8 locale**

> **The database locale matters.** `pg_trgm` extracts no trigrams from Persian
> text under `LC_CTYPE=C`, which silently disables fuzzy/partial search. Create
> the cluster with `--locale=C.UTF-8` (or any UTF-8 locale):
>
> ```bash
> initdb -D /var/lib/pgdata --encoding=UTF8 --locale=C.UTF-8
> ```
>
> Verify with `SELECT show_trgm('فیلتر روغن');` — it must return a non-empty array.

### Set up

```bash
npm install
cp .env.example .env.local        # then edit AUTH_SECRET and MOCK_GATEWAY_SECRET
createdb madesaite
psql madesaite -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'

npm run db:migrate                # apply schema migrations
npm run db:seed                   # load the demo catalogue (idempotent)
npm run dev                       # http://localhost:3000
```

### Demo accounts (seed data only)

| Role     | Phone         | Password        |
| -------- | ------------- | --------------- |
| Admin    | `09120000000` | `Admin@12345`   |
| Customer | `09121111111` | `Customer@12345`|

### Scripts

| Command                    | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `npm run dev`              | Development server                                         |
| `npm run build` / `start`  | Production build / serve                                   |
| `npm run db:migrate`       | Apply pending migrations                                   |
| `npm run db:seed`          | Load demo data (safe to re-run)                            |
| `npm run db:reset`         | Drop and recreate the schema, then migrate                 |
| `npm run db:sweep`         | Release expired reservations, prune sessions/rate limits   |
| `npm run assets:generate`  | Regenerate the demo SVG illustrations                      |
| `npm run test`             | Unit + integration + API tests (Vitest)                    |
| `npm run test:e2e`         | End-to-end tests (Playwright, production build)            |
| `npm run typecheck`        | `tsc --noEmit`                                             |
| `npm run lint`             | ESLint                                                     |

Run `npm run db:sweep` on a schedule in production (every few minutes) so unpaid
orders release their stock on time:

```cron
*/5 * * * * cd /srv/madesaite && npm run db:sweep >> /var/log/madesaite-sweep.log 2>&1
```

---

## What is implemented

**Storefront** — home with a vehicle part-finder, category tree, product listing
with faceted filters, Persian search, product detail (gallery, specs,
compatibility table, shipping estimate), cart, checkout, order confirmation,
public order tracking, customer account (orders, addresses, profile, reorder).

**Vehicle compatibility** — a real relational model
(`brand → model → engine → Jalali year window`), not text in the page. Filtering
by model, engine and year narrows the catalogue in SQL.

**Search** — Persian-aware: Arabic vs Persian letter forms, Persian vs Latin
digits, ZWNJ and harakat are normalised; SKU/OEM lookup, partial part numbers and
small typos all resolve. See [docs/SEARCH.md](docs/SEARCH.md).

**Orders** — explicit state machine with server-validated transitions, immutable
line snapshots, an append-only audit log, and a reservation model that prevents
overselling under concurrency.

**Payments** — a provider interface with a signed sandbox gateway and cash on
delivery. Real Iranian gateways are stubbed and fail loudly rather than pretending
to work. See [docs/PAYMENTS.md](docs/PAYMENTS.md).

**Admin** — dashboard, order workflow with tracking codes, product CRUD with
images/specs/fitments, inventory adjustments with mandatory reasons and full
audit history, categories, brands, shipping rules, customers, store settings.

**SEO** — per-page metadata, canonical URLs, Open Graph, `Product` and
`BreadcrumbList` structured data generated from real database state, sitemap and
robots. No fabricated ratings, reviews, availability or prices.

---

## Documentation

| Document | Contents |
| -------- | -------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack choice, layering, money handling, concurrency model |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md)     | Schema, relationships, indexes, constraints |
| [docs/SEARCH.md](docs/SEARCH.md)             | Persian search design and the migration path to a search engine |
| [docs/PAYMENTS.md](docs/PAYMENTS.md)         | Provider interface and what a real gateway needs |
| [docs/SECURITY.md](docs/SECURITY.md)         | Controls, threat notes, deployment requirements |
| [docs/TESTING.md](docs/TESTING.md)           | Test layers and how to run them |

---

## Known limitations

These are deliberate boundaries of this build, not oversights:

- **No live payment.** Only the sandbox and cash-on-delivery providers are
  active. Zarinpal/IDPay adapters exist as typed stubs that throw unless
  configured; they have never been exercised against a real gateway.
- **Demo data.** Everything the seed loads is synthetic. Turn off "حالت نمایشی"
  in Admin → Store settings and load real data before any real use.
- **No image upload.** Product images are chosen from static assets in
  `public/demo/`. An upload pipeline (validation, storage, virus scanning) is out
  of scope here.
- **No email or SMS.** Order confirmations are shown on-screen and via the
  tracking link; no messages are sent.
- **No tax/VAT engine.** Totals are subtotal + shipping. Iranian VAT rules would
  need a dedicated tax module.
- **Single-currency.** Amounts are integer **Toman**; there is no multi-currency
  support.
- **Not deployed, not load-tested.** It runs locally against PostgreSQL and
  passes its test suite; it has never served production traffic.

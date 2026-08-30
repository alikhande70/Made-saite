# Architecture

## Stack decision

**Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL 16 · Drizzle ORM**

The brief allowed either a compact Next-based backend or a separate service. This
build uses a single Next application, for these reasons:

- **SSR is a requirement, not a preference.** Product and category pages must be
  server-rendered for SEO and for first paint on mobile connections. A separate
  API service would still need an SSR frontend in front of it, so it adds a
  network hop and a second deployment without removing any work.
- **One type system end to end.** Domain types, validation schemas and API
  contracts are shared by import rather than by code generation, so a schema
  change is a compile error rather than a runtime surprise.
- **The layering, not the process boundary, is what keeps this maintainable.**
  Business logic lives in `domain/` and `application/`; HTTP handlers are thin.
  Extracting those layers into a standalone service later is a mechanical move —
  they have no dependency on Next.

**Drizzle over Prisma:** the inventory reservation path needs explicit
`SELECT … FOR UPDATE` row locking inside a transaction. Drizzle expresses that
directly and typed; Prisma would push it into raw SQL, losing the type safety
that motivated the ORM. Drizzle also has no query-engine binary to ship.

---

## Layers

```
src/
  domain/          pure business rules — no I/O, no framework, fully unit-testable
    money.ts           integer Toman arithmetic and guards
    order-status.ts    the order state machine (single source of truth)
    pricing.ts         effective price, line totals, order totals
    shipping.ts        shipping cost calculation
    inventory.ts       availability and stock-status rules
    errors.ts          typed domain errors carrying Persian, user-safe messages

  application/     use cases — orchestrate the domain and the database
    catalog-service      listing, faceting, Persian search, product detail
    cart-service         cart identity, re-pricing, stock validation
    checkout-service     order placement (the transactional core)
    order-service        lifecycle transitions, payment settlement, tracking
    inventory-service    the ONLY writer of the inventory table
    shipping-service     admin-configured methods and per-province rates
    auth-service         registration, sessions, lockout, cart merging
    admin-service        catalogue and customer administration
    settings-service     store profile
    payment/             provider interface + adapters

  infrastructure/
    db/schema.ts         Drizzle schema (the schema of record)
    db/migrations/       generated + hand-written SQL migrations
    db/client.ts         pool, transaction helper

  lib/             cross-cutting utilities (Persian formatting, validation,
                   crypto, sessions, rate limiting, HTTP envelopes)

  app/             Next routes: UI + thin route handlers
  components/      presentational components
```

**Dependency direction is strictly inward.** `app/` may import from
`application/`, `domain/` and `lib/`. `application/` may import `domain/`,
`infrastructure/` and `lib/`. `domain/` imports nothing but `lib/fa` (a
dependency-free formatter used to build Persian error messages).

### Why business logic is not in route handlers

Every route handler follows the same four lines: check origin → authorise →
validate → call a service. That keeps three properties:

1. The same rule is enforced no matter which entry point calls it — HTTP handler,
   Server Component, seed script or scheduled sweeper.
2. Business rules are testable without HTTP. Most of the 193 Node-level tests call
   services directly.
3. The state machine and the inventory rules each have exactly one implementation,
   so they cannot drift.

---

## Money

**All monetary values are integers in Toman (IRT).**

Iranian retail quotes prices in whole Toman with no circulating sub-unit, so
integers eliminate floating-point error without a minor-unit scaling factor.
`domain/money.ts` guards every amount (`assertMoney`) against `NaN`, `Infinity`,
fractions and negatives before it can reach the database.

The Rial conversion (×10) exists in exactly two places, both boundaries:
- payment adapters, where a gateway settles in Rial (`toRial`);
- `Product` structured data, where schema.org expects the national currency.

The domain never sees Rial.

---

## Concurrency and inventory

The reservation model:

```
available = quantity_on_hand − quantity_reserved
```

| Event                      | Effect |
| -------------------------- | ------ |
| Order placed               | `reserved += qty` — stock is held, `on_hand` untouched |
| Payment confirmed          | `on_hand −= qty`, `reserved −= qty` — the hold becomes a real deduction |
| Cancelled before payment   | `reserved −= qty` — the hold is returned |
| Cancelled/refunded after payment | `on_hand += qty` — units go back on the shelf |
| Payment window elapses     | Sweeper cancels the order, releasing the hold |

Three independent layers enforce this:

1. **Row locks.** Every mutation takes `SELECT … FOR UPDATE` on the affected
   inventory rows, **always ordered by `product_id`**. A consistent lock order
   makes deadlocks between two concurrent checkouts impossible — verified by a
   test that runs two orders locking the same pair in opposite order.
2. **Transactions.** Order creation, item snapshot and reservation are one
   transaction. Any failure rolls back the entire order — placement is
   all-or-nothing.
3. **Database CHECK constraints.** `inventory_no_oversell` asserts
   `quantity_reserved <= quantity_on_hand`, and both columns are constrained
   non-negative. Even a bug in the service layer cannot produce oversold stock.

The gateway call happens **after** the transaction commits. Holding database
locks across a network round-trip would serialise the whole shop behind one slow
gateway; if the gateway call then fails, the order simply stays
`PENDING_PAYMENT` and its reservation expires on schedule.

---

## Trust boundary

The browser is trusted to say **what** to buy and **where** to send it. It is
never trusted about money.

At checkout the client sends product ids, quantities, an address and a shipping
method **code**. The server re-reads every product row, recomputes unit prices
(applying any sale price active at that instant), re-quotes shipping from the
admin-configured rules, and computes the total. A `grandTotal` in the request
body is silently discarded by the validation schema — covered by a test that
posts hostile totals and asserts the charge is unaffected.

---

## Order lifecycle

```
PENDING_PAYMENT ──► PAID ──► PROCESSING ──► PACKED ──► SHIPPED ──► DELIVERED
       │              │           │            │                        │
       └──► CANCELLED ┴───────────┴────────────┘                        │
                      └──────► REFUNDED ◄───────────────────────────────┘
```

`domain/order-status.ts` owns the transition table. `applyTransition` in
`order-service` is the only writer of `orders.status`; it locks the order row,
validates the move, performs the matching inventory effect exactly once, and
appends to `order_events`. Inventory side effects are keyed off the transition
itself, so they cannot drift from the state machine.

Payment callbacks are idempotent: the order's current status is re-checked under
the lock, so a retried webhook or a refreshed return URL converges instead of
fulfilling stock twice. Two concurrent duplicate callbacks are covered by a test.

---

## Rendering

Pages are `force-dynamic`: prices and stock must never be served stale from a
cache. The catalogue is read through indexed queries rather than cached, which is
the right default for a store whose stock changes with every order. Adding
`revalidateTag` caching for category and brand pages is a straightforward later
optimisation — the data access is already centralised in `catalog-service`.

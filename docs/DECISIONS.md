# Architecture decision record

Each entry states the decision, the evidence behind it, and what would make us
revisit it. Superseded decisions stay in place, marked.

---

## ADR-001 — Own the commerce domain rather than adopt a commerce engine

**Status:** accepted

**Question.** Should generic commerce (cart, checkout, inventory, orders) be
delegated to Medusa/Vendure/Saleor, or owned here?

**Evidence.**
- **Vendure is GPL-3.0.** Embedding it constrains the licensing of a commercial
  store. Disqualifying on its own.
- **Saleor** is BSD-3 and excellent, but is a Python/GraphQL service. Adopting it
  means running and operating a second stack, and the automotive fitment domain
  — the actual differentiator — would still have to be built on top as custom
  attributes.
- **Medusa** is MIT (with EE carve-outs) and Node-native, so it is the credible
  candidate. Its commerce primitives are more capable than ours. But its product
  model is variant-centric (size/colour), and auto parts are **fitment-centric**:
  one SKU fitting hundreds of vehicle configurations is not a variant axis. That
  relationship would live in custom modules regardless.
- Our commerce surface is deliberately narrow: one currency, one warehouse, no
  promotions engine, no multi-channel. The primitives an engine provides that we
  actually need amount to a few thousand lines, which exist and are tested.

**Decision.** Own the domain. Take the *patterns* from these systems (they were
studied and are cited in docs/RESEARCH.md); take none of the operational weight.

**Revisit if:** multi-warehouse, multi-currency, marketplace sellers, a real
promotions engine, or B2B pricing tiers become requirements. At that point
Medusa becomes the stronger base and this decision should be re-argued.

---

## ADR-002 — Fitment modelled as an explicit vehicle configuration

**Status:** accepted (supersedes the initial brand → model → engine schema)

**Question.** How should "this part fits this car" be represented?

**Evidence.** The ACES aftermarket standard resolves fitment against a
*BaseVehicle* (make + model + year) narrowed by sub-model/trim and engine. The
initial schema had `product_vehicle_compat(product, model, engine?, year_from,
year_to)`, which could not express a trim ("پژو ۲۰۶ **تیپ ۵**") and could not
distinguish "fits, engine not recorded" from "fits every engine" — an ambiguity
that turns into a wrong answer on a compatibility badge.

**Decision.** Model the vehicle taxonomy as
`make → model → generation → trim` and `model → engine`, then materialise a
**`vehicle_configurations`** row (model + generation? + trim? + engine? + year)
that a customer's garage entry and a product fitment both reference.

Fitment carries an explicit `fitment_type`:

| Value | Meaning |
| ----- | ------- |
| `DIRECT` | Confirmed fit for this configuration |
| `WITH_MODIFICATION` | Fits, but requires modification — surfaced to the customer |
| `NOT_COMPATIBLE` | Explicitly known **not** to fit — a negative assertion, not silence |

`NOT_COMPATIBLE` matters: absence of data must read as "unknown", never as "no".
Encoding known-negatives separately is what lets the UI distinguish the two.

**Revisit if:** a licensed catalogue (TecDoc/ACES data) is acquired, at which
point the import must map onto these tables rather than replace them.

---

## ADR-003 — Part number relationships as typed relations

**Status:** accepted

**Question.** Where do supersessions, alternates and cross-references live?

**Evidence.** PIES treats these as distinct relationship types. Customers search
by the number printed on the old part, which is frequently a superseded one.
Storing them in a text field makes them unsearchable and unfollowable.

**Decision.** One `product_references` table with a typed relation:
`SUPERSEDES` (this part replaces that number), `SUPERSEDED_BY`, `ALTERNATE`
(equivalent part), `CROSS_REFERENCE` (another manufacturer's number). The target
may be another product row **or** a bare number string, because most
cross-references point at parts we do not stock — and those still need to be
searchable so the customer lands on the part we do stock.

---

## ADR-004 — Curated indexable pages, query-string facets are `noindex`

**Status:** accepted

**Question.** Which filter combinations become crawlable URLs?

**Evidence.** A parts catalogue has combinatorially many filter states. Indexing
them produces thin, duplicative pages and dilutes crawl budget — the standard
faceted-navigation failure. Vendure's `isPrivate` facet flag is the same idea
applied at the data layer.

**Decision.** Exactly two families of catalogue URL are indexable:

| Pattern | Indexable |
| ------- | --------- |
| `/categories/{category}`, `/brands/{brand}` | yes |
| `/parts/{category}/{vehicle}` (curated landing pages) | yes, **only when the pairing has at least a configured minimum of live products** |
| `/products?brand=…&minPrice=…&sort=…` | no — `noindex, follow` |
| `/search?q=…` | no |

A landing page that falls below the product threshold is served (it still works
for a customer who follows a link) but is marked `noindex` and dropped from the
sitemap, so a catalogue gap never becomes a thin page.

---

## ADR-005 — Integer Toman as the money unit

**Status:** accepted (unchanged)

Iranian retail quotes whole Toman with no circulating sub-unit. Integers remove
float error without a minor-unit factor. Rial conversion (×10) exists only at the
payment-gateway adapter and in schema.org output.

---

## ADR-006 — Reservation counter, not reservation rows

**Status:** accepted

**Evidence.** Medusa models reservations as rows keyed to a line item. That buys
partial fulfilment, multi-location allocation and per-reservation expiry. This
project has one warehouse, no partial fulfilment, and a single expiry per order.
The counter model plus the append-only `inventory_events` log already provides
attribution, and it is verified by concurrency tests (2 buyers / 1 unit,
10 buyers / 3 units, reverse-order lock acquisition).

**Decision.** Keep `quantity_on_hand` / `quantity_reserved` with `FOR UPDATE`
locking in a consistent `product_id` order, plus the database CHECK constraint
that makes oversold stock unrepresentable.

**Revisit if:** multi-warehouse or partial fulfilment is introduced. Migration
path: add a `stock_reservations` table, backfill from open orders, and switch
`reserveStock`/`releaseReservation` to write rows — the service boundary already
isolates every caller from the representation.

---

## ADR-007 — Audit log before granular RBAC

**Status:** accepted

**Evidence.** Saleor exposes ~30 granular permissions. This project has a binary
admin role, so any admin can do anything. Two candidate controls: split
permissions, or record actions.

**Decision.** Implement the append-only **admin audit log** first. Reasoning: with
one shop operator (the realistic starting point) granular permissions protect
against nothing, while an audit trail is what makes any privileged action
attributable and reversible — and it is the prerequisite for RBAC being
meaningful later. Granular RBAC is the next step and is recorded as a known gap
in docs/SECURITY.md.

---

## ADR-008 — Compatibility answers are three-valued

**Status:** accepted

**Question.** What does the product page tell a customer about their car?

**Evidence.** A two-valued answer forces missing data to be rendered as either a
false "fits" or a false "does not fit". Both cause returns; the first causes
wrong-part installations.

**Decision.** `COMPATIBLE` / `UNKNOWN` / `INCOMPATIBLE`, where `UNKNOWN` is the
default whenever no fitment record covers the configuration, and `INCOMPATIBLE`
is asserted **only** from an explicit `NOT_COMPATIBLE` fitment row. The UI states
which vehicle the answer is about and never implies certainty the data does not
support.

---

## ADR-009 — Bulk import is two-phase with an all-or-nothing commit

**Status:** accepted

**Question.** How does a supplier price list get into the catalogue?

**Evidence.** Automotive supplier files are large and reliably messy: Persian
digits in price columns, `٬` thousands separators, `تماس بگیرید` where a number
belongs, brand names that do not match the store's spelling, and vehicle codes
for models the store does not carry. Two failure modes matter more than
throughput:

1. **Silent coercion.** `parseInt('12abc')` returns `12`. An importer that
   salvages values imports wrong prices with no error at all.
2. **Partial application.** A file that fails halfway leaves the catalogue in a
   state no one intended and no one can describe — half at new prices, half at
   old.

**Decision.**
- **Validate** parses and checks the whole file and stores the accepted rows and
  every error as an `import_jobs` row. It writes nothing else. A value that
  cannot be read confidently becomes a reported error, never a coerced number.
- **Commit** applies that stored payload inside one transaction and flips the
  job status. A failure at row 1,900 rolls back rows 1–1,899; a re-submitted job
  is a `409`, not a second import.
- References are **re-resolved at commit time**. The catalogue can change between
  preview and apply, and a preview must not become a licence to write stale
  foreign keys.
- **Nothing is auto-created.** An unknown brand, category, model, engine or trim
  fails the row by name. A typo must not mint taxonomy, and a silently dropped
  fitment produces a part that appears to fit nothing — indistinguishable from a
  part nobody has mapped.

**Consequences.** Two round trips instead of one, and the whole file is held in
memory (capped at 4 MB of UTF-8 bytes and 5,000 rows). Both are worth it. A
four-eyes approval step is the natural follow-up for a store with more than one
administrator: today one valid file can reprice the entire catalogue, and the
only controls are the mandatory preview, the transaction, and the audit entry.

---

## ADR-010 — Loading boundaries may not sit above routes that can 404

**Status:** accepted

**Question.** Why does `notFound()` return HTTP 200?

**Evidence.** Observed, then bisected: every one of the ten `notFound()` routes
answered 200 with a 404 body. A minimal reproduction narrowed it to a root
`src/app/loading.tsx`. A `loading.tsx` creates a Suspense boundary above its
whole segment, so Next flushes the HTTP response before the page component runs;
`notFound()` can then only swap the rendered body, not the status that has
already been sent.

The result is a soft 404 — indexed by search engines, reported healthy by
monitoring, invisible to link checkers. Next mitigates the SEO half by injecting
`<meta name="robots" content="noindex">`, but the status stays wrong.

**Decision.** A loading boundary may only sit above routes that never call
`notFound()`. `/search` keeps its `loading.tsx` because it has no children that
can 404; `/products` uses an explicit `<Suspense>` *inside* the page instead,
because a file in that segment would also wrap `/products/[slug]`, which does.

**Alternatives rejected.** Throwing from `generateMetadata` (reproduced the same
200); removing `force-dynamic` (unrelated — the boundary, not the render mode,
causes the flush); accepting the soft 404 because the `noindex` meta covers SEO
(it does not cover monitoring, and a 200 for a missing resource is simply wrong).

**Consequences.** The rule is a convention the framework does not enforce, so
`tests/e2e/seo.spec.ts` asserts real 404 statuses on five missing-resource routes.
Re-introducing a root `loading.tsx` fails CI rather than silently regressing.

---

## ADR-011 — Vehicle coherence is checked in the service, not the schema

**Status:** accepted

**Question.** What stops a configuration pairing a پژو ۲۰۶ with a پراید engine?

**Evidence.** `vehicle_configurations` references model, generation, trim and
engine as four independent foreign keys. Each one is individually valid, so the
database happily accepts a combination describing a car that has never existed —
and the fitment rows hanging off it would then make claims about that car.
Discovered by attack testing: posting a foreign engine id succeeded, and posting
an unknown model id surfaced a raw constraint violation as a 500.

**Decision.** `getOrCreateConfiguration` verifies the model exists and is active,
and that every supplied generation, trim and engine belongs to *that* model,
before inserting. An unknown model is a `404`; a mismatched narrowing is a `422`
naming which dimension is wrong.

**Alternatives rejected.** A composite foreign key `(model_id, engine_id)`
referencing `vehicle_engines (vehicle_model_id, id)` would push the check into
the schema, which is stronger. It needs a redundant unique index on each child
table and a redundant `vehicle_model_id` column on `vehicle_configurations` per
dimension. Worth doing if this table ever accepts writes from outside the
service; today the service is the only writer, and the check is covered by tests
at both the service and HTTP boundaries.

---

## ADR-012 — The E2E database is prepared by the web server's own command

**Status:** accepted

**Question.** Where does the end-to-end database get created?

**Evidence.** It was created in Playwright's `globalSetup`, and the suite passed
on every developer machine and failed on CI with
`Timed out waiting 120000ms from config.webServer`.

Reproduced by dropping `madesaite_e2e` locally, which is the state of a fresh CI
Postgres service container:

1. Playwright starts `webServer` and polls its `url` for readiness.
2. `url` is the home page, which is `force-dynamic` and queries the database.
3. The database does not exist, so the page throws and Next answers **HTTP 500**.
4. The readiness probe does not accept 500. It polls until `webServer.timeout`
   and aborts the run.
5. `globalSetup` — which creates the database — is downstream of that gate, so
   it never runs. Verified: the database still did not exist after the run.

A deadlock, not a flake. It could only ever manifest where the database had
never existed, which is why local runs, with a database left over from the
previous run, passed indefinitely.

**Decision.** Move create + migrate + seed into `scripts/e2e-db.ts` and invoke
it from `webServer.command` as `npm run test:e2e:db && npm run start`. Shell
`&&` is the ordering guarantee: the server cannot start unless the database is
ready. `globalSetup` becomes a verifier that fails with one explanatory line.
`webServer.timeout` rises to 240 s to cover the preparation as well as the boot.

**Alternatives rejected.**
- *A database-independent `/api/health` endpoint as the readiness probe.* It
  would let the server come up before the database exists, which relies on the
  app tolerating a missing database at boot and on connection pools recovering
  afterwards. It also weakens the probe: readiness would mean "the process is
  listening" rather than "the app can render a page".
- *A separate CI step before `npm run test:e2e`.* Fixes CI and leaves a local
  clean checkout broken in exactly the same way.

**Consequences.** The database is rebuilt on every run rather than reused, which
is slower by a few seconds and correct — each run starts from a known state. The
ordering is asserted statically in `tests/unit/e2e-harness.test.ts`, which fails
if the bootstrap moves back into `globalSetup`.

---

## ADR-013 — Checkout idempotency: cart lock now, an idempotency key later (P2)

**Status:** accepted for the current scope; the idempotency key is a recorded
recommendation, not implemented

**Question.** Is the cart lock enough to make `POST /api/checkout` idempotent?

**Evidence.** Measured, not assumed. With the cart lock in place a retried
submit of an already-placed cart produces:

```
FIRST  -> {"orderNumber":"MS-2608-YXBEMJMF","hasToken":true}
RETRY  -> {"code":"CART_EMPTY","status":409,"message":"سبد خرید شما خالی است."}
ORDERS -> 1
```

Exactly one order exists in every case tested — two concurrent submits, eight
concurrent submits, and a sequential resubmit. **No duplicate-order defect
remains**, so this is not a correctness gap.

What remains is a *response-loss* gap. If the order commits and the response is
lost in flight — a dropped connection, a client-side retry wrapper, a closed
laptop — the retry receives `409 CART_EMPTY`. The order exists and stock is
correctly reserved once, but the caller is told something that reads like a
failure and does not receive `orderId`, `trackingToken` or `redirectUrl`. For a
**guest** that matters more than it first appears: the tracking token is the
only handle on that order, and this build sends no email, so a lost response
means a lost order from the customer's point of view even though the shop has
it.

**Decision.** Ship the cart lock. Record the idempotency key as **P2**.

**Recommended design, when it is taken up.**
- The client generates a UUID per checkout *attempt* (not per retry) and sends
  it as `Idempotency-Key`.
- A `checkout_attempts` row stores `(key, cart_identity_hash, order_id,
  response_json, created_at)` with a unique index on the key, written inside the
  same transaction that creates the order.
- A replay with a known key returns the stored response verbatim — the original
  `orderId`, `trackingToken` and `redirectUrl` — instead of `CART_EMPTY`.
- A key seen with a *different* cart identity is a conflict, not a replay, and
  must be rejected: otherwise the key becomes a way to read another customer's
  order result.
- Rows expire on the same clock as the payment reservation TTL.

**Why P2 and not P1.** It converts an already-safe failure into a good user
experience; it does not prevent a defect. The money-and-stock invariants are
held by the cart lock and by the inventory reservation, both of which are
directly tested. Doing it properly touches the checkout transaction, so it wants
its own change rather than being bolted onto a CI fix.

---

## ADR-014 — Deploy as Docker Compose on a single VPS

**Status:** accepted

**Question.** What should the production topology be, given an owner who is not
an engineer and a shop that must stay reachable from inside Iran?

**Options considered.**

**Option A — one VPS, Docker Compose (app + PostgreSQL + reverse proxy).**
Two long-lived containers and a one-shot migration container. The database is
published on no port and reachable only over the compose network. One command
deploys, one command rolls back.
- Everything the deployment needs is committed: `Dockerfile`,
  `docker-compose.production.yml`, `scripts/deploy.sh`. The state that is *not*
  in git is one `.env.production` file and one volume.
- The image is byte-identical between staging and production, so a staging
  rehearsal tests the artefact that ships, not an approximation of it.
- Rollback is a re-tag of the previous image: the pre-deploy dump exists, the
  previous image id is recorded, and `deploy.sh --rollback` uses both.
- Cost: one VPS. Operationally, the owner learns two commands.

**Option B — one VPS, systemd units, Node and PostgreSQL installed natively.**
Fewer moving parts at runtime, and no container layer to reason about.
- But the deployment surface grows rather than shrinks: a Node version to pin
  and upgrade, a `postgresql.conf` to tune, unit files, a user to create, and a
  build that now happens *on* the production host — which means a failed build
  can take the site down, and the running code is whatever the last `git pull`
  produced rather than a named artefact.
- Rollback becomes "check out the old SHA and rebuild", which is slow and can
  itself fail. That is the property that decided it: rollback must be fast and
  must not depend on a build succeeding.

**Option C — a managed platform.**
- **Vercel, Netlify, Fly, Railway.** Disqualified for this market, not on
  merit. They restrict access from Iran, and the shop's customers, its owner
  and its payment gateways are all inside Iran. A platform the owner cannot
  reliably reach to operate the site is not a candidate.
- **An Iranian managed platform (Liara, ArvanCloud, Parspack).** Genuinely
  viable, and the easiest path for a non-technical owner: managed PostgreSQL,
  managed TLS, managed backups. The cost is a provider-shaped deployment —
  their CLI, their build pipeline, their database — which is hard to rehearse
  locally and hard to leave.

**Decision.** Option A. It is the only option where the thing tested, the thing
rehearsed and the thing deployed are the same artefact, and where rollback does
not depend on a build. `output: 'standalone'` keeps the image small enough that
this costs little.

Deliberately **not** in the compose file: TLS termination. A reverse proxy
(Caddy is the fewest moving parts, nginx if one already exists) sits in front,
terminates HTTPS, and forwards to `127.0.0.1:3000`. Putting certificate renewal
inside the application's compose project couples two things with very different
change rates, and TLS must keep working across an application rollback.

**What this decision assumes.** A single application instance. Every invariant
that matters — stock reservation, checkout serialization, order state — is held
in PostgreSQL with row locks, not in process memory, so horizontal scaling is
*possible*; it is simply not needed and not rehearsed.

**Revisit if:** one host stops being enough (then the app scales out first, and
PostgreSQL moves to a managed service before it is replicated by hand); or the
owner's operational appetite turns out to be lower than assumed, in which case
Option C on an Iranian provider is the fallback and the container image ports
to it directly.

---

## ADR-013 addendum — the idempotency key re-evaluated for production

**Status:** re-evaluated in the production context; still P2

The original evaluation was made against a local deployment. Production adds
three conditions that argue *for* the key, and one that argues against changing
the verdict now.

**What production makes worse.**
- A reverse proxy adds a second place a response can be lost, and its own
  timeout. A gateway timeout after the order has committed produces exactly the
  response-loss case, and the customer sees an error page for an order that
  exists.
- Real gateways redirect the browser away and back. A customer who uses the
  back button, or whose mobile network drops during the redirect, can resubmit.
  The cart lock still prevents the duplicate order — that is proven — but the
  resubmit is now a realistic event rather than a synthetic one.
- Mobile networks make retries common in a way localhost never showed.

**What has not changed.** None of this is a correctness gap. The cart lock
still yields exactly one order under every concurrency pattern tested, stock is
still reserved once, and no money can be taken twice. What the customer loses
is the tracking token, and it is worth being exact about how bad that is: the
customer-facing tracking page resolves a **token only**. There is no self-serve
lookup by phone number. So a guest whose response is lost has no way back to
their own order. The order is recoverable — but only by the owner, who can find
it in the admin order list by phone number — which means recovery depends on
the customer contacting support and the owner knowing to look.

**Decision.** Unchanged: P2, with the design in ADR-013 standing. It should be
taken up before the first marketing campaign, because the failure mode scales
with traffic on unreliable networks, and it should not be taken up in the same
change as a deployment or a payment-gateway switch — it touches the checkout
transaction, and that transaction should change for one reason at a time.

**Escalate to P1 if:** the production logs show `CART_EMPTY` responses arriving
for carts that have just produced an order. That is the signature of this exact
failure. It is not currently reported as a named invariant — `CART_EMPTY` is an
ordinary domain error — so detecting it means either watching for that response
code on the checkout route or adding the invariant. Adding it is cheap and is
the right first step, because it converts this from a predicted problem into a
measured one before any of the design work is committed to.

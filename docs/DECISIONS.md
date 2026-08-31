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

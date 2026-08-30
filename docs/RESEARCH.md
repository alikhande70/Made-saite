# Research record

Reference systems studied before extending the commerce and automotive domains.
Licenses were read from the projects themselves (not from memory) on
2026-08-30; the findings below constrain what may be reused.

## License review — what may and may not be copied

| Project | License (verified) | Verdict |
| ------- | ------------------ | ------- |
| `vercel/commerce` | **MIT** (`license.md`, © 2025 Vercel) | Source reuse permitted with attribution. |
| `medusajs/medusa` | **MIT, *except* Enterprise Edition materials** listed in `ENTERPRISE-LICENSE.md` | Patterns safe. Any file reuse would require checking it is not EE material — a per-file check we chose not to depend on. |
| `vendure-ecommerce/vendure` | **GPL-3.0** (Community Edition) or a commercial licence | ⚠ **Conceptual research only.** Copying GPL source into this project would place the whole work under GPL-3.0, which is incompatible with a commercial store. |
| `saleor/saleor`, `saleor/storefront`, `saleor/saleor-dashboard` | **BSD-3-Clause** | Source reuse permitted with attribution and the licence notice. |
| `@saleor/macaw-ui` | **CC-BY-4.0** | Attribution licence, unusual for code; avoided. |
| `@storefront-ui/vue` | **MIT** | Permitted; Vue-based, so not directly applicable to this React codebase. |

**Decision: no source code was copied from any reference project.** Every
pattern below was reimplemented from the described architecture. That keeps this
repository's licensing unambiguous and removes the GPL and Medusa-EE hazards
entirely. Attribution is unnecessary because nothing was copied, but the research
provenance is recorded here regardless.

**Not used at all:** proprietary automotive catalogues (TecDoc and equivalents),
vehicle-fitment databases, product photography, brand assets. The demo catalogue
is synthetic and marked as such.

---

## Findings that changed the design

### 1. Inventory — Medusa (`packages/modules/inventory`)

`InventoryLevel` carries `stocked_quantity`, `reserved_quantity`,
`incoming_quantity` and a computed `available_quantity`; reservations are
**first-class rows** (`ReservationItem`) keyed to a `line_item_id`, not merely a
counter.

- **Confirms** our `quantity_on_hand` / `quantity_reserved` / computed-available
  model. Arriving at the same shape independently is good evidence it is right.
- **Differs**: we track reservations as a counter plus an append-only
  `inventory_events` log, and derive a release from the order's line items.
- **Decision (ADR-006):** keep the counter model. It is proven by concurrency
  tests, and reservation rows mainly buy partial fulfilment and multi-location
  stock, neither of which exists here. The migration path is recorded.
- **Adopted:** `allow_backorder` as a per-product flag, and `location_id` noted
  as the multi-warehouse extension point.

### 2. Permissions — Saleor (`saleor/permission/enums.py`)

Saleor models ~30 granular permissions (`MANAGE_PRODUCTS`, `MANAGE_ORDERS`,
`HANDLE_PAYMENTS`, `MANAGE_STAFF`, …) rather than one admin flag.

- **Gap identified:** this project has a binary `customer | admin` role, so a
  warehouse clerk who can adjust stock can also change prices.
- **Decision (ADR-007):** introduce an append-only **admin audit log** now, so
  every privileged action is attributable, and record granular RBAC as the next
  step. An audit trail is the control that matters first: without it, finer
  permissions still leave no evidence of who did what.

### 3. Faceted navigation — Vendure (`Facet` entity)

Vendure marks facets `isPrivate`, separating customer-facing facets from
internal ones.

- **Adopted as an SEO control (ADR-004):** only a curated set of
  vehicle × category combinations becomes an indexable URL. Everything else stays
  a query-string filter that is `noindex`. This is what prevents faceted-index
  explosion, which is the single biggest SEO risk in a parts catalogue.

### 4. Storefront architecture — Vercel Commerce

Server components for catalogue reads, client components only for interaction;
cart mutations return authoritative server state.

- **Confirms** the existing split. No change.

### 5. Fitment — ACES / PIES (Auto Care Association)

The aftermarket standard models fitment as a **BaseVehicle** (Make + Model +
Year) narrowed by SubModel/Trim, EngineBase and qualifiers — not as a flat
make/model pair.

- **Gap identified:** the initial schema modelled `brand → model → engine` with a
  year window on the fitment row. It could not express "پژو ۲۰۶ **تیپ ۵**" as
  data, and it could not distinguish "fits, unspecified engine" from "fits every
  engine".
- **Decision (ADR-002):** introduce `vehicle_generations`, `vehicle_trims` and an
  explicit **`vehicle_configurations`** row — the ACES *BaseVehicle*
  equivalent — and hang fitments off that.
- **Also adopted from PIES:** supersession chains and cross-reference numbers as
  first-class relations (ADR-003), because a superseded part number is how
  customers actually search for older parts.

---

## Reference index

| Question | Studied | Outcome |
| -------- | ------- | ------- |
| Inventory reservation shape | Medusa inventory module | Confirmed; ADR-006 |
| Admin permission granularity | Saleor permission enums | Gap found; ADR-007 |
| Facet privacy / indexability | Vendure `Facet` | Adopted; ADR-004 |
| Server/client boundary, caching | Vercel Commerce | Confirmed; no change |
| Vehicle fitment taxonomy | ACES/PIES concepts | Gap found; ADR-002, ADR-003 |

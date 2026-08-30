# Data model

25 tables. `src/infrastructure/db/schema.ts` is the schema of record; migrations
in `src/infrastructure/db/migrations/` are generated from it, with
`0001_search_fa.sql` hand-written for the search infrastructure.

## Conventions

- **Primary keys** — UUID v4 (`gen_random_uuid()`). Sequential ids would let a
  customer enumerate orders or infer sales volume.
- **Money** — `bigint` integers in **Toman**. See docs/ARCHITECTURE.md.
- **Years** — vehicle production years are **Jalali** (`1390`…`1404`), stored as
  `smallint`, because that is how Iranian model years are quoted.
- **Timestamps** — `timestamptz`, always UTC in the database, rendered in
  `Asia/Tehran` with the Persian calendar.
- **Deletion** — catalogue rows are deactivated, not deleted, so order history
  stays intact. Foreign keys from orders use `ON DELETE SET NULL`; child rows
  (images, specs, fitments) cascade.

---

## Groups

### Identity
`users` · `sessions` · `addresses`

`users.phone` is the login identifier and is unique; `email` is optional and
unique *when present* (partial unique index). `sessions` stores only the SHA-256
of the token plus a hashed IP.

### Catalogue
`categories` · `brands` · `products` · `product_images` · `product_specs`

`categories` is self-referencing (`parent_id`), giving a tree of arbitrary depth;
listing queries walk it with a recursive CTE so a parent category includes its
descendants' products. `product_specs` is a row-per-attribute table rather than a
JSON blob, so specs can be listed, ordered and (later) filtered on.

Constraints worth noting on `products`:
```sql
CHECK (price >= 0)
CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price < price))
```
The second makes a "sale" that raises the price impossible at the database level.

### Vehicles and fitment

The taxonomy follows the shape of the ACES automotive standard rather than a
flat product→vehicle join (ADR-002):

```
vehicle_brands ─< vehicle_models ─┬─< vehicle_generations
                                  ├─< vehicle_trims
                                  └─< vehicle_engines
                          ↘ all four ↙
                     vehicle_configurations ─< product_fitments >─ products
```

A **configuration** is one addressable vehicle: a model, optionally narrowed by
generation, trim, engine and a Jalali year window. `NULL` in any narrowing
column means *any* — so `(206, NULL, NULL, NULL, NULL–NULL)` is "any 206" and
`(206, NULL, TIP5, TU5, 1390–1400)` is one specific car. A unique index over the
tuple (coalescing the nullable columns to a sentinel UUID, since SQL `NULL`
never equals `NULL`) makes the same description resolve to the same row, and a
`specificity` column records how many narrowing dimensions are set.

A **fitment** links a product to a configuration with a type:

| `fitment_type` | Meaning |
| -------------- | ------- |
| `DIRECT` | fits as-is |
| `WITH_MODIFICATION` | fits, but the recorded note says what must change |
| `NOT_COMPATIBLE` | recorded exclusion — this part does *not* fit this vehicle |

The third is the one that matters most. Because exclusions are data rather than
absence of data, a specific "does not fit پژو ۲۰۶ TU3" can override a broad
"fits پژو ۲۰۶" — and a vehicle with no matching row at all resolves to
**UNKNOWN**, never to "does not fit". The resolution rules live in
`src/domain/fitment.ts` and are pure; the queries that feed them are in
`src/application/fitment-service.ts`. See ADR-008.

This is what makes "پژو ۲۰۶ / تیپ ۵ / TU5 / ۱۴۰۰" a SQL query rather than a
text search.

### Saved vehicles

`customer_vehicles` links a user to a configuration («گاراژ من»), unique on
(user, configuration), with exactly one default enforced by the service. Guests
get the same capability through a cookie holding a configuration id — it is a
public taxonomy identifier, not a credential, and it is deliberately not
`httpOnly` so client components can read it.

### Part-number relations

`product_references` records typed relations between part numbers:
`SUPERSEDES`, `SUPERSEDED_BY`, `ALTERNATE`, `CROSS_REFERENCE`. A row points
either at another product we stock (`target_product_id`) or at a bare number we
do not (`target_number`); a CHECK requires at least one. Search matches
`target_number`, so looking up a competitor's part number finds ours (ADR-003).

### Bulk import

`import_jobs` holds one row per uploaded file: the parsed-and-validated rows in
`payload`, the per-row errors in `errors`, and a status of
`PENDING → VALIDATED → COMMITTED` (or `FAILED`). Validation writes only this
row; the commit applies `payload` in a single transaction and flips the status,
which is what makes a re-submitted job a no-op rather than a double import.

### Inventory
`inventory` (one row per product) · `inventory_events` (append-only)

```sql
CHECK (quantity_on_hand >= 0)
CHECK (quantity_reserved >= 0)
CHECK (quantity_reserved <= quantity_on_hand)   -- inventory_no_oversell
```

The third constraint is the last line of defence against overselling: even if the
service layer had a bug, the database refuses the write. Every movement writes an
`inventory_events` row carrying the delta, both resulting quantities, a reason,
and the order or admin responsible.

### Cart
`carts` · `cart_items`

A cart belongs to a user **or** to a guest cookie (SHA-256 of the token), enforced
by two partial unique indexes. `cart_items` is unique on `(cart_id, product_id)`
so a line can be upserted, with `CHECK (quantity > 0)`.

Note that carts store **no prices**. The cart is re-priced from live product rows
on every read, so a stale cart cannot lock in an old price.

### Orders
`orders` · `order_items` · `payments` · `shipments` · `order_events`

`orders` holds an immutable snapshot: customer name, phone, full shipping
address, all money columns, and the shipping method's code *and* display name.
`order_items` copies the product's SKU, title, brand, OEM number, image and unit
price. Nothing about a placed order depends on the current catalogue.

- `tracking_token` — unique, 24 random bytes, the public tracking handle.
- `reservation_expires_at` — when an unpaid order's hold lapses; a partial index
  on `status = 'PENDING_PAYMENT'` makes the sweeper's scan cheap.
- `payments` has a partial unique index on `(provider, provider_ref)`, so the same
  gateway reference cannot be recorded twice.
- `order_events` is append-only and carries `is_public`, which is what separates
  the customer timeline from internal notes.

### Shipping configuration
`shipping_methods` · `shipping_rates`

A method has a base cost, a per-kilogram cost, an optional free-shipping
threshold, a delivery-time window, and an optional province allow-list (empty =
nationwide). `shipping_rates` adds a per-province surcharge or a flat override,
unique on `(method_id, province)`.

### Operations
`store_settings` (typed key/value) · `rate_limits` (fixed-window counters)

---

## Indexes

Beyond primary and unique keys:

| Index | Query it serves |
| ----- | --------------- |
| `products_search_doc_idx` (GIN) | full-text search |
| `products_search_plain_trgm_idx` (GIN trgm) | fuzzy / substring search |
| `products_sku_norm_idx`, `products_oem_norm_idx` | part-number lookup |
| `products_active_published_idx` | default storefront listing |
| `products_category_idx`, `products_brand_idx`, `products_price_idx` | facet filters |
| `pvc_product_idx`, `pvc_model_idx`, `pvc_engine_idx` | fitment lookups both ways |
| `inventory_low_stock_idx` (partial) | admin low-stock report |
| `orders_pending_expiry_idx` (partial) | reservation sweeper |
| `orders_user_idx`, `orders_status_idx` | account history, admin filters |
| `order_items_order_idx`, `order_events_order_idx` | order detail hydration |
| `sessions_token_hash_unique`, `sessions_expires_idx` | session lookup and pruning |

---

## Entity relationships

```
users ─┬─< sessions
       ├─< addresses
       └─< orders ─┬─< order_items >─ products
                   ├─< payments
                   ├─< shipments
                   └─< order_events

categories ─< categories (self)          brands ─< products
categories ─< products

products ─┬─< product_images
          ├─< product_specs
          ├─── inventory (1:1) ─< inventory_events
          ├─< product_references >─ products (self, optional)
          └─< product_fitments >─ vehicle_configurations ─┬─ vehicle_models >─ vehicle_brands
                                                          ├─ vehicle_generations
                                                          ├─ vehicle_trims
                                                          └─ vehicle_engines

users ─< customer_vehicles >─ vehicle_configurations
users ─< admin_audit_log          users ─< import_jobs

carts ─< cart_items >─ products
shipping_methods ─< shipping_rates
```

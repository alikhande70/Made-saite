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
`vehicle_brands` → `vehicle_models` → `vehicle_engines`, joined to products by
`product_vehicle_compat`.

A fitment row means: *this product fits this model*, optionally narrowed to one
engine and/or a Jalali year window. `NULL` engine means every engine; `NULL`
years mean every year. A partial unique index (coalescing the nullable columns)
prevents duplicate fitments, and a CHECK enforces `year_from <= year_to`.

This is what makes "پژو ۲۰۶ / TU5 / ۱۴۰۰" a SQL query rather than a text search.

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
          └─< product_vehicle_compat >─┬─ vehicle_models >─ vehicle_brands
                                       └─ vehicle_engines

carts ─< cart_items >─ products
shipping_methods ─< shipping_rates
```

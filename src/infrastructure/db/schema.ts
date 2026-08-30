/**
 * Database schema (PostgreSQL, Drizzle ORM).
 *
 * MONEY: every monetary column is an integer amount of **Toman (IRT)**.
 * Toman is the unit Iranian shoppers actually read, and it has no sub-unit in
 * retail use, so integers avoid float rounding entirely. See docs/ARCHITECTURE.md.
 *
 * YEARS: vehicle production years are **Jalali (Persian calendar)** years,
 * e.g. 1390..1404 — that is how Iranian vehicle model years are quoted.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* ────────────────────────────── enums ────────────────────────────── */

export const userRoleEnum = pgEnum('user_role', ['customer', 'admin']);

export const orderStatusEnum = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'INITIATED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
]);

export const shipmentStatusEnum = pgEnum('shipment_status', [
  'PENDING',
  'READY',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
]);

export const productConditionEnum = pgEnum('product_condition', [
  'new',        // نو
  'refurbished',// بازسازی‌شده
  'used',       // کارکرده
]);

/** Inventory movement kinds. Reservation never changes on_hand, only reserved. */
export const inventoryEventTypeEnum = pgEnum('inventory_event_type', [
  'RECEIVE',   // ورود کالا به انبار
  'ADJUST',    // اصلاح دستی (انبارگردانی، ضایعات)
  'RESERVE',   // رزرو برای سفارش
  'RELEASE',   // آزادسازی رزرو
  'FULFILL',   // خروج قطعی از انبار
  'RETURN',    // مرجوعی
]);

export const orderActorEnum = pgEnum('order_actor', ['customer', 'admin', 'system', 'gateway']);

export const shippingMethodKindEnum = pgEnum('shipping_method_kind', [
  'STANDARD', // پست پیشتاز
  'COURIER',  // پیک
  'POST',     // پست سفارشی
  'PICKUP',   // تحویل حضوری
]);

/* ────────────────────────────── users & auth ────────────────────────────── */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('customer'),
    isActive: boolean('is_active').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_phone_unique').on(t.phone),
    uniqueIndex('users_email_unique').on(t.email).where(sql`${t.email} is not null`),
  ],
);

/** Opaque server-side sessions. Only the SHA-256 of the token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 60 }),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    province: varchar('province', { length: 60 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    postalAddress: text('postal_address').notNull(),
    postalCode: varchar('postal_code', { length: 10 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

/* ────────────────────────────── catalog taxonomy ────────────────────────────── */

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    slug: varchar('slug', { length: 140 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    nameEn: varchar('name_en', { length: 140 }),
    description: text('description'),
    imageUrl: text('image_url'),
    icon: varchar('icon', { length: 40 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 320 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('categories_slug_unique').on(t.slug),
    index('categories_parent_idx').on(t.parentId),
  ],
);

export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 140 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    nameEn: varchar('name_en', { length: 140 }),
    country: varchar('country', { length: 80 }),
    logoUrl: text('logo_url'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 320 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('brands_slug_unique').on(t.slug)],
);

/* ────────────────────────────── vehicles ────────────────────────────── */

export const vehicleBrands = pgTable(
  'vehicle_brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 120 }).notNull(),
    nameFa: varchar('name_fa', { length: 120 }).notNull(),
    nameEn: varchar('name_en', { length: 120 }),
    logoUrl: text('logo_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('vehicle_brands_slug_unique').on(t.slug)],
);

export const vehicleModels = pgTable(
  'vehicle_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleBrandId: uuid('vehicle_brand_id')
      .notNull()
      .references(() => vehicleBrands.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 140 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    nameEn: varchar('name_en', { length: 140 }),
    /** Jalali production window for the model line itself. */
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('vehicle_models_slug_unique').on(t.slug),
    index('vehicle_models_brand_idx').on(t.vehicleBrandId),
  ],
);

/** Engine / trim, e.g. TU5, XU7, EF7. */
export const vehicleEngines = pgTable(
  'vehicle_engines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleModelId: uuid('vehicle_model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 60 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    displacementCc: integer('displacement_cc'),
    fuelType: varchar('fuel_type', { length: 40 }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('vehicle_engines_model_code_unique').on(t.vehicleModelId, t.code),
    index('vehicle_engines_model_idx').on(t.vehicleModelId),
  ],
);

/* ────────────────────────────── products ────────────────────────────── */

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: varchar('sku', { length: 64 }).notNull(),
    oemNumber: varchar('oem_number', { length: 80 }),
    mpn: varchar('mpn', { length: 80 }),
    slug: varchar('slug', { length: 200 }).notNull(),
    titleFa: varchar('title_fa', { length: 260 }).notNull(),
    titleEn: varchar('title_en', { length: 260 }),
    descriptionFa: text('description_fa'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    manufacturer: varchar('manufacturer', { length: 140 }),
    /** List price, Toman. */
    price: bigint('price', { mode: 'number' }).notNull(),
    /** Optional promotional price, Toman. Must be < price when present. */
    salePrice: bigint('sale_price', { mode: 'number' }),
    weightGrams: integer('weight_grams'),
    lengthMm: integer('length_mm'),
    widthMm: integer('width_mm'),
    heightMm: integer('height_mm'),
    warrantyMonths: smallint('warranty_months'),
    countryOfOrigin: varchar('country_of_origin', { length: 80 }),
    condition: productConditionEnum('condition').notNull().default('new'),
    installationNotes: text('installation_notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    seoTitle: varchar('seo_title', { length: 200 }),
    seoDescription: varchar('seo_description', { length: 320 }),
    isActive: boolean('is_active').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_sku_unique').on(t.sku),
    uniqueIndex('products_slug_unique').on(t.slug),
    index('products_category_idx').on(t.categoryId),
    index('products_brand_idx').on(t.brandId),
    index('products_active_idx').on(t.isActive),
    index('products_price_idx').on(t.price),
    index('products_oem_idx').on(t.oemNumber),
    check('products_price_non_negative', sql`${t.price} >= 0`),
    check(
      'products_sale_price_valid',
      sql`${t.salePrice} is null or (${t.salePrice} >= 0 and ${t.salePrice} < ${t.price})`,
    ),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: varchar('alt', { length: 250 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.sortOrder)],
);

/** Free-form technical spec rows, e.g. «قطر» / «۲۸۰ میلی‌متر». */
export const productSpecs = pgTable(
  'product_specs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    specKey: varchar('spec_key', { length: 120 }).notNull(),
    specValue: varchar('spec_value', { length: 240 }).notNull(),
    unit: varchar('unit', { length: 40 }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('product_specs_product_idx').on(t.productId, t.sortOrder)],
);

/**
 * Fitment. A row means: this product fits this model, optionally narrowed to a
 * specific engine and/or a Jalali year window. NULL engine = all engines.
 */
export const productVehicleCompat = pgTable(
  'product_vehicle_compat',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    vehicleModelId: uuid('vehicle_model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    vehicleEngineId: uuid('vehicle_engine_id').references(() => vehicleEngines.id, {
      onDelete: 'cascade',
    }),
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    note: varchar('note', { length: 240 }),
  },
  (t) => [
    index('pvc_product_idx').on(t.productId),
    index('pvc_model_idx').on(t.vehicleModelId),
    index('pvc_engine_idx').on(t.vehicleEngineId),
    uniqueIndex('pvc_unique_fitment').on(
      t.productId,
      t.vehicleModelId,
      sql`coalesce(${t.vehicleEngineId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.yearFrom}, 0)`,
      sql`coalesce(${t.yearTo}, 0)`,
    ),
    check('pvc_year_window_valid', sql`${t.yearFrom} is null or ${t.yearTo} is null or ${t.yearFrom} <= ${t.yearTo}`),
  ],
);

/* ────────────────────────────── inventory ────────────────────────────── */

/**
 * One row per product. `quantityReserved` is held by unpaid/unfulfilled orders.
 * Available = onHand - reserved, enforced by a CHECK constraint so the database
 * itself is the last line of defence against overselling.
 */
export const inventory = pgTable(
  'inventory',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('inventory_on_hand_non_negative', sql`${t.quantityOnHand} >= 0`),
    check('inventory_reserved_non_negative', sql`${t.quantityReserved} >= 0`),
    check('inventory_no_oversell', sql`${t.quantityReserved} <= ${t.quantityOnHand}`),
  ],
);

export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    type: inventoryEventTypeEnum('type').notNull(),
    /** Signed change applied by this event to the field its type touches. */
    delta: integer('delta').notNull(),
    quantityOnHandAfter: integer('quantity_on_hand_after').notNull(),
    quantityReservedAfter: integer('quantity_reserved_after').notNull(),
    reason: varchar('reason', { length: 240 }),
    orderId: uuid('order_id'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inventory_events_product_idx').on(t.productId, t.createdAt),
    index('inventory_events_order_idx').on(t.orderId),
  ],
);

/* ────────────────────────────── cart ────────────────────────────── */

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the anonymous cart cookie for guest carts. */
    anonTokenHash: varchar('anon_token_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('carts_user_unique').on(t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex('carts_anon_unique').on(t.anonTokenHash).where(sql`${t.anonTokenHash} is not null`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cart_items_cart_product_unique').on(t.cartId, t.productId),
    check('cart_items_qty_positive', sql`${t.quantity} > 0`),
  ],
);

/* ────────────────────────────── shipping ────────────────────────────── */

export const shippingMethods = pgTable(
  'shipping_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(),
    kind: shippingMethodKindEnum('kind').notNull(),
    nameFa: varchar('name_fa', { length: 120 }).notNull(),
    description: varchar('description', { length: 300 }),
    /** Toman. */
    baseCost: bigint('base_cost', { mode: 'number' }).notNull().default(0),
    perKgCost: bigint('per_kg_cost', { mode: 'number' }).notNull().default(0),
    /** Order subtotal (Toman) at or above which shipping is free. NULL = never. */
    freeOverSubtotal: bigint('free_over_subtotal', { mode: 'number' }),
    estimatedDaysMin: smallint('estimated_days_min'),
    estimatedDaysMax: smallint('estimated_days_max'),
    /** Empty array = available in every province. */
    availableProvinces: text('available_provinces').array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('shipping_methods_code_unique').on(t.code)],
);

/** Per-province surcharge/override for a method. */
export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    methodId: uuid('method_id')
      .notNull()
      .references(() => shippingMethods.id, { onDelete: 'cascade' }),
    province: varchar('province', { length: 60 }).notNull(),
    costOverride: bigint('cost_override', { mode: 'number' }),
    surcharge: bigint('surcharge', { mode: 'number' }).notNull().default(0),
  },
  (t) => [uniqueIndex('shipping_rates_method_province_unique').on(t.methodId, t.province)],
);

/* ────────────────────────────── orders ────────────────────────────── */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: varchar('order_number', { length: 24 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: orderStatusEnum('status').notNull().default('PENDING_PAYMENT'),

    // Immutable customer + shipping snapshot taken at placement time.
    customerFullName: varchar('customer_full_name', { length: 160 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
    customerEmail: varchar('customer_email', { length: 255 }),
    shippingProvince: varchar('shipping_province', { length: 60 }).notNull(),
    shippingCity: varchar('shipping_city', { length: 80 }).notNull(),
    shippingAddress: text('shipping_address').notNull(),
    shippingPostalCode: varchar('shipping_postal_code', { length: 10 }).notNull(),
    deliveryNotes: varchar('delivery_notes', { length: 500 }),

    // Server-computed money snapshot, Toman.
    subtotal: bigint('subtotal', { mode: 'number' }).notNull(),
    discountTotal: bigint('discount_total', { mode: 'number' }).notNull().default(0),
    shippingTotal: bigint('shipping_total', { mode: 'number' }).notNull().default(0),
    grandTotal: bigint('grand_total', { mode: 'number' }).notNull(),

    shippingMethodCode: varchar('shipping_method_code', { length: 40 }).notNull(),
    shippingMethodName: varchar('shipping_method_name', { length: 120 }).notNull(),

    /** Random, unguessable token used for public (guest) order tracking. */
    trackingToken: varchar('tracking_token', { length: 64 }).notNull(),

    paymentProvider: varchar('payment_provider', { length: 40 }).notNull(),
    /** Stock reservation expiry for PENDING_PAYMENT orders. */
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.orderNumber),
    uniqueIndex('orders_tracking_token_unique').on(t.trackingToken),
    index('orders_user_idx').on(t.userId, t.placedAt),
    index('orders_status_idx').on(t.status),
    index('orders_reservation_expiry_idx').on(t.reservationExpiresAt),
    check('orders_totals_non_negative', sql`${t.subtotal} >= 0 and ${t.grandTotal} >= 0`),
  ],
);

/** Immutable line snapshot: product data is copied, never joined, at order time. */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    sku: varchar('sku', { length: 64 }).notNull(),
    titleFa: varchar('title_fa', { length: 260 }).notNull(),
    brandName: varchar('brand_name', { length: 140 }),
    oemNumber: varchar('oem_number', { length: 80 }),
    imageUrl: text('image_url'),
    productSlug: varchar('product_slug', { length: 200 }),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    quantity: integer('quantity').notNull(),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
    weightGrams: integer('weight_grams'),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_qty_positive', sql`${t.quantity} > 0`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 40 }).notNull(),
    /** Gateway-side identifier (authority / token). Unique per provider. */
    providerRef: varchar('provider_ref', { length: 160 }),
    status: paymentStatusEnum('status').notNull().default('INITIATED'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** Gateway's own transaction id, present after successful verification. */
    transactionId: varchar('transaction_id', { length: 160 }),
    failureReason: varchar('failure_reason', { length: 300 }),
    /** Redacted gateway payload — never contains card data. */
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    uniqueIndex('payments_provider_ref_unique')
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} is not null`),
  ],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrier: varchar('carrier', { length: 120 }),
    methodCode: varchar('method_code', { length: 40 }).notNull(),
    trackingCode: varchar('tracking_code', { length: 80 }),
    status: shipmentStatusEnum('status').notNull().default('PENDING'),
    cost: bigint('cost', { mode: 'number' }).notNull().default(0),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shipments_order_idx').on(t.orderId), index('shipments_tracking_idx').on(t.trackingCode)],
);

/** Append-only audit trail for everything that happens to an order. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status'),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    message: varchar('message', { length: 500 }),
    actorType: orderActorEnum('actor_type').notNull().default('system'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Shown to the customer on the tracking page when true. */
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

/* ────────────────────────────── settings ────────────────────────────── */

export const storeSettings = pgTable('store_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Simple durable counter table backing per-IP/per-identity rate limits. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: varchar('bucket', { length: 160 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] })],
);

/* ────────────────────────────── relations ────────────────────────────── */

export const productRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  images: many(productImages),
  specs: many(productSpecs),
  compat: many(productVehicleCompat),
  inventory: one(inventory, { fields: [products.id], references: [inventory.productId] }),
}));

export const categoryRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: 'parent' }),
  children: many(categories, { relationName: 'parent' }),
  products: many(products),
}));

export const brandRelations = relations(brands, ({ many }) => ({ products: many(products) }));

export const vehicleBrandRelations = relations(vehicleBrands, ({ many }) => ({ models: many(vehicleModels) }));
export const vehicleModelRelations = relations(vehicleModels, ({ one, many }) => ({
  brand: one(vehicleBrands, { fields: [vehicleModels.vehicleBrandId], references: [vehicleBrands.id] }),
  engines: many(vehicleEngines),
}));
export const vehicleEngineRelations = relations(vehicleEngines, ({ one }) => ({
  model: one(vehicleModels, { fields: [vehicleEngines.vehicleModelId], references: [vehicleModels.id] }),
}));

export const compatRelations = relations(productVehicleCompat, ({ one }) => ({
  product: one(products, { fields: [productVehicleCompat.productId], references: [products.id] }),
  model: one(vehicleModels, { fields: [productVehicleCompat.vehicleModelId], references: [vehicleModels.id] }),
  engine: one(vehicleEngines, { fields: [productVehicleCompat.vehicleEngineId], references: [vehicleEngines.id] }),
}));

export const orderRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  payments: many(payments),
  shipments: many(shipments),
  events: many(orderEvents),
}));

export const orderItemRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const cartRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}));

export const userRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
  sessions: many(sessions),
}));

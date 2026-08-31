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

/**
 * How a part relates to a vehicle configuration.
 *
 * `NOT_COMPATIBLE` is a *negative assertion*, deliberately distinct from having
 * no row at all: absence of data means "unknown", never "does not fit". See
 * ADR-002 and ADR-008.
 */
export const fitmentTypeEnum = pgEnum('fitment_type', [
  'DIRECT',
  'WITH_MODIFICATION',
  'NOT_COMPATIBLE',
]);

/** Part-number relationships, following the PIES relationship types. */
export const productReferenceTypeEnum = pgEnum('product_reference_type', [
  'SUPERSEDES',       // this part replaces the referenced number
  'SUPERSEDED_BY',    // this part has been replaced by the referenced number
  'ALTERNATE',        // functionally equivalent part
  'CROSS_REFERENCE',  // another manufacturer's number for the same part
]);

export const searchSubmissionStatusEnum = pgEnum('search_submission_status', [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
]);

export const importStatusEnum = pgEnum('import_status', [
  'PENDING',
  'VALIDATED',
  'COMMITTED',
  'FAILED',
]);

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

/** A production generation of a model, e.g. «نسل دوم». Optional narrowing. */
export const vehicleGenerations = pgTable(
  'vehicle_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleModelId: uuid('vehicle_model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 60 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('vehicle_generations_model_code_unique').on(t.vehicleModelId, t.code),
    index('vehicle_generations_model_idx').on(t.vehicleModelId),
  ],
);

/** A trim / sub-model, e.g. «تیپ ۵». The ACES SubModel equivalent. */
export const vehicleTrims = pgTable(
  'vehicle_trims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleModelId: uuid('vehicle_model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    vehicleGenerationId: uuid('vehicle_generation_id').references(() => vehicleGenerations.id, {
      onDelete: 'set null',
    }),
    code: varchar('code', { length: 60 }).notNull(),
    nameFa: varchar('name_fa', { length: 140 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('vehicle_trims_model_code_unique').on(t.vehicleModelId, t.code),
    index('vehicle_trims_model_idx').on(t.vehicleModelId),
  ],
);

/**
 * A concrete vehicle a customer can own and a part can fit — the ACES
 * *BaseVehicle* equivalent.
 *
 * Rows are created on demand (when an admin records a fitment, or a customer
 * saves a garage vehicle) rather than by materialising every combination, so the
 * table stays proportional to real usage.
 *
 * A NULL narrowing column means "not specified", which during matching reads as
 * "applies to all values of this field" — see `application/fitment-service.ts`.
 */
export const vehicleConfigurations = pgTable(
  'vehicle_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleModelId: uuid('vehicle_model_id')
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'cascade' }),
    vehicleGenerationId: uuid('vehicle_generation_id').references(() => vehicleGenerations.id, {
      onDelete: 'cascade',
    }),
    vehicleTrimId: uuid('vehicle_trim_id').references(() => vehicleTrims.id, { onDelete: 'cascade' }),
    vehicleEngineId: uuid('vehicle_engine_id').references(() => vehicleEngines.id, {
      onDelete: 'cascade',
    }),
    /** Jalali production-year window. NULL/NULL = every year. */
    yearFrom: smallint('year_from'),
    yearTo: smallint('year_to'),
    /**
     * How many narrowing fields are set (0-4). Used to rank a more specific
     * fitment above a broader one when both match. Maintained by the service.
     */
    specificity: smallint('specificity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_configurations_model_idx').on(t.vehicleModelId),
    index('vehicle_configurations_engine_idx').on(t.vehicleEngineId),
    index('vehicle_configurations_trim_idx').on(t.vehicleTrimId),
    check(
      'vehicle_configurations_year_window_valid',
      sql`${t.yearFrom} is null or ${t.yearTo} is null or ${t.yearFrom} <= ${t.yearTo}`,
    ),
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
    /** Groups interchangeable parts, e.g. all «لنت ترمز جلو پژو». */
    productFamily: varchar('product_family', { length: 140 }),
    /** Permits ordering beyond stock on hand. Off by default. */
    allowBackorder: boolean('allow_backorder').notNull().default(false),
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
 * Which vehicle configurations a part fits.
 *
 * Replaces the earlier `product_vehicle_compat` table, which could not express a
 * trim and could not record a known-negative fit (ADR-002).
 */
export const productFitments = pgTable(
  'product_fitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    vehicleConfigurationId: uuid('vehicle_configuration_id')
      .notNull()
      .references(() => vehicleConfigurations.id, { onDelete: 'cascade' }),
    fitmentType: fitmentTypeEnum('fitment_type').notNull().default('DIRECT'),
    /** Shown to the customer, e.g. «نیازمند تعویض واشر». */
    note: varchar('note', { length: 240 }),
    /** Provenance: 'manual', 'import', or a supplier identifier. */
    source: varchar('source', { length: 60 }).notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('product_fitments_unique').on(t.productId, t.vehicleConfigurationId),
    index('product_fitments_product_idx').on(t.productId),
    index('product_fitments_configuration_idx').on(t.vehicleConfigurationId),
  ],
);

/**
 * Part-number relationships (PIES-style). The target may be another product row
 * **or** a bare number we do not stock — cross-references frequently point at
 * other manufacturers' numbers, and those still need to be searchable so the
 * customer lands on the part we do sell (ADR-003).
 */
export const productReferences = pgTable(
  'product_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    relationType: productReferenceTypeEnum('relation_type').notNull(),
    targetProductId: uuid('target_product_id').references(() => products.id, { onDelete: 'cascade' }),
    targetNumber: varchar('target_number', { length: 80 }),
    targetBrand: varchar('target_brand', { length: 140 }),
    note: varchar('note', { length: 240 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('product_references_product_idx').on(t.productId),
    index('product_references_target_product_idx').on(t.targetProductId),
    index('product_references_number_idx').on(t.targetNumber),
    check(
      'product_references_has_target',
      sql`${t.targetProductId} is not null or ${t.targetNumber} is not null`,
    ),
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

/* ────────────────────────────── customer garage ────────────────────────────── */

/**
 * «گاراژ من» — vehicles a customer has saved. Selecting one lets the storefront
 * answer "does this fit *my* car?" and filter the catalogue accordingly.
 */
export const customerVehicles = pgTable(
  'customer_vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleConfigurationId: uuid('vehicle_configuration_id')
      .notNull()
      .references(() => vehicleConfigurations.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 80 }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_vehicles_user_idx').on(t.userId),
    uniqueIndex('customer_vehicles_user_config_unique').on(t.userId, t.vehicleConfigurationId),
  ],
);

/* ────────────────────────────── operations ────────────────────────────── */

/**
 * Append-only record of privileged actions.
 *
 * The role model is currently binary (customer/admin), so an audit trail is what
 * makes any administrative action attributable and reversible. Granular RBAC is
 * the next step — see ADR-007.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dotted action, e.g. `product.update`, `inventory.adjust`, `order.transition`. */
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }),
    entityId: varchar('entity_id', { length: 80 }),
    /** Human-readable Persian summary shown in the admin UI. */
    summary: varchar('summary', { length: 400 }).notNull(),
    /** Redacted structured context. Never contains secrets or full PII. */
    metadata: jsonb('metadata'),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_log_created_idx').on(t.createdAt),
    index('admin_audit_log_actor_idx').on(t.actorUserId),
    index('admin_audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** A bulk catalogue import: validated first, committed only on request. */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 40 }).notNull().default('products'),
    filename: varchar('filename', { length: 240 }),
    status: importStatusEnum('status').notNull().default('PENDING'),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    /** Per-row validation errors, capped before storage. */
    errors: jsonb('errors'),
    /** The parsed, validated rows held between validate and commit. */
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [index('import_jobs_created_idx').on(t.createdAt)],
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
  fitments: many(productFitments),
  references: many(productReferences),
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
  generations: many(vehicleGenerations),
  trims: many(vehicleTrims),
  configurations: many(vehicleConfigurations),
}));
export const vehicleEngineRelations = relations(vehicleEngines, ({ one }) => ({
  model: one(vehicleModels, { fields: [vehicleEngines.vehicleModelId], references: [vehicleModels.id] }),
}));

export const fitmentRelations = relations(productFitments, ({ one }) => ({
  product: one(products, { fields: [productFitments.productId], references: [products.id] }),
  configuration: one(vehicleConfigurations, {
    fields: [productFitments.vehicleConfigurationId],
    references: [vehicleConfigurations.id],
  }),
}));

export const vehicleConfigurationRelations = relations(vehicleConfigurations, ({ one, many }) => ({
  model: one(vehicleModels, { fields: [vehicleConfigurations.vehicleModelId], references: [vehicleModels.id] }),
  generation: one(vehicleGenerations, {
    fields: [vehicleConfigurations.vehicleGenerationId],
    references: [vehicleGenerations.id],
  }),
  trim: one(vehicleTrims, { fields: [vehicleConfigurations.vehicleTrimId], references: [vehicleTrims.id] }),
  engine: one(vehicleEngines, { fields: [vehicleConfigurations.vehicleEngineId], references: [vehicleEngines.id] }),
  fitments: many(productFitments),
}));

export const productReferenceRelations = relations(productReferences, ({ one }) => ({
  product: one(products, {
    fields: [productReferences.productId],
    references: [products.id],
    relationName: 'source',
  }),
  targetProduct: one(products, {
    fields: [productReferences.targetProductId],
    references: [products.id],
    relationName: 'target',
  }),
}));

export const customerVehicleRelations = relations(customerVehicles, ({ one }) => ({
  user: one(users, { fields: [customerVehicles.userId], references: [users.id] }),
  configuration: one(vehicleConfigurations, {
    fields: [customerVehicles.vehicleConfigurationId],
    references: [vehicleConfigurations.id],
  }),
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
  vehicles: many(customerVehicles),
  orders: many(orders),
  sessions: many(sessions),
}));

/* ── search submission outbox ─────────────────────────────────────────────── */

/**
 * Outbox for search-engine change notifications.
 *
 * An admin saving a product must not wait on — or be failed by — a third
 * party's availability, so nothing calls a search engine from a request path.
 * The write that changes SEO-relevant state enqueues a row here in the same
 * transaction, and the background sweeper drains it. That makes submission
 * crash-safe (the row survives a restart), retryable, deduplicated and
 * observable, at the cost of one small table.
 *
 * `pending_url_unique` is the flood control: a partial unique index over
 * (url, adapter) restricted to unsettled rows means an afternoon of repeated
 * edits to one product collapses onto a single pending submission, while a
 * later edit after that one completed correctly enqueues a fresh notification.
 */
export const searchSubmissionEvents = pgTable(
  'search_submission_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Absolute, normalised canonical URL. */
    url: text('url').notNull(),
    /** Adapter id, e.g. `indexnow`. Not an enum: adapters are pluggable. */
    adapter: varchar('adapter', { length: 40 }).notNull(),
    /** What happened, for the audit trail — never used to decide behaviour. */
    eventType: varchar('event_type', { length: 60 }).notNull(),
    status: searchSubmissionStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** Truncated on write; never contains the submission key. */
    lastError: varchar('last_error', { length: 300 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('search_submission_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`status = 'PENDING'`),
    index('search_submission_status_idx').on(t.status),
    uniqueIndex('search_submission_pending_unique')
      .on(t.url, t.adapter)
      .where(sql`status in ('PENDING', 'PROCESSING')`),
  ],
);

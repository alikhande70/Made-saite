/** Fixture builders for integration tests. Kept minimal and explicit. */
import { sql } from 'drizzle-orm';
import { getDb } from '@/infrastructure/db/client';
import {
  brands, categories, inventory, productImages, products, shippingMethods,
  users, vehicleBrands, vehicleEngines, vehicleModels, vehicleTrims, productFitments,
} from '@/infrastructure/db/schema';
import { hashPassword } from '@/lib/crypto';

let counter = 0;
const next = () => (counter += 1);

/** Wipes every table, preserving schema. Called between tests. */
export async function resetDatabase(): Promise<void> {
  await getDb().execute(sql`
    truncate table
      order_events, order_items, payments, shipments, orders,
      cart_items, carts,
      inventory_events, inventory,
      product_fitments, product_references, product_specs, product_images, products,
      customer_vehicles, vehicle_configurations,
      vehicle_engines, vehicle_trims, vehicle_generations, vehicle_models, vehicle_brands,
      categories, brands,
      shipping_rates, shipping_methods,
      sessions, addresses, users,
      store_settings, rate_limits, admin_audit_log, import_jobs,
      search_submission_events
    restart identity cascade
  `);
}

export async function createCategory(nameFa = 'دستهٔ آزمایشی') {
  const n = next();
  const [row] = await getDb()
    .insert(categories)
    .values({ slug: `cat-${n}`, nameFa: `${nameFa} ${n}`, isActive: true })
    .returning();
  return row!;
}

export async function createBrand(nameFa = 'برند آزمایشی') {
  const n = next();
  const [row] = await getDb()
    .insert(brands)
    .values({ slug: `brand-${n}`, nameFa: `${nameFa} ${n}`, isActive: true })
    .returning();
  return row!;
}

export interface ProductOptions {
  titleFa?: string;
  price?: number;
  salePrice?: number | null;
  stock?: number;
  isActive?: boolean;
  weightGrams?: number;
  categoryId?: string | null;
  brandId?: string | null;
  sku?: string;
  oemNumber?: string | null;
  tags?: string[];
  lowStockThreshold?: number;
}

export async function createProduct(opts: ProductOptions = {}) {
  const n = next();
  const db = getDb();
  const [row] = await db
    .insert(products)
    .values({
      sku: opts.sku ?? `SKU-${n}`,
      oemNumber: opts.oemNumber ?? null,
      slug: `product-${n}`,
      titleFa: opts.titleFa ?? `کالای آزمایشی ${n}`,
      price: opts.price ?? 1_000_000,
      salePrice: opts.salePrice ?? null,
      weightGrams: opts.weightGrams ?? 500,
      categoryId: opts.categoryId ?? null,
      brandId: opts.brandId ?? null,
      tags: opts.tags ?? [],
      isActive: opts.isActive ?? true,
      publishedAt: new Date(),
    })
    .returning();

  await db.insert(inventory).values({
    productId: row!.id,
    quantityOnHand: opts.stock ?? 10,
    quantityReserved: 0,
    lowStockThreshold: opts.lowStockThreshold ?? 3,
  });

  await db.insert(productImages).values({
    productId: row!.id,
    url: '/demo/oil-filter.svg',
    alt: row!.titleFa,
    isPrimary: true,
    sortOrder: 0,
  });

  return row!;
}

export async function createShippingMethod(overrides: Partial<typeof shippingMethods.$inferInsert> = {}) {
  const n = next();
  const [row] = await getDb()
    .insert(shippingMethods)
    .values({
      code: overrides.code ?? `ship-${n}`,
      kind: overrides.kind ?? 'POST',
      nameFa: overrides.nameFa ?? 'پست آزمایشی',
      baseCost: overrides.baseCost ?? 100_000,
      perKgCost: overrides.perKgCost ?? 0,
      freeOverSubtotal: overrides.freeOverSubtotal ?? null,
      availableProvinces: overrides.availableProvinces ?? [],
      isActive: overrides.isActive ?? true,
      sortOrder: overrides.sortOrder ?? 0,
      estimatedDaysMin: overrides.estimatedDaysMin ?? 2,
      estimatedDaysMax: overrides.estimatedDaysMax ?? 4,
    })
    // Several tests place more than one order and re-declare the same method.
    .onConflictDoUpdate({
      target: shippingMethods.code,
      set: { baseCost: overrides.baseCost ?? 100_000, perKgCost: overrides.perKgCost ?? 0 },
    })
    .returning();
  return row!;
}

export async function createUser(role: 'customer' | 'admin' = 'customer', phone?: string) {
  const n = next();
  const [row] = await getDb()
    .insert(users)
    .values({
      phone: phone ?? `0912000${String(n).padStart(4, '0')}`,
      fullName: role === 'admin' ? 'مدیر آزمایشی' : 'مشتری آزمایشی',
      passwordHash: await hashPassword('Password@123'),
      role,
    })
    .returning();
  return row!;
}

export async function createVehicle() {
  const n = next();
  const db = getDb();
  const [brand] = await db
    .insert(vehicleBrands)
    .values({ slug: `vb-${n}`, nameFa: 'ایران خودرو', isActive: true })
    .returning();
  const [model] = await db
    .insert(vehicleModels)
    .values({
      vehicleBrandId: brand!.id, slug: `vm-${n}`, nameFa: 'پژو ۲۰۶',
      yearFrom: 1380, yearTo: 1402, isActive: true,
    })
    .returning();
  const [engine] = await db
    .insert(vehicleEngines)
    .values({ vehicleModelId: model!.id, code: 'TU5', nameFa: 'موتور TU5', displacementCc: 1587, isActive: true })
    .returning();
  return { brand: brand!, model: model!, engine: engine! };
}

/** Records a fitment, creating the vehicle configuration it needs. */
export async function addFitment(
  productId: string,
  modelId: string,
  engineId: string | null = null,
  years: { from?: number; to?: number } = {},
  options: { trimId?: string | null; type?: 'DIRECT' | 'WITH_MODIFICATION' | 'NOT_COMPATIBLE'; note?: string } = {},
) {
  const { getOrCreateConfiguration } = await import('@/application/fitment-service');
  const configurationId = await getOrCreateConfiguration({
    vehicleModelId: modelId,
    vehicleEngineId: engineId,
    vehicleTrimId: options.trimId ?? null,
    yearFrom: years.from ?? null,
    yearTo: years.to ?? null,
  });
  await getDb()
    .insert(productFitments)
    .values({
      productId,
      vehicleConfigurationId: configurationId,
      fitmentType: options.type ?? 'DIRECT',
      note: options.note ?? null,
    })
    .onConflictDoNothing();
  return configurationId;
}

/** Adds a trim to a model, for fitment tests that narrow on one. */
export async function createTrim(modelId: string, code = 'TIP5', nameFa = 'تیپ ۵') {
  const [row] = await getDb()
    .insert(vehicleTrims)
    .values({ vehicleModelId: modelId, code, nameFa, isActive: true })
    .returning();
  return row!;
}

/** Reads current stock numbers straight from the table. */
export async function stockOf(productId: string) {
  const [row] = await getDb()
    .select()
    .from(inventory)
    .where(sql`product_id = ${productId}`);
  return row!;
}

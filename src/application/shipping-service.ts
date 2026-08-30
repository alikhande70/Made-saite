/**
 * Shipping. Reads the admin-configured methods and per-province rates, then
 * defers the actual arithmetic to the pure `domain/shipping` module.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import { shippingMethods, shippingRates } from '@/infrastructure/db/schema';
import {
  quoteAll,
  quoteShipping,
  isMethodAvailableInProvince,
  type ShippingMethodConfig,
  type ShippingQuote,
  type ProvinceRate,
} from '@/domain/shipping';
import { errors } from '@/domain/errors';

async function loadMethods(db: Database, includeInactive = false): Promise<ShippingMethodConfig[]> {
  const rows = await db.select().from(shippingMethods).orderBy(asc(shippingMethods.sortOrder));
  return rows
    .filter((r) => includeInactive || r.isActive)
    .map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      nameFa: r.nameFa,
      description: r.description,
      baseCost: r.baseCost,
      perKgCost: r.perKgCost,
      freeOverSubtotal: r.freeOverSubtotal,
      estimatedDaysMin: r.estimatedDaysMin,
      estimatedDaysMax: r.estimatedDaysMax,
      availableProvinces: r.availableProvinces,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
    }));
}

async function loadRates(db: Database): Promise<ProvinceRate[]> {
  const rows = await db.select().from(shippingRates);
  return rows.map((r) => ({
    methodId: r.methodId,
    province: r.province,
    costOverride: r.costOverride,
    surcharge: r.surcharge,
  }));
}

/** All shipping options available for a destination, with prices. */
export async function getShippingOptions(
  province: string,
  subtotal: number,
  totalWeightGrams: number,
  db: Database = getDb(),
): Promise<ShippingQuote[]> {
  const [methods, rates] = await Promise.all([loadMethods(db), loadRates(db)]);
  return quoteAll(methods, rates, province, subtotal, totalWeightGrams);
}

/**
 * Re-quotes one method server-side at order time. This is the only shipping
 * figure that ever reaches the `orders` table — the client's number is ignored.
 */
export async function quoteMethodOrThrow(
  methodCode: string,
  province: string,
  subtotal: number,
  totalWeightGrams: number,
  db: Database = getDb(),
): Promise<ShippingQuote> {
  const [methods, rates] = await Promise.all([loadMethods(db), loadRates(db)]);
  const method = methods.find((m) => m.code === methodCode);
  if (!method) throw errors.validation('روش ارسال انتخاب‌شده معتبر نیست.');
  if (!isMethodAvailableInProvince(method, province)) {
    throw errors.validation(`روش ارسال «${method.nameFa}» برای استان ${province} در دسترس نیست.`);
  }
  return quoteShipping({
    method,
    province,
    subtotal,
    totalWeightGrams,
    rate: rates.find((r) => r.methodId === method.id && r.province === province),
  });
}

/* ── admin ── */

export async function listShippingMethodsAdmin(db: Database = getDb()) {
  return db.select().from(shippingMethods).orderBy(asc(shippingMethods.sortOrder));
}

export async function listShippingRatesAdmin(methodId: string, db: Database = getDb()) {
  return db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.methodId, methodId))
    .orderBy(asc(shippingRates.province));
}

export type ShippingMethodInput = {
  code: string;
  kind: 'STANDARD' | 'COURIER' | 'POST' | 'PICKUP';
  nameFa: string;
  description?: string | null;
  baseCost: number;
  perKgCost: number;
  freeOverSubtotal?: number | null;
  estimatedDaysMin?: number | null;
  estimatedDaysMax?: number | null;
  availableProvinces?: string[];
  isActive: boolean;
  sortOrder: number;
};

export async function upsertShippingMethod(
  input: ShippingMethodInput & { id?: string },
  db: Database = getDb(),
) {
  const values = {
    code: input.code,
    kind: input.kind,
    nameFa: input.nameFa,
    description: input.description ?? null,
    baseCost: input.baseCost,
    perKgCost: input.perKgCost,
    freeOverSubtotal: input.freeOverSubtotal ?? null,
    estimatedDaysMin: input.estimatedDaysMin ?? null,
    estimatedDaysMax: input.estimatedDaysMax ?? null,
    availableProvinces: input.availableProvinces ?? [],
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
  if (input.id) {
    const [row] = await db
      .update(shippingMethods)
      .set(values)
      .where(eq(shippingMethods.id, input.id))
      .returning();
    if (!row) throw errors.notFound('روش ارسال یافت نشد.');
    return row;
  }
  const [row] = await db.insert(shippingMethods).values(values).returning();
  return row!;
}

export async function deleteShippingMethod(id: string, db: Database = getDb()): Promise<void> {
  await db.delete(shippingMethods).where(eq(shippingMethods.id, id));
}

export async function upsertProvinceRate(
  input: { methodId: string; province: string; costOverride: number | null; surcharge: number },
  db: Database = getDb(),
) {
  const [row] = await db
    .insert(shippingRates)
    .values(input)
    .onConflictDoUpdate({
      target: [shippingRates.methodId, shippingRates.province],
      set: { costOverride: input.costOverride, surcharge: input.surcharge },
    })
    .returning();
  return row!;
}

export async function deleteProvinceRate(id: string, db: Database = getDb()): Promise<void> {
  await db.delete(shippingRates).where(eq(shippingRates.id, id));
}

export type { ShippingQuote };

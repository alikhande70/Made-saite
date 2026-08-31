/**
 * Inventory service — the only code permitted to mutate `inventory`.
 *
 * Concurrency model
 * -----------------
 * Every mutation runs inside a caller-provided transaction and begins by taking
 * row locks with `SELECT … FOR UPDATE`, **always ordered by product_id**. A
 * consistent lock order makes deadlocks between two concurrent checkouts
 * impossible. Two customers racing for the last unit therefore serialise: the
 * first commits the reservation, the second re-reads the locked row, sees zero
 * available and fails with a Persian out-of-stock error.
 *
 * The `inventory_no_oversell` CHECK constraint is the backstop: even if this
 * service had a bug, the database would refuse the write.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@/infrastructure/db/client';
import { inventory, inventoryEvents, orderItems, products } from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import { availableQuantity, type StockLevel } from '@/domain/inventory';
import { toPersianDigits } from '@/lib/fa';

export interface ReservationLine {
  readonly productId: string;
  readonly quantity: number;
  /** Used only to build a helpful Persian error message. */
  readonly title: string;
}

interface InventoryRow {
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
}

/** Locks the given products' inventory rows in a deterministic order. */
async function lockRows(tx: Database, productIds: readonly string[]): Promise<Map<string, InventoryRow>> {
  if (productIds.length === 0) return new Map();
  const unique = [...new Set(productIds)].sort();
  const rows = await tx
    .select({
      productId: inventory.productId,
      quantityOnHand: inventory.quantityOnHand,
      quantityReserved: inventory.quantityReserved,
      lowStockThreshold: inventory.lowStockThreshold,
    })
    .from(inventory)
    .where(inArray(inventory.productId, unique))
    .orderBy(inventory.productId)
    .for('update');

  return new Map(rows.map((r) => [r.productId, r]));
}

async function recordEvent(
  tx: Database,
  input: {
    productId: string;
    type: 'RECEIVE' | 'ADJUST' | 'RESERVE' | 'RELEASE' | 'FULFILL' | 'RETURN';
    delta: number;
    onHandAfter: number;
    reservedAfter: number;
    reason?: string | null;
    orderId?: string | null;
    actorUserId?: string | null;
  },
): Promise<void> {
  await tx.insert(inventoryEvents).values({
    productId: input.productId,
    type: input.type,
    delta: input.delta,
    quantityOnHandAfter: input.onHandAfter,
    quantityReservedAfter: input.reservedAfter,
    reason: input.reason ?? null,
    orderId: input.orderId ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

/**
 * Holds stock for an order. Raises `quantity_reserved`; `quantity_on_hand` is
 * untouched until the order is paid. Throws on the first line that cannot be
 * satisfied, which rolls the whole transaction back — orders are all-or-nothing.
 */
export async function reserveStock(
  tx: Database,
  lines: readonly ReservationLine[],
  orderId: string | null,
  actorUserId: string | null = null,
): Promise<void> {
  if (lines.length === 0) throw errors.cartEmpty();

  // Merge duplicate product ids so a single row lock covers the full quantity.
  const merged = new Map<string, ReservationLine>();
  for (const line of lines) {
    const existing = merged.get(line.productId);
    merged.set(
      line.productId,
      existing ? { ...existing, quantity: existing.quantity + line.quantity } : line,
    );
  }

  const locked = await lockRows(tx, [...merged.keys()]);

  for (const productId of [...merged.keys()].sort()) {
    const line = merged.get(productId)!;
    const row = locked.get(productId);
    if (!row) throw errors.productUnavailable(line.title);

    const available = availableQuantity(row satisfies StockLevel);
    if (available < line.quantity) {
      if (available <= 0) throw errors.outOfStock(line.title);
      throw errors.insufficientStock(line.title, available);
    }

    const reservedAfter = row.quantityReserved + line.quantity;
    await tx
      .update(inventory)
      .set({ quantityReserved: reservedAfter, updatedAt: new Date() })
      .where(eq(inventory.productId, productId));

    await recordEvent(tx, {
      productId,
      type: 'RESERVE',
      delta: line.quantity,
      onHandAfter: row.quantityOnHand,
      reservedAfter,
      orderId,
      actorUserId,
      reason: 'رزرو موجودی برای سفارش',
    });
  }
}

/**
 * Releases a reservation without shipping (cancel / payment failure / expiry).
 * Idempotency is the caller's responsibility: it must only be invoked while the
 * order still holds its reservation, inside the same transaction that changes
 * the order status, so a retry cannot double-release.
 */
export async function releaseReservation(
  tx: Database,
  orderId: string,
  reason: string,
  actorUserId: string | null = null,
): Promise<void> {
  const lines = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const withProduct = lines.filter(
    (l): l is { productId: string; quantity: number } => l.productId !== null,
  );
  if (withProduct.length === 0) return;

  const locked = await lockRows(tx, withProduct.map((l) => l.productId));

  for (const line of [...withProduct].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const row = locked.get(line.productId);
    if (!row) continue; // product deleted since; nothing left to release
    const reservedAfter = Math.max(0, row.quantityReserved - line.quantity);
    await tx
      .update(inventory)
      .set({ quantityReserved: reservedAfter, updatedAt: new Date() })
      .where(eq(inventory.productId, line.productId));
    await recordEvent(tx, {
      productId: line.productId,
      type: 'RELEASE',
      delta: -line.quantity,
      onHandAfter: row.quantityOnHand,
      reservedAfter,
      orderId,
      actorUserId,
      reason,
    });
  }
}

/**
 * Converts a reservation into a real deduction once payment succeeds:
 * `on_hand -= qty` and `reserved -= qty`, leaving `available` unchanged.
 */
export async function fulfillReservation(
  tx: Database,
  orderId: string,
  reason = 'خروج از انبار پس از پرداخت',
  actorUserId: string | null = null,
): Promise<void> {
  const lines = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const withProduct = lines.filter(
    (l): l is { productId: string; quantity: number } => l.productId !== null,
  );
  if (withProduct.length === 0) return;

  const locked = await lockRows(tx, withProduct.map((l) => l.productId));

  for (const line of [...withProduct].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const row = locked.get(line.productId);
    if (!row) continue;
    const onHandAfter = Math.max(0, row.quantityOnHand - line.quantity);
    const reservedAfter = Math.max(0, row.quantityReserved - line.quantity);
    await tx
      .update(inventory)
      .set({ quantityOnHand: onHandAfter, quantityReserved: reservedAfter, updatedAt: new Date() })
      .where(eq(inventory.productId, line.productId));
    await recordEvent(tx, {
      productId: line.productId,
      type: 'FULFILL',
      delta: -line.quantity,
      onHandAfter,
      reservedAfter,
      orderId,
      actorUserId,
      reason,
    });
  }
}

/** Puts stock back on the shelf after a refund/return. */
export async function returnStock(
  tx: Database,
  orderId: string,
  reason = 'بازگشت کالا پس از مرجوعی',
  actorUserId: string | null = null,
): Promise<void> {
  const lines = await tx
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const withProduct = lines.filter(
    (l): l is { productId: string; quantity: number } => l.productId !== null,
  );
  if (withProduct.length === 0) return;

  const locked = await lockRows(tx, withProduct.map((l) => l.productId));
  for (const line of [...withProduct].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const row = locked.get(line.productId);
    if (!row) continue;
    const onHandAfter = row.quantityOnHand + line.quantity;
    await tx
      .update(inventory)
      .set({ quantityOnHand: onHandAfter, updatedAt: new Date() })
      .where(eq(inventory.productId, line.productId));
    await recordEvent(tx, {
      productId: line.productId,
      type: 'RETURN',
      delta: line.quantity,
      onHandAfter,
      reservedAfter: row.quantityReserved,
      orderId,
      actorUserId,
      reason,
    });
  }
}

/**
 * Admin stock movement. `delta` is signed and applies to on-hand quantity.
 * A negative delta may not push available stock below zero — reserved units
 * belong to real orders.
 */
export async function adjustStock(
  tx: Database,
  input: {
    productId: string;
    delta: number;
    type?: 'RECEIVE' | 'ADJUST';
    reason: string;
    actorUserId: string | null;
  },
): Promise<{ quantityOnHand: number; quantityReserved: number }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw errors.validation('مقدار تغییر موجودی باید عددی صحیح و مخالف صفر باشد.');
  }
  const locked = await lockRows(tx, [input.productId]);
  const row = locked.get(input.productId);
  if (!row) throw errors.notFound('برای این کالا رکورد موجودی ثبت نشده است.');

  const onHandAfter = row.quantityOnHand + input.delta;
  if (onHandAfter < 0) {
    throw errors.conflict(
      `کاهش موجودی ممکن نیست: موجودی فعلی ${toPersianDigits(row.quantityOnHand)} عدد است.`,
    );
  }
  if (onHandAfter < row.quantityReserved) {
    throw errors.conflict(
      `کاهش موجودی ممکن نیست: ${toPersianDigits(row.quantityReserved)} عدد برای سفارش‌های ثبت‌شده رزرو شده است.`,
    );
  }

  await tx
    .update(inventory)
    .set({ quantityOnHand: onHandAfter, updatedAt: new Date() })
    .where(eq(inventory.productId, input.productId));

  await recordEvent(tx, {
    productId: input.productId,
    type: input.type ?? (input.delta > 0 ? 'RECEIVE' : 'ADJUST'),
    delta: input.delta,
    onHandAfter,
    reservedAfter: row.quantityReserved,
    reason: input.reason,
    actorUserId: input.actorUserId,
  });

  return { quantityOnHand: onHandAfter, quantityReserved: row.quantityReserved };
}

export async function setLowStockThreshold(
  tx: Database,
  productId: string,
  threshold: number,
): Promise<void> {
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw errors.validation('آستانه هشدار موجودی باید عددی صحیح و نامنفی باشد.');
  }
  await tx
    .update(inventory)
    .set({ lowStockThreshold: threshold, updatedAt: new Date() })
    .where(eq(inventory.productId, productId));
}

export async function ensureInventoryRow(tx: Database, productId: string): Promise<void> {
  await tx.insert(inventory).values({ productId }).onConflictDoNothing();
}

/** Products at or below their low-stock threshold, worst first. */
export async function listLowStock(db: Database, limit = 20) {
  return db
    .select({
      productId: products.id,
      sku: products.sku,
      titleFa: products.titleFa,
      slug: products.slug,
      isActive: products.isActive,
      quantityOnHand: inventory.quantityOnHand,
      quantityReserved: inventory.quantityReserved,
      lowStockThreshold: inventory.lowStockThreshold,
    })
    .from(inventory)
    .innerJoin(products, eq(products.id, inventory.productId))
    .where(sql`${inventory.quantityOnHand} - ${inventory.quantityReserved} <= ${inventory.lowStockThreshold}`)
    .orderBy(sql`${inventory.quantityOnHand} - ${inventory.quantityReserved} asc`)
    .limit(limit);
}

export async function getStockLevel(db: Database, productId: string): Promise<StockLevel | null> {
  const [row] = await db
    .select({
      quantityOnHand: inventory.quantityOnHand,
      quantityReserved: inventory.quantityReserved,
      lowStockThreshold: inventory.lowStockThreshold,
    })
    .from(inventory)
    .where(eq(inventory.productId, productId))
    .limit(1);
  return row ?? null;
}

/** Recent movements for one product, newest first (admin audit view). */
export async function listInventoryEvents(db: Database, productId: string, limit = 50) {
  return db
    .select()
    .from(inventoryEvents)
    .where(eq(inventoryEvents.productId, productId))
    .orderBy(sql`${inventoryEvents.createdAt} desc`)
    .limit(limit);
}

export async function countTrackedProducts(db: Database): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inventory);
  return row?.n ?? 0;
}

export { and };

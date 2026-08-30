/**
 * «گاراژ من» — the customer's saved vehicles.
 *
 * A garage entry is a `users` row joined to a `vehicle_configurations` row, so a
 * saved vehicle is the same kind of object a fitment is recorded against. That
 * is what makes "does this fit my car?" a join rather than a heuristic.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import { customerVehicles } from '@/infrastructure/db/schema';
import { errors } from '@/domain/errors';
import {
  getConfiguration,
  getOrCreateConfiguration,
  type ConfigurationInput,
  type ResolvedConfiguration,
} from './fitment-service';

export interface GarageVehicle {
  id: string;
  configurationId: string;
  nickname: string | null;
  isDefault: boolean;
  configuration: ResolvedConfiguration;
}

export async function listGarage(userId: string, db: Database = getDb()): Promise<GarageVehicle[]> {
  const rows = await db
    .select()
    .from(customerVehicles)
    .where(eq(customerVehicles.userId, userId))
    .orderBy(desc(customerVehicles.isDefault), desc(customerVehicles.createdAt));

  const out: GarageVehicle[] = [];
  for (const row of rows) {
    const configuration = await getConfiguration(row.vehicleConfigurationId, db);
    if (!configuration) continue; // vehicle taxonomy row removed since
    out.push({
      id: row.id,
      configurationId: row.vehicleConfigurationId,
      nickname: row.nickname,
      isDefault: row.isDefault,
      configuration,
    });
  }
  return out;
}

/** Maximum vehicles per customer — a garage, not a fleet register. */
export const MAX_GARAGE_VEHICLES = 10;

export async function addVehicle(
  userId: string,
  input: ConfigurationInput & { nickname?: string | null; makeDefault?: boolean },
): Promise<GarageVehicle> {
  return withTransaction(async (tx) => {
    const [existing] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(customerVehicles)
      .where(eq(customerVehicles.userId, userId));
    const count = existing?.count ?? 0;

    if (count >= MAX_GARAGE_VEHICLES) {
      throw errors.validation(`حداکثر ${MAX_GARAGE_VEHICLES} خودرو در گاراژ قابل ذخیره است.`);
    }

    const configurationId = await getOrCreateConfiguration(input, tx);
    const shouldDefault = input.makeDefault || count === 0;

    if (shouldDefault) {
      await tx
        .update(customerVehicles)
        .set({ isDefault: false })
        .where(eq(customerVehicles.userId, userId));
    }

    const [row] = await tx
      .insert(customerVehicles)
      .values({
        userId,
        vehicleConfigurationId: configurationId,
        nickname: input.nickname?.trim() || null,
        isDefault: shouldDefault,
      })
      .onConflictDoUpdate({
        target: [customerVehicles.userId, customerVehicles.vehicleConfigurationId],
        set: { nickname: input.nickname?.trim() || null, isDefault: shouldDefault },
      })
      .returning();

    const configuration = await getConfiguration(configurationId, tx);
    if (!row || !configuration) throw errors.conflict('ذخیرهٔ خودرو ممکن نشد.');

    return {
      id: row.id,
      configurationId,
      nickname: row.nickname,
      isDefault: row.isDefault,
      configuration,
    };
  });
}

/** Ownership is part of the WHERE clause, so another customer's id cannot match. */
export async function removeVehicle(userId: string, vehicleId: string): Promise<void> {
  const deleted = await getDb()
    .delete(customerVehicles)
    .where(and(eq(customerVehicles.id, vehicleId), eq(customerVehicles.userId, userId)))
    .returning({ id: customerVehicles.id, wasDefault: customerVehicles.isDefault });

  if (deleted.length === 0) throw errors.notFound('خودرو در گاراژ شما یافت نشد.');

  // Promote another vehicle so the customer is never left without a default.
  if (deleted[0]!.wasDefault) {
    const [next] = await getDb()
      .select({ id: customerVehicles.id })
      .from(customerVehicles)
      .where(eq(customerVehicles.userId, userId))
      .orderBy(desc(customerVehicles.createdAt))
      .limit(1);
    if (next) {
      await getDb()
        .update(customerVehicles)
        .set({ isDefault: true })
        .where(eq(customerVehicles.id, next.id));
    }
  }
}

export async function setDefaultVehicle(userId: string, vehicleId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const owned = await tx
      .select({ id: customerVehicles.id })
      .from(customerVehicles)
      .where(and(eq(customerVehicles.id, vehicleId), eq(customerVehicles.userId, userId)))
      .limit(1);
    if (owned.length === 0) throw errors.notFound('خودرو در گاراژ شما یافت نشد.');

    await tx.update(customerVehicles).set({ isDefault: false }).where(eq(customerVehicles.userId, userId));
    await tx.update(customerVehicles).set({ isDefault: true }).where(eq(customerVehicles.id, vehicleId));
  });
}

export async function getDefaultVehicle(
  userId: string,
  db: Database = getDb(),
): Promise<GarageVehicle | null> {
  const garage = await listGarage(userId, db);
  return garage.find((v) => v.isDefault) ?? garage[0] ?? null;
}

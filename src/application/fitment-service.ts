/**
 * Vehicle configurations, product fitments and part-number references.
 *
 * The pure matching rules live in `domain/fitment`; this module owns persistence
 * and the queries that feed them.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, withTransaction, type Database } from '@/infrastructure/db/client';
import {
  productFitments,
  productReferences,
  products,
  vehicleConfigurations,
  vehicleEngines,
  vehicleGenerations,
  vehicleModels,
  vehicleBrands,
  vehicleTrims,
} from '@/infrastructure/db/schema';
import {
  evaluateCompatibility,
  specificity,
  type CompatibilityResult,
  type ConfigurationSpec,
  type FitmentRecord,
  type FitmentType,
  type ProductReferenceType,
  type VehicleSpec,
} from '@/domain/fitment';
import { errors } from '@/domain/errors';

export interface ConfigurationInput {
  vehicleModelId: string;
  vehicleGenerationId?: string | null;
  vehicleTrimId?: string | null;
  vehicleEngineId?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

function toSpec(input: ConfigurationInput): ConfigurationSpec {
  return {
    modelId: input.vehicleModelId,
    generationId: input.vehicleGenerationId ?? null,
    trimId: input.vehicleTrimId ?? null,
    engineId: input.vehicleEngineId ?? null,
    yearFrom: input.yearFrom ?? null,
    yearTo: input.yearTo ?? null,
  };
}

/**
 * Returns the configuration matching this tuple, creating it if absent.
 *
 * Configurations are created on demand rather than by materialising every
 * combination, so the table stays proportional to real usage. The insert relies
 * on `vehicle_configurations_tuple_unique` (a COALESCE-based index, because
 * NULLs never compare equal in a plain unique index) to stay race-safe: two
 * concurrent callers converge on one row instead of creating duplicates.
 */
export async function getOrCreateConfiguration(
  input: ConfigurationInput,
  db: Database = getDb(),
): Promise<string> {
  const spec = toSpec(input);
  if (spec.yearFrom !== null && spec.yearTo !== null && spec.yearFrom > spec.yearTo) {
    throw errors.validation('سال شروع نمی‌تواند بزرگ‌تر از سال پایان باشد.');
  }

  const values = {
    modelId: spec.modelId,
    generationId: spec.generationId,
    trimId: spec.trimId,
    engineId: spec.engineId,
    yearFrom: spec.yearFrom,
    yearTo: spec.yearTo,
    specificity: specificity(spec),
  };

  const inserted = await db.execute<{ id: string }>(sql`
    insert into vehicle_configurations
      (vehicle_model_id, vehicle_generation_id, vehicle_trim_id, vehicle_engine_id,
       year_from, year_to, specificity)
    values (${values.modelId}, ${values.generationId}, ${values.trimId}, ${values.engineId},
            ${values.yearFrom}, ${values.yearTo}, ${values.specificity})
    on conflict (
      vehicle_model_id,
      coalesce(vehicle_generation_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(vehicle_trim_id,       '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(vehicle_engine_id,     '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(year_from, 0),
      coalesce(year_to, 0)
    ) do nothing
    returning id
  `);

  const created = inserted.rows[0]?.id;
  if (created) return created;

  // Lost the race (or it already existed) — read the winning row.
  const existing = await db.execute<{ id: string }>(sql`
    select id from vehicle_configurations
    where vehicle_model_id = ${values.modelId}
      and vehicle_generation_id is not distinct from ${values.generationId}
      and vehicle_trim_id       is not distinct from ${values.trimId}
      and vehicle_engine_id     is not distinct from ${values.engineId}
      and year_from is not distinct from ${values.yearFrom}
      and year_to   is not distinct from ${values.yearTo}
    limit 1
  `);
  const found = existing.rows[0]?.id;
  if (!found) throw errors.conflict('ثبت پیکربندی خودرو ممکن نشد.');
  return found;
}

/* ── reads ────────────────────────────────────────────────────────────── */

export interface ResolvedConfiguration extends ConfigurationSpec {
  id: string;
  brandNameFa: string;
  brandSlug: string;
  modelNameFa: string;
  modelSlug: string;
  generationNameFa: string | null;
  trimNameFa: string | null;
  engineCode: string | null;
  engineNameFa: string | null;
}

const CONFIGURATION_SELECT = {
  id: vehicleConfigurations.id,
  modelId: vehicleConfigurations.vehicleModelId,
  generationId: vehicleConfigurations.vehicleGenerationId,
  trimId: vehicleConfigurations.vehicleTrimId,
  engineId: vehicleConfigurations.vehicleEngineId,
  yearFrom: vehicleConfigurations.yearFrom,
  yearTo: vehicleConfigurations.yearTo,
  brandNameFa: vehicleBrands.nameFa,
  brandSlug: vehicleBrands.slug,
  modelNameFa: vehicleModels.nameFa,
  modelSlug: vehicleModels.slug,
  generationNameFa: vehicleGenerations.nameFa,
  trimNameFa: vehicleTrims.nameFa,
  engineCode: vehicleEngines.code,
  engineNameFa: vehicleEngines.nameFa,
} as const;

export async function getConfiguration(
  configurationId: string,
  db: Database = getDb(),
): Promise<ResolvedConfiguration | null> {
  const [row] = await db
    .select(CONFIGURATION_SELECT)
    .from(vehicleConfigurations)
    .innerJoin(vehicleModels, eq(vehicleModels.id, vehicleConfigurations.vehicleModelId))
    .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleModels.vehicleBrandId))
    .leftJoin(vehicleGenerations, eq(vehicleGenerations.id, vehicleConfigurations.vehicleGenerationId))
    .leftJoin(vehicleTrims, eq(vehicleTrims.id, vehicleConfigurations.vehicleTrimId))
    .leftJoin(vehicleEngines, eq(vehicleEngines.id, vehicleConfigurations.vehicleEngineId))
    .where(eq(vehicleConfigurations.id, configurationId))
    .limit(1);
  return row ?? null;
}

/** A configuration expressed as the customer's vehicle, for matching. */
export function toVehicleSpec(configuration: ResolvedConfiguration): VehicleSpec {
  return {
    modelId: configuration.modelId,
    generationId: configuration.generationId,
    trimId: configuration.trimId,
    engineId: configuration.engineId,
    // A saved vehicle's window is a single year when both ends agree.
    year:
      configuration.yearFrom !== null && configuration.yearFrom === configuration.yearTo
        ? configuration.yearFrom
        : (configuration.yearFrom ?? configuration.yearTo),
  };
}

export interface ProductFitmentRow extends FitmentRecord {
  id: string;
  configurationId: string;
  brandNameFa: string;
  modelNameFa: string;
  modelSlug: string;
  generationNameFa: string | null;
  trimNameFa: string | null;
  engineCode: string | null;
  source: string;
}

export async function listFitmentsForProduct(
  productId: string,
  db: Database = getDb(),
): Promise<ProductFitmentRow[]> {
  const rows = await db
    .select({
      id: productFitments.id,
      fitmentType: productFitments.fitmentType,
      note: productFitments.note,
      source: productFitments.source,
      configurationId: vehicleConfigurations.id,
      modelId: vehicleConfigurations.vehicleModelId,
      generationId: vehicleConfigurations.vehicleGenerationId,
      trimId: vehicleConfigurations.vehicleTrimId,
      engineId: vehicleConfigurations.vehicleEngineId,
      yearFrom: vehicleConfigurations.yearFrom,
      yearTo: vehicleConfigurations.yearTo,
      brandNameFa: vehicleBrands.nameFa,
      modelNameFa: vehicleModels.nameFa,
      modelSlug: vehicleModels.slug,
      generationNameFa: vehicleGenerations.nameFa,
      trimNameFa: vehicleTrims.nameFa,
      engineCode: vehicleEngines.code,
    })
    .from(productFitments)
    .innerJoin(vehicleConfigurations, eq(vehicleConfigurations.id, productFitments.vehicleConfigurationId))
    .innerJoin(vehicleModels, eq(vehicleModels.id, vehicleConfigurations.vehicleModelId))
    .innerJoin(vehicleBrands, eq(vehicleBrands.id, vehicleModels.vehicleBrandId))
    .leftJoin(vehicleGenerations, eq(vehicleGenerations.id, vehicleConfigurations.vehicleGenerationId))
    .leftJoin(vehicleTrims, eq(vehicleTrims.id, vehicleConfigurations.vehicleTrimId))
    .leftJoin(vehicleEngines, eq(vehicleEngines.id, vehicleConfigurations.vehicleEngineId))
    .where(eq(productFitments.productId, productId))
    .orderBy(asc(vehicleBrands.nameFa), asc(vehicleModels.nameFa));

  return rows.map((r) => ({
    id: r.id,
    fitmentType: r.fitmentType,
    note: r.note,
    source: r.source,
    configurationId: r.configurationId,
    brandNameFa: r.brandNameFa,
    modelNameFa: r.modelNameFa,
    modelSlug: r.modelSlug,
    generationNameFa: r.generationNameFa,
    trimNameFa: r.trimNameFa,
    engineCode: r.engineCode,
    configuration: {
      modelId: r.modelId,
      generationId: r.generationId,
      trimId: r.trimId,
      engineId: r.engineId,
      yearFrom: r.yearFrom,
      yearTo: r.yearTo,
    },
  }));
}

/** Compatibility of one product with one saved vehicle configuration. */
export async function evaluateProductForConfiguration(
  productId: string,
  configurationId: string,
  db: Database = getDb(),
): Promise<CompatibilityResult> {
  const configuration = await getConfiguration(configurationId, db);
  if (!configuration) throw errors.notFound('پیکربندی خودرو یافت نشد.');
  const fitments = await listFitmentsForProduct(productId, db);
  return evaluateCompatibility(fitments, toVehicleSpec(configuration));
}

/**
 * Compatibility for many products at once — one query, then pure evaluation.
 * Used to badge product cards without an N+1.
 */
export async function evaluateManyForConfiguration(
  productIds: readonly string[],
  configurationId: string,
  db: Database = getDb(),
): Promise<Map<string, CompatibilityResult>> {
  const out = new Map<string, CompatibilityResult>();
  if (productIds.length === 0) return out;

  const configuration = await getConfiguration(configurationId, db);
  if (!configuration) return out;
  const vehicle = toVehicleSpec(configuration);

  const rows = await db
    .select({
      productId: productFitments.productId,
      fitmentType: productFitments.fitmentType,
      note: productFitments.note,
      modelId: vehicleConfigurations.vehicleModelId,
      generationId: vehicleConfigurations.vehicleGenerationId,
      trimId: vehicleConfigurations.vehicleTrimId,
      engineId: vehicleConfigurations.vehicleEngineId,
      yearFrom: vehicleConfigurations.yearFrom,
      yearTo: vehicleConfigurations.yearTo,
    })
    .from(productFitments)
    .innerJoin(vehicleConfigurations, eq(vehicleConfigurations.id, productFitments.vehicleConfigurationId))
    .where(inArray(productFitments.productId, [...productIds]));

  const byProduct = new Map<string, FitmentRecord[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push({
      fitmentType: r.fitmentType,
      note: r.note,
      configuration: {
        modelId: r.modelId, generationId: r.generationId, trimId: r.trimId,
        engineId: r.engineId, yearFrom: r.yearFrom, yearTo: r.yearTo,
      },
    });
    byProduct.set(r.productId, list);
  }

  for (const productId of productIds) {
    out.set(productId, evaluateCompatibility(byProduct.get(productId) ?? [], vehicle));
  }
  return out;
}

/* ── admin writes ─────────────────────────────────────────────────────── */

export interface FitmentInput extends ConfigurationInput {
  fitmentType?: FitmentType;
  note?: string | null;
}

/** Replaces a product's fitment set. Configurations are created as needed. */
export async function setProductFitments(
  productId: string,
  fitments: readonly FitmentInput[],
  source = 'manual',
  db: Database = getDb(),
): Promise<void> {
  await db.delete(productFitments).where(eq(productFitments.productId, productId));
  for (const input of fitments) {
    const configurationId = await getOrCreateConfiguration(input, db);
    await db
      .insert(productFitments)
      .values({
        productId,
        vehicleConfigurationId: configurationId,
        fitmentType: input.fitmentType ?? 'DIRECT',
        note: input.note ?? null,
        source,
      })
      .onConflictDoNothing();
  }
}

/* ── part-number references ───────────────────────────────────────────── */

export interface ResolvedReference {
  id: string;
  relationType: ProductReferenceType;
  targetNumber: string | null;
  targetBrand: string | null;
  note: string | null;
  /** Present when the reference points at a product we actually stock. */
  target: { id: string; slug: string; titleFa: string; sku: string; isActive: boolean } | null;
}

export async function listProductReferences(
  productId: string,
  db: Database = getDb(),
): Promise<ResolvedReference[]> {
  const rows = await db
    .select({
      id: productReferences.id,
      relationType: productReferences.relationType,
      targetNumber: productReferences.targetNumber,
      targetBrand: productReferences.targetBrand,
      note: productReferences.note,
      targetId: products.id,
      targetSlug: products.slug,
      targetTitle: products.titleFa,
      targetSku: products.sku,
      targetActive: products.isActive,
    })
    .from(productReferences)
    .leftJoin(products, eq(products.id, productReferences.targetProductId))
    .where(eq(productReferences.productId, productId));

  return rows.map((r) => ({
    id: r.id,
    relationType: r.relationType,
    targetNumber: r.targetNumber,
    targetBrand: r.targetBrand,
    note: r.note,
    target: r.targetId
      ? { id: r.targetId, slug: r.targetSlug!, titleFa: r.targetTitle!, sku: r.targetSku!, isActive: r.targetActive! }
      : null,
  }));
}

export interface ReferenceInput {
  relationType: ProductReferenceType;
  targetProductId?: string | null;
  targetNumber?: string | null;
  targetBrand?: string | null;
  note?: string | null;
}

export async function setProductReferences(
  productId: string,
  references: readonly ReferenceInput[],
  db: Database = getDb(),
): Promise<void> {
  await db.delete(productReferences).where(eq(productReferences.productId, productId));
  const rows = references
    .filter((r) => r.targetProductId || r.targetNumber?.trim())
    .map((r) => ({
      productId,
      relationType: r.relationType,
      targetProductId: r.targetProductId ?? null,
      targetNumber: r.targetNumber?.trim() || null,
      targetBrand: r.targetBrand?.trim() || null,
      note: r.note?.trim() || null,
    }));
  if (rows.length > 0) await db.insert(productReferences).values(rows);
}

export { withTransaction, and, isNull };

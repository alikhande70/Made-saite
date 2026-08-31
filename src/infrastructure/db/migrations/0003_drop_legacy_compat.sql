-- Migrate legacy `product_vehicle_compat` rows onto the configuration-based
-- fitment model (ADR-002), then drop the old table.
--
-- The old shape was (product, model, engine?, year_from?, year_to?). Each
-- distinct vehicle tuple becomes a `vehicle_configurations` row and each compat
-- row becomes a DIRECT fitment against it. Nothing is lost: the old model could
-- express only positive fits, which is exactly what DIRECT means.

-- A configuration is identified by its tuple. NULLs do not compare equal in a
-- plain unique index, so coalesce the nullable columns to sentinels first.
-- This is what makes the service's get-or-create race-safe under concurrency.
CREATE UNIQUE INDEX "vehicle_configurations_tuple_unique" ON "vehicle_configurations" (
  "vehicle_model_id",
  coalesce("vehicle_generation_id", '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("vehicle_trim_id",       '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("vehicle_engine_id",     '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce("year_from", 0),
  coalesce("year_to", 0)
);
--> statement-breakpoint

-- 1. One configuration per distinct legacy vehicle tuple.
INSERT INTO "vehicle_configurations"
  ("vehicle_model_id", "vehicle_engine_id", "year_from", "year_to", "specificity")
SELECT DISTINCT
  c."vehicle_model_id",
  c."vehicle_engine_id",
  c."year_from",
  c."year_to",
  -- Narrowing fields set: generation and trim did not exist in the old model.
  (CASE WHEN c."vehicle_engine_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN c."year_from" IS NOT NULL OR c."year_to" IS NOT NULL THEN 1 ELSE 0 END)
FROM "product_vehicle_compat" c
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. Each legacy row becomes a DIRECT fitment against its configuration.
INSERT INTO "product_fitments"
  ("product_id", "vehicle_configuration_id", "fitment_type", "note", "source")
SELECT
  c."product_id",
  vc."id",
  'DIRECT',
  c."note",
  'migrated'
FROM "product_vehicle_compat" c
JOIN "vehicle_configurations" vc
  ON vc."vehicle_model_id" = c."vehicle_model_id"
 AND vc."vehicle_engine_id" IS NOT DISTINCT FROM c."vehicle_engine_id"
 AND vc."year_from"        IS NOT DISTINCT FROM c."year_from"
 AND vc."year_to"          IS NOT DISTINCT FROM c."year_to"
 AND vc."vehicle_generation_id" IS NULL
 AND vc."vehicle_trim_id"       IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DROP TABLE "product_vehicle_compat" CASCADE;

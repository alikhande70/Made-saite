CREATE TYPE "public"."fitment_type" AS ENUM('DIRECT', 'WITH_MODIFICATION', 'NOT_COMPATIBLE');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('PENDING', 'VALIDATED', 'COMMITTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."product_reference_type" AS ENUM('SUPERSEDES', 'SUPERSEDED_BY', 'ALTERNATE', 'CROSS_REFERENCE');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60),
	"entity_id" varchar(80),
	"summary" varchar(400) NOT NULL,
	"metadata" jsonb,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_configuration_id" uuid NOT NULL,
	"nickname" varchar(80),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"kind" varchar(40) DEFAULT 'products' NOT NULL,
	"filename" varchar(240),
	"status" "import_status" DEFAULT 'PENDING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_fitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"vehicle_configuration_id" uuid NOT NULL,
	"fitment_type" "fitment_type" DEFAULT 'DIRECT' NOT NULL,
	"note" varchar(240),
	"source" varchar(60) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"relation_type" "product_reference_type" NOT NULL,
	"target_product_id" uuid,
	"target_number" varchar(80),
	"target_brand" varchar(140),
	"note" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_references_has_target" CHECK ("product_references"."target_product_id" is not null or "product_references"."target_number" is not null)
);
--> statement-breakpoint
CREATE TABLE "vehicle_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_model_id" uuid NOT NULL,
	"vehicle_generation_id" uuid,
	"vehicle_trim_id" uuid,
	"vehicle_engine_id" uuid,
	"year_from" smallint,
	"year_to" smallint,
	"specificity" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_configurations_year_window_valid" CHECK ("vehicle_configurations"."year_from" is null or "vehicle_configurations"."year_to" is null or "vehicle_configurations"."year_from" <= "vehicle_configurations"."year_to")
);
--> statement-breakpoint
CREATE TABLE "vehicle_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_model_id" uuid NOT NULL,
	"code" varchar(60) NOT NULL,
	"name_fa" varchar(140) NOT NULL,
	"year_from" smallint,
	"year_to" smallint,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_trims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_model_id" uuid NOT NULL,
	"vehicle_generation_id" uuid,
	"code" varchar(60) NOT NULL,
	"name_fa" varchar(140) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_vehicle_compat" DROP CONSTRAINT "pvc_year_window_valid";--> statement-breakpoint
DROP INDEX "pvc_unique_fitment";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_family" varchar(140);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "allow_backorder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_vehicle_configuration_id_vehicle_configurations_id_fk" FOREIGN KEY ("vehicle_configuration_id") REFERENCES "public"."vehicle_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fitments" ADD CONSTRAINT "product_fitments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fitments" ADD CONSTRAINT "product_fitments_vehicle_configuration_id_vehicle_configurations_id_fk" FOREIGN KEY ("vehicle_configuration_id") REFERENCES "public"."vehicle_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_references" ADD CONSTRAINT "product_references_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_references" ADD CONSTRAINT "product_references_target_product_id_products_id_fk" FOREIGN KEY ("target_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_configurations" ADD CONSTRAINT "vehicle_configurations_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_configurations" ADD CONSTRAINT "vehicle_configurations_vehicle_generation_id_vehicle_generations_id_fk" FOREIGN KEY ("vehicle_generation_id") REFERENCES "public"."vehicle_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_configurations" ADD CONSTRAINT "vehicle_configurations_vehicle_trim_id_vehicle_trims_id_fk" FOREIGN KEY ("vehicle_trim_id") REFERENCES "public"."vehicle_trims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_configurations" ADD CONSTRAINT "vehicle_configurations_vehicle_engine_id_vehicle_engines_id_fk" FOREIGN KEY ("vehicle_engine_id") REFERENCES "public"."vehicle_engines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_generations" ADD CONSTRAINT "vehicle_generations_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_vehicle_generation_id_vehicle_generations_id_fk" FOREIGN KEY ("vehicle_generation_id") REFERENCES "public"."vehicle_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_idx" ON "admin_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_entity_idx" ON "admin_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "customer_vehicles_user_idx" ON "customer_vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_vehicles_user_config_unique" ON "customer_vehicles" USING btree ("user_id","vehicle_configuration_id");--> statement-breakpoint
CREATE INDEX "import_jobs_created_idx" ON "import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_fitments_unique" ON "product_fitments" USING btree ("product_id","vehicle_configuration_id");--> statement-breakpoint
CREATE INDEX "product_fitments_product_idx" ON "product_fitments" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_fitments_configuration_idx" ON "product_fitments" USING btree ("vehicle_configuration_id");--> statement-breakpoint
CREATE INDEX "product_references_product_idx" ON "product_references" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_references_target_product_idx" ON "product_references" USING btree ("target_product_id");--> statement-breakpoint
CREATE INDEX "product_references_number_idx" ON "product_references" USING btree ("target_number");--> statement-breakpoint
CREATE INDEX "vehicle_configurations_model_idx" ON "vehicle_configurations" USING btree ("vehicle_model_id");--> statement-breakpoint
CREATE INDEX "vehicle_configurations_engine_idx" ON "vehicle_configurations" USING btree ("vehicle_engine_id");--> statement-breakpoint
CREATE INDEX "vehicle_configurations_trim_idx" ON "vehicle_configurations" USING btree ("vehicle_trim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_generations_model_code_unique" ON "vehicle_generations" USING btree ("vehicle_model_id","code");--> statement-breakpoint
CREATE INDEX "vehicle_generations_model_idx" ON "vehicle_generations" USING btree ("vehicle_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_trims_model_code_unique" ON "vehicle_trims" USING btree ("vehicle_model_id","code");--> statement-breakpoint
CREATE INDEX "vehicle_trims_model_idx" ON "vehicle_trims" USING btree ("vehicle_model_id");
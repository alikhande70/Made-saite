CREATE TYPE "public"."search_submission_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "search_submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"adapter" varchar(40) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"status" "search_submission_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(300),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "search_submission_due_idx" ON "search_submission_events" USING btree ("next_attempt_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "search_submission_status_idx" ON "search_submission_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "search_submission_pending_unique" ON "search_submission_events" USING btree ("url","adapter") WHERE status in ('PENDING', 'PROCESSING');
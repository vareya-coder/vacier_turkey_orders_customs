CREATE TABLE "batch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" varchar(50) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"orders_queried" integer DEFAULT 0,
	"orders_processed" integer DEFAULT 0,
	"orders_skipped" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"error_details" jsonb,
	"credits_used" integer DEFAULT 0,
	"status" varchar(20) NOT NULL,
	CONSTRAINT "batch_runs_batch_id_unique" UNIQUE("batch_id")
);

CREATE TABLE "processing_cursor" (
	"id" serial PRIMARY KEY NOT NULL,
	"cursor_name" varchar(50) NOT NULL,
	"last_processed_date" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_batch_id" varchar(50),
	CONSTRAINT "processing_cursor_cursor_name_unique" UNIQUE("cursor_name")
);
--> statement-breakpoint
CREATE INDEX "processing_cursor_name_idx" ON "processing_cursor" USING btree ("cursor_name");
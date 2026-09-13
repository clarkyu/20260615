CREATE TABLE "ai_grade_cache" (
	"item_id" uuid NOT NULL,
	"answer_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_grade_cache_item_id_answer_hash_pk" PRIMARY KEY("item_id","answer_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_grade_cache" ADD CONSTRAINT "ai_grade_cache_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
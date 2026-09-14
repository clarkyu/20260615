CREATE TABLE "training_progress" (
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"l3_streak" integer DEFAULT 0 NOT NULL,
	"scaffold_off" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"last_result" text,
	"last_at" timestamp with time zone,
	CONSTRAINT "training_progress_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
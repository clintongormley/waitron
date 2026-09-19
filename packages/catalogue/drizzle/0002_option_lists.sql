CREATE TABLE "option_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_name" jsonb,
	"kitchen_name" text,
	"available" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"customer_name" jsonb,
	"kitchen_name" text,
	"default_label_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "option_labels" ADD CONSTRAINT "option_labels_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."option_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "option_labels_list_sort_idx" ON "option_labels" USING btree ("list_id","sort");
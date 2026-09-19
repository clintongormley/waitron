CREATE TABLE "extra_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"preselected" boolean DEFAULT false NOT NULL,
	"price" numeric(12, 2),
	CONSTRAINT "extra_list_items_qty_ck" CHECK ("extra_list_items"."max_quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "extra_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"customer_name" jsonb,
	"kitchen_name" text,
	"min_picks" integer DEFAULT 0 NOT NULL,
	"max_picks" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "extra_lists_picks_ck" CHECK ("extra_lists"."min_picks" >= 0 and ("extra_lists"."max_picks" is null or "extra_lists"."max_picks" >= "extra_lists"."min_picks"))
);
--> statement-breakpoint
ALTER TABLE "extra_list_items" ADD CONSTRAINT "extra_list_items_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_list_items" ADD CONSTRAINT "extra_list_items_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_list_items_list_sort_idx" ON "extra_list_items" USING btree ("list_id","sort");
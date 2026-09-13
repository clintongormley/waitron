CREATE TABLE "menu_item_variants" (
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_variants_pk" PRIMARY KEY("tenant_id","menu_item_id","variant_id"),
	CONSTRAINT "menu_item_variants_price_ck" CHECK ("menu_item_variants"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_variants_tenant_product_id_key" UNIQUE("tenant_id","product_id","id"),
	CONSTRAINT "product_variants_price_ck" CHECK ("product_variants"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_product_id_key" UNIQUE("tenant_id","id","product_id");--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_offer_fk" FOREIGN KEY ("tenant_id","menu_item_id","product_id") REFERENCES "public"."menu_items"("tenant_id","id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_variant_fk" FOREIGN KEY ("tenant_id","product_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;

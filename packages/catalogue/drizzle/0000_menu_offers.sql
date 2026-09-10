CREATE TABLE "menu_item_option_groups" (
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_option_groups_pk" PRIMARY KEY("tenant_id","menu_item_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "menu_item_options" (
	"tenant_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"price_delta" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "menu_item_options_pk" PRIMARY KEY("tenant_id","menu_item_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"gross_price" numeric(12, 2) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_items_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "menu_items_menu_product_key" UNIQUE("tenant_id","menu_id","product_id"),
	CONSTRAINT "menu_items_gross_price_ck" CHECK ("menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_sections_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "menu_sections_tenant_menu_id_key" UNIQUE("tenant_id","menu_id","id")
);
--> statement-breakpoint
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_item_fk" FOREIGN KEY ("tenant_id","menu_item_id") REFERENCES "public"."menu_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."option_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_options" ADD CONSTRAINT "menu_item_options_group_fk" FOREIGN KEY ("tenant_id","menu_item_id","group_id") REFERENCES "public"."menu_item_option_groups"("tenant_id","menu_item_id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_options" ADD CONSTRAINT "menu_item_options_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "public"."option_group_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "public"."catalogues"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_section_fk" FOREIGN KEY ("tenant_id","menu_id","section_id") REFERENCES "public"."menu_sections"("tenant_id","menu_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_menu_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "public"."catalogues"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_items_menu_order_idx" ON "menu_items" USING btree ("tenant_id","menu_id","display_order");--> statement-breakpoint
CREATE INDEX "menu_sections_menu_order_idx" ON "menu_sections" USING btree ("tenant_id","menu_id","display_order");
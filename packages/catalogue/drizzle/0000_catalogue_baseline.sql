CREATE TABLE "content_languages" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_language" text NOT NULL,
	"languages" text[] NOT NULL,
	CONSTRAINT "content_languages_singleton_ck" CHECK ("content_languages"."id" = 1),
	CONSTRAINT "content_languages_default_ck" CHECK ("content_languages"."default_language" = any("content_languages"."languages")),
	CONSTRAINT "content_languages_list_ck" CHECK (cardinality("content_languages"."languages") between 1 and 200 and array_position("content_languages"."languages", null) is null)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"gross_price" bigint NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_items_id_product_key" UNIQUE("id","product_id"),
	CONSTRAINT "menu_items_menu_product_key" UNIQUE("menu_id","product_id"),
	CONSTRAINT "menu_items_gross_price_ck" CHECK ("menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_sections_menu_id_key" UNIQUE("menu_id","id")
);
--> statement-breakpoint
CREATE TABLE "category_details" (
	"category_id" uuid NOT NULL,
	"parent_id" uuid,
	"image" text,
	"color" text,
	CONSTRAINT "category_details_category_id_pk" PRIMARY KEY("category_id")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "product_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "product_units_product_id_pk" PRIMARY KEY("product_id")
);
--> statement-breakpoint
CREATE TABLE "unit_seed_states" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	CONSTRAINT "unit_seed_states_singleton_ck" CHECK ("unit_seed_states"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_key" text,
	"name" jsonb NOT NULL,
	"abbreviation" jsonb NOT NULL,
	"precision" integer NOT NULL,
	"hardware_unit" text,
	CONSTRAINT "units_seed_key_key" UNIQUE("seed_key"),
	CONSTRAINT "units_precision_ck" CHECK ("units"."precision" between 0 and 3),
	CONSTRAINT "units_hardware_unit_ck" CHECK ("units"."hardware_unit" in ('kg', 'g', 'mg'))
);
--> statement-breakpoint
CREATE TABLE "menu_item_variants" (
	"menu_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_price" bigint NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_variants_pk" PRIMARY KEY("menu_item_id","variant_id"),
	CONSTRAINT "menu_item_variants_price_ck" CHECK ("menu_item_variants"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_name" jsonb,
	"kitchen_name" text,
	"image" text,
	"unit_price" bigint NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_variants_product_id_key" UNIQUE("product_id","id"),
	CONSTRAINT "product_variants_price_ck" CHECK ("product_variants"."unit_price" >= 0)
);
--> statement-breakpoint
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
CREATE TABLE "extra_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"preselected" boolean DEFAULT false NOT NULL,
	"price" bigint,
	CONSTRAINT "extra_list_items_qty_ck" CHECK ("extra_list_items"."max_quantity" >= 1),
	CONSTRAINT "extra_list_items_price_ck" CHECK ("extra_list_items"."price" >= 0)
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
CREATE TABLE "menu_item_extra_items" (
	"menu_item_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" bigint,
	"available" boolean DEFAULT true NOT NULL,
	CONSTRAINT "menu_item_extra_items_pk" PRIMARY KEY("menu_item_id","list_id","product_id"),
	CONSTRAINT "menu_item_extra_items_price_ck" CHECK ("menu_item_extra_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_extra_lists" (
	"menu_item_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_extra_lists_pk" PRIMARY KEY("menu_item_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "product_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"extra_list_id" uuid,
	"option_list_id" uuid,
	CONSTRAINT "product_modifiers_one_reference_ck" CHECK (("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null))
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_section_fk" FOREIGN KEY ("menu_id","section_id") REFERENCES "public"."menu_sections"("menu_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_menu_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_details" ADD CONSTRAINT "category_details_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_details" ADD CONSTRAINT "category_details_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_offer_fk" FOREIGN KEY ("menu_item_id","product_id") REFERENCES "public"."menu_items"("id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_variant_fk" FOREIGN KEY ("product_id","variant_id") REFERENCES "public"."product_variants"("product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_labels" ADD CONSTRAINT "option_labels_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."option_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_list_items" ADD CONSTRAINT "extra_list_items_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_list_items" ADD CONSTRAINT "extra_list_items_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ADD CONSTRAINT "menu_item_extra_items_list_fk" FOREIGN KEY ("menu_item_id","list_id") REFERENCES "public"."menu_item_extra_lists"("menu_item_id","list_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ADD CONSTRAINT "menu_item_extra_items_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_lists" ADD CONSTRAINT "menu_item_extra_lists_item_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_extra_lists" ADD CONSTRAINT "menu_item_extra_lists_list_fk" FOREIGN KEY ("list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_extra_list_fk" FOREIGN KEY ("extra_list_id") REFERENCES "public"."extra_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifiers" ADD CONSTRAINT "product_modifiers_option_list_fk" FOREIGN KEY ("option_list_id") REFERENCES "public"."option_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_items_menu_order_idx" ON "menu_items" USING btree ("menu_id","display_order");--> statement-breakpoint
CREATE INDEX "menu_sections_menu_order_idx" ON "menu_sections" USING btree ("menu_id","display_order");--> statement-breakpoint
CREATE INDEX "category_details_parent_idx" ON "category_details" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "product_categories_category_idx" ON "product_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_units_unit_idx" ON "product_units" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "option_labels_list_sort_idx" ON "option_labels" USING btree ("list_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "extra_list_items_list_product_uq" ON "extra_list_items" USING btree ("list_id","product_id");--> statement-breakpoint
CREATE INDEX "extra_list_items_list_sort_idx" ON "extra_list_items" USING btree ("list_id","sort");--> statement-breakpoint
CREATE INDEX "menu_item_extra_items_list_product_idx" ON "menu_item_extra_items" USING btree ("list_id","product_id");--> statement-breakpoint
CREATE INDEX "menu_item_extra_lists_list_idx" ON "menu_item_extra_lists" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "product_modifiers_product_sort_idx" ON "product_modifiers" USING btree ("product_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "product_modifiers_product_extra_uq" ON "product_modifiers" USING btree ("product_id","extra_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_modifiers_product_option_uq" ON "product_modifiers" USING btree ("product_id","option_list_id");
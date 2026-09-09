CREATE TABLE "department_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "department_hours_interval_key" UNIQUE("tenant_id","department_id","weekday","opens_at","closes_at"),
	CONSTRAINT "department_hours_weekday_ck" CHECK ("department_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trading_name" text NOT NULL,
	"default_service_mode" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "departments_location_name_key" UNIQUE("tenant_id","location_id","name"),
	CONSTRAINT "departments_service_mode_ck" CHECK ("departments"."default_service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
CREATE TABLE "device_zone_defaults" (
	"tenant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	CONSTRAINT "device_zone_defaults_pk" PRIMARY KEY("tenant_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "order_service_contexts" (
	"tenant_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"service_mode" text NOT NULL,
	CONSTRAINT "order_service_contexts_pk" PRIMARY KEY("tenant_id","working_order_id"),
	CONSTRAINT "order_service_contexts_mode_ck" CHECK ("order_service_contexts"."service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
CREATE TABLE "preparation_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"zone_id" uuid,
	"category_id" uuid,
	"product_id" uuid,
	"station_id" uuid,
	"no_preparation" boolean DEFAULT false NOT NULL,
	CONSTRAINT "preparation_routes_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "preparation_routes_subject_ck" CHECK (num_nonnulls("preparation_routes"."category_id", "preparation_routes"."product_id") = 1),
	CONSTRAINT "preparation_routes_target_ck" CHECK (num_nonnulls("preparation_routes"."station_id", nullif("preparation_routes"."no_preparation", false)) = 1)
);
--> statement-breakpoint
CREATE TABLE "working_line_contexts" (
	"tenant_id" uuid NOT NULL,
	"working_order_line_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"menu_name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"department_name" text NOT NULL,
	"category_name" text NOT NULL,
	CONSTRAINT "working_line_contexts_pk" PRIMARY KEY("tenant_id","working_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "zone_menus" (
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "zone_menus_pk" PRIMARY KEY("tenant_id","zone_id","menu_id")
);
--> statement-breakpoint
CREATE TABLE "zone_service_policies" (
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"service_mode" text,
	"default_menu_id" uuid,
	CONSTRAINT "zone_service_policies_pk" PRIMARY KEY("tenant_id","zone_id"),
	CONSTRAINT "zone_service_policies_mode_ck" CHECK ("zone_service_policies"."service_mode" is null or "zone_service_policies"."service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
ALTER TABLE "department_hours" ADD CONSTRAINT "department_hours_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_zone_defaults" ADD CONSTRAINT "device_zone_defaults_device_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."devices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_zone_defaults" ADD CONSTRAINT "device_zone_defaults_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."floor_zones"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."floor_zones"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."floor_zones"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "public"."kitchen_stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_line_fk" FOREIGN KEY ("tenant_id","working_order_line_id") REFERENCES "public"."working_order_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_menu_item_fk" FOREIGN KEY ("tenant_id","menu_item_id") REFERENCES "public"."menu_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_menus" ADD CONSTRAINT "zone_menus_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."zone_service_policies"("tenant_id","zone_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_menus" ADD CONSTRAINT "zone_menus_menu_fk" FOREIGN KEY ("tenant_id","menu_id") REFERENCES "public"."catalogues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "public"."floor_zones"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_default_menu_fk" FOREIGN KEY ("tenant_id","default_menu_id") REFERENCES "public"."catalogues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preparation_routes_lookup_idx" ON "preparation_routes" USING btree ("tenant_id","location_id","zone_id","product_id","category_id");--> statement-breakpoint
CREATE INDEX "zone_menus_order_idx" ON "zone_menus" USING btree ("tenant_id","zone_id","display_order");
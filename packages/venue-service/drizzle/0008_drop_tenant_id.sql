ALTER TABLE "department_hours" DROP CONSTRAINT "department_hours_department_fk";
--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_tenant_fk";
--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_location_fk";
--> statement-breakpoint
ALTER TABLE "device_zone_defaults" DROP CONSTRAINT "device_zone_defaults_device_fk";
--> statement-breakpoint
ALTER TABLE "device_zone_defaults" DROP CONSTRAINT "device_zone_defaults_zone_fk";
--> statement-breakpoint
ALTER TABLE "order_service_contexts" DROP CONSTRAINT "order_service_contexts_order_fk";
--> statement-breakpoint
ALTER TABLE "order_service_contexts" DROP CONSTRAINT "order_service_contexts_zone_fk";
--> statement-breakpoint
ALTER TABLE "order_service_contexts" DROP CONSTRAINT "order_service_contexts_department_fk";
--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP CONSTRAINT "preparation_routes_location_fk";
--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP CONSTRAINT "preparation_routes_zone_fk";
--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP CONSTRAINT "preparation_routes_product_fk";
--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP CONSTRAINT "preparation_routes_station_fk";
--> statement-breakpoint
ALTER TABLE "working_line_contexts" DROP CONSTRAINT "working_line_contexts_line_fk";
--> statement-breakpoint
ALTER TABLE "working_line_contexts" DROP CONSTRAINT "working_line_contexts_menu_item_fk";
--> statement-breakpoint
ALTER TABLE "zone_menus" DROP CONSTRAINT "zone_menus_zone_fk";
--> statement-breakpoint
ALTER TABLE "zone_menus" DROP CONSTRAINT "zone_menus_menu_fk";
--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_location_fk";
--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_zone_fk";
--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_department_fk";
--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_default_menu_fk";
--> statement-breakpoint
ALTER TABLE "department_hours" DROP CONSTRAINT "department_hours_interval_key";--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_tenant_id_key";--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_location_name_key";--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP CONSTRAINT "preparation_routes_tenant_id_key";--> statement-breakpoint
DROP INDEX "preparation_routes_lookup_idx";--> statement-breakpoint
DROP INDEX "zone_menus_order_idx";--> statement-breakpoint
ALTER TABLE "device_zone_defaults" DROP CONSTRAINT "device_zone_defaults_pk";
--> statement-breakpoint
ALTER TABLE "device_zone_defaults" ADD CONSTRAINT "device_zone_defaults_pk" PRIMARY KEY("device_id");--> statement-breakpoint
ALTER TABLE "order_service_contexts" DROP CONSTRAINT "order_service_contexts_pk";
--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_pk" PRIMARY KEY("working_order_id");--> statement-breakpoint
ALTER TABLE "working_line_contexts" DROP CONSTRAINT "working_line_contexts_pk";
--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_pk" PRIMARY KEY("working_order_line_id");--> statement-breakpoint
ALTER TABLE "zone_menus" DROP CONSTRAINT "zone_menus_pk";
--> statement-breakpoint
ALTER TABLE "zone_menus" ADD CONSTRAINT "zone_menus_pk" PRIMARY KEY("zone_id","menu_id");--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_pk";
--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_pk" PRIMARY KEY("zone_id");--> statement-breakpoint
ALTER TABLE "department_hours" ADD CONSTRAINT "department_hours_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_zone_defaults" ADD CONSTRAINT "device_zone_defaults_device_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_zone_defaults" ADD CONSTRAINT "device_zone_defaults_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."floor_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."floor_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_service_contexts" ADD CONSTRAINT "order_service_contexts_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."floor_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preparation_routes" ADD CONSTRAINT "preparation_routes_station_fk" FOREIGN KEY ("station_id") REFERENCES "public"."kitchen_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_line_fk" FOREIGN KEY ("working_order_line_id") REFERENCES "public"."working_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_line_contexts" ADD CONSTRAINT "working_line_contexts_menu_item_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_menus" ADD CONSTRAINT "zone_menus_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone_service_policies"("zone_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_menus" ADD CONSTRAINT "zone_menus_menu_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."catalogues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."floor_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_service_policies" ADD CONSTRAINT "zone_service_policies_default_menu_fk" FOREIGN KEY ("default_menu_id") REFERENCES "public"."catalogues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preparation_routes_lookup_idx" ON "preparation_routes" USING btree ("location_id","zone_id","product_id","category_id");--> statement-breakpoint
CREATE INDEX "zone_menus_order_idx" ON "zone_menus" USING btree ("zone_id","display_order");--> statement-breakpoint
ALTER TABLE "department_hours" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "departments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "device_zone_defaults" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "order_service_contexts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "preparation_routes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "working_line_contexts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "zone_menus" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "zone_service_policies" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "department_hours" ADD CONSTRAINT "department_hours_interval_key" UNIQUE("department_id","weekday","opens_at","closes_at");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_location_name_key" UNIQUE("location_id","name");
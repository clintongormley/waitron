ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_node_code_key";--> statement-breakpoint
ALTER TABLE "order_amendments" DROP CONSTRAINT "order_amendments_chain_position_key";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT "dining_tables_location_label_key";--> statement-breakpoint
ALTER TABLE "floor_zones" DROP CONSTRAINT "floor_zones_name_key";--> statement-breakpoint
ALTER TABLE "kitchen_stations" DROP CONSTRAINT "kitchen_stations_name_key";--> statement-breakpoint
ALTER TABLE "kitchen_courses" DROP CONSTRAINT "kitchen_courses_name_key";--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT "ticket_items_working_order_line_id_key";--> statement-breakpoint
ALTER TABLE "print_agents" DROP CONSTRAINT "print_agents_tenant_node_key";--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_supplier_number_key";--> statement-breakpoint
ALTER TABLE "canvases" DROP CONSTRAINT "canvases_tenant_name_key";--> statement-breakpoint
ALTER TABLE "device_profiles" DROP CONSTRAINT "device_profiles_tenant_name_key";--> statement-breakpoint
ALTER TABLE "table_service_statuses" DROP CONSTRAINT "table_service_statuses_tenant_label_key";--> statement-breakpoint
ALTER TABLE "sale_settlements" DROP CONSTRAINT "sale_settlements_sale_key";--> statement-breakpoint
ALTER TABLE "sale_substitutions" DROP CONSTRAINT "sale_substitutions_substituted_key";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_series_invoice_number_key";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_working_order_id_key";--> statement-breakpoint
ALTER TABLE "daily_closes" DROP CONSTRAINT "daily_closes_business_day_key";--> statement-breakpoint
ALTER TABLE "daily_closes" DROP CONSTRAINT "daily_closes_sequence_key";--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "tills" DROP CONSTRAINT "tills_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "nodes" DROP CONSTRAINT "nodes_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_node_fk";--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT "working_order_lines_order_fk";--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT "working_order_lines_product_fk";--> statement-breakpoint
ALTER TABLE "working_orders" DROP CONSTRAINT "working_orders_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "working_orders" DROP CONSTRAINT "working_orders_node_fk";--> statement-breakpoint
ALTER TABLE "order_amendments" DROP CONSTRAINT "order_amendments_order_fk";--> statement-breakpoint
ALTER TABLE "order_amendments" DROP CONSTRAINT "order_amendments_till_fk";--> statement-breakpoint
ALTER TABLE "order_amendments" DROP CONSTRAINT "order_amendments_node_fk";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT "dining_tables_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT "dining_tables_location_fk";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT "dining_tables_status_fk";--> statement-breakpoint
ALTER TABLE "floor_zones" DROP CONSTRAINT "floor_zones_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "floor_zones" DROP CONSTRAINT "floor_zones_location_fk";--> statement-breakpoint
ALTER TABLE "kitchen_stations" DROP CONSTRAINT "kitchen_stations_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "kitchen_stations" DROP CONSTRAINT "kitchen_stations_location_fk";--> statement-breakpoint
ALTER TABLE "kitchen_courses" DROP CONSTRAINT "kitchen_courses_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "kitchen_courses" DROP CONSTRAINT "kitchen_courses_location_fk";--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT "ticket_items_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "join_requests" DROP CONSTRAINT "join_requests_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "print_agents" DROP CONSTRAINT "print_agents_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT "printers_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "print_jobs" DROP CONSTRAINT "print_jobs_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "station_printers" DROP CONSTRAINT "station_printers_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "drawer_opens" DROP CONSTRAINT "drawer_opens_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "catalogues" DROP CONSTRAINT "catalogues_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "option_group_items" DROP CONSTRAINT "option_group_items_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "option_group_items" DROP CONSTRAINT "option_group_items_group_fk";--> statement-breakpoint
ALTER TABLE "option_groups" DROP CONSTRAINT "option_groups_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "product_option_groups" DROP CONSTRAINT "product_option_groups_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "product_option_groups" DROP CONSTRAINT "product_option_groups_product_fk";--> statement-breakpoint
ALTER TABLE "product_option_groups" DROP CONSTRAINT "product_option_groups_group_fk";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "location_catalogues" DROP CONSTRAINT "location_catalogues_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP CONSTRAINT "recipe_lines_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" DROP CONSTRAINT "purchase_invoice_vat_invoice_fk";--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "canvases" DROP CONSTRAINT "canvases_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "device_profiles" DROP CONSTRAINT "device_profiles_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "tenant_themes" DROP CONSTRAINT "tenant_themes_tenant_fk";--> statement-breakpoint
ALTER TABLE "tenant_receipts" DROP CONSTRAINT "tenant_receipts_tenant_fk";--> statement-breakpoint
ALTER TABLE "table_service_statuses" DROP CONSTRAINT "table_service_statuses_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "working_order_counters" DROP CONSTRAINT "working_order_counters_node_fk";--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_sale_fk";--> statement-breakpoint
ALTER TABLE "sale_settlements" DROP CONSTRAINT "sale_settlements_sale_fk";--> statement-breakpoint
ALTER TABLE "sale_substitutions" DROP CONSTRAINT "sale_substitutions_substitution_fk";--> statement-breakpoint
ALTER TABLE "sale_substitutions" DROP CONSTRAINT "sale_substitutions_substituted_fk";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_corrects_fk";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_node_fk";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_working_order_fk";--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_sale_fk";--> statement-breakpoint
ALTER TABLE "sale_voids" DROP CONSTRAINT "sale_voids_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "sale_voids" DROP CONSTRAINT "sale_voids_sale_fk";--> statement-breakpoint
ALTER TABLE "daily_close_chain" DROP CONSTRAINT "daily_close_chain_node_fk";--> statement-breakpoint
ALTER TABLE "daily_closes" DROP CONSTRAINT "daily_closes_node_fk";--> statement-breakpoint
ALTER TABLE "incidents" DROP CONSTRAINT "incidents_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_tenant_id_key";--> statement-breakpoint
ALTER TABLE "tills" DROP CONSTRAINT "tills_tenant_id_key";--> statement-breakpoint
ALTER TABLE "nodes" DROP CONSTRAINT "nodes_tenant_id_key";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_tenant_id_key";--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT "working_order_lines_tenant_id_key";--> statement-breakpoint
ALTER TABLE "working_orders" DROP CONSTRAINT "working_orders_tenant_id_key";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT "dining_tables_tenant_id_key";--> statement-breakpoint
ALTER TABLE "floor_zones" DROP CONSTRAINT "floor_zones_tenant_id_key";--> statement-breakpoint
ALTER TABLE "kitchen_stations" DROP CONSTRAINT "kitchen_stations_tenant_id_key";--> statement-breakpoint
ALTER TABLE "kitchen_courses" DROP CONSTRAINT "kitchen_courses_tenant_id_key";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_tenant_id_key";--> statement-breakpoint
ALTER TABLE "join_requests" DROP CONSTRAINT "join_requests_tenant_id_key";--> statement-breakpoint
ALTER TABLE "print_agents" DROP CONSTRAINT "print_agents_tenant_id_key";--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT "printers_tenant_id_key";--> statement-breakpoint
ALTER TABLE "catalogues" DROP CONSTRAINT "catalogues_tenant_id_key";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_tenant_id_key";--> statement-breakpoint
ALTER TABLE "option_group_items" DROP CONSTRAINT "option_group_items_tenant_id_key";--> statement-breakpoint
ALTER TABLE "option_groups" DROP CONSTRAINT "option_groups_tenant_id_key";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_tenant_id_key";--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_tenant_id_key";--> statement-breakpoint
ALTER TABLE "canvases" DROP CONSTRAINT "canvases_tenant_id_key";--> statement-breakpoint
ALTER TABLE "device_profiles" DROP CONSTRAINT "device_profiles_tenant_id_key";--> statement-breakpoint
ALTER TABLE "table_service_statuses" DROP CONSTRAINT "table_service_statuses_tenant_id_key";--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_tenant_id_key";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_tenant_id_key";--> statement-breakpoint
DROP INDEX "locations_tenant_id_idx";--> statement-breakpoint
DROP INDEX "tills_tenant_id_idx";--> statement-breakpoint
DROP INDEX "nodes_tenant_id_idx";--> statement-breakpoint
DROP INDEX "invoice_series_tenant_idx";--> statement-breakpoint
DROP INDEX "catalogues_tenant_id_idx";--> statement-breakpoint
DROP INDEX "categories_tenant_id_idx";--> statement-breakpoint
DROP INDEX "option_groups_tenant_id_idx";--> statement-breakpoint
DROP INDEX "ingredients_tenant_id_idx";--> statement-breakpoint
DROP INDEX "working_orders_tenant_status_idx";--> statement-breakpoint
DROP INDEX "order_amendments_order_idx";--> statement-breakpoint
DROP INDEX "ticket_items_queue_idx";--> statement-breakpoint
DROP INDEX "print_jobs_pull_idx";--> statement-breakpoint
DROP INDEX "purchase_invoice_vat_invoice_idx";--> statement-breakpoint
DROP INDEX "purchase_invoices_tenant_received_idx";--> statement-breakpoint
DROP INDEX "sale_substitutions_substitution_idx";--> statement-breakpoint
DROP INDEX "sales_tenant_issued_idx";--> statement-breakpoint
DROP INDEX "sales_fiscal_state_idx";--> statement-breakpoint
DROP INDEX "sales_corrects_idx";--> statement-breakpoint
ALTER TABLE "station_printers" DROP CONSTRAINT "station_printers_pk";--> statement-breakpoint
ALTER TABLE "station_printers" ADD CONSTRAINT "station_printers_pk" PRIMARY KEY("station_id","printer_id");--> statement-breakpoint
ALTER TABLE "product_option_groups" DROP CONSTRAINT "product_option_groups_pk";--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_pk" PRIMARY KEY("product_id","group_id");--> statement-breakpoint
ALTER TABLE "location_catalogues" DROP CONSTRAINT "location_catalogues_pk";--> statement-breakpoint
ALTER TABLE "location_catalogues" ADD CONSTRAINT "location_catalogues_pk" PRIMARY KEY("location_id","catalogue_id");--> statement-breakpoint
ALTER TABLE "working_order_counters" DROP CONSTRAINT "working_order_counters_pk";--> statement-breakpoint
ALTER TABLE "working_order_counters" ADD CONSTRAINT "working_order_counters_pk" PRIMARY KEY("node_id");--> statement-breakpoint
ALTER TABLE "daily_close_chain" DROP CONSTRAINT "daily_close_chain_pk";--> statement-breakpoint
ALTER TABLE "daily_close_chain" ADD CONSTRAINT "daily_close_chain_pk" PRIMARY KEY("node_id");--> statement-breakpoint
ALTER TABLE "tenant_themes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "tenant_receipts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "tenant_themes" ADD COLUMN "id" integer PRIMARY KEY DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_receipts" ADD COLUMN "id" integer PRIMARY KEY DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_till_fk" FOREIGN KEY ("captured_by_till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_node_fk" FOREIGN KEY ("captured_by_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_status_fk" FOREIGN KEY ("status_id") REFERENCES "public"."table_service_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD CONSTRAINT "option_group_items_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_group_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" ADD CONSTRAINT "purchase_invoice_vat_invoice_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_order_counters" ADD CONSTRAINT "working_order_counters_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_settlements" ADD CONSTRAINT "sale_settlements_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substitution_fk" FOREIGN KEY ("substitution_sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substituted_fk" FOREIGN KEY ("substituted_sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_corrects_fk" FOREIGN KEY ("corrects_sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_working_order_fk" FOREIGN KEY ("working_order_id") REFERENCES "public"."working_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_voids" ADD CONSTRAINT "sale_voids_sale_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_close_chain" ADD CONSTRAINT "daily_close_chain_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_node_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "working_orders_tenant_status_idx" ON "working_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_amendments_order_idx" ON "order_amendments" USING btree ("working_order_id");--> statement-breakpoint
CREATE INDEX "ticket_items_queue_idx" ON "ticket_items" USING btree ("station_id","state");--> statement-breakpoint
CREATE INDEX "print_jobs_pull_idx" ON "print_jobs" USING btree ("printer_id","status");--> statement-breakpoint
CREATE INDEX "purchase_invoice_vat_invoice_idx" ON "purchase_invoice_vat" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_tenant_received_idx" ON "purchase_invoices" USING btree ("received_on");--> statement-breakpoint
CREATE INDEX "sale_substitutions_substitution_idx" ON "sale_substitutions" USING btree ("substitution_sale_id");--> statement-breakpoint
CREATE INDEX "sales_tenant_issued_idx" ON "sales" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "sales_fiscal_state_idx" ON "sales" USING btree ("fiscal_state");--> statement-breakpoint
CREATE INDEX "sales_corrects_idx" ON "sales" USING btree ("corrects_sale_id");--> statement-breakpoint
ALTER TABLE "locations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "tills" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "invoice_series" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "working_orders" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "order_amendments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "dining_tables" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "floor_zones" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "kitchen_stations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "kitchen_courses" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ticket_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "join_requests" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "print_agents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "printers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "print_jobs" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "station_printers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "drawer_opens" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "catalogues" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "option_group_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "option_groups" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "product_option_groups" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "location_catalogues" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ingredients" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "purchase_invoice_vat" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "purchase_invoices" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "canvases" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "device_profiles" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "table_service_statuses" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "working_order_counters" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sale_lines" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sale_settlements" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sale_substitutions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "tenders" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sale_voids" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "daily_close_chain" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "daily_closes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "incidents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_node_code_key" UNIQUE("node_id","code");--> statement-breakpoint
ALTER TABLE "order_amendments" ADD CONSTRAINT "order_amendments_chain_position_key" UNIQUE("working_order_id","sequence_no");--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_location_label_key" UNIQUE("location_id","label");--> statement-breakpoint
ALTER TABLE "floor_zones" ADD CONSTRAINT "floor_zones_name_key" UNIQUE("location_id","name");--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_name_key" UNIQUE("location_id","name");--> statement-breakpoint
ALTER TABLE "kitchen_courses" ADD CONSTRAINT "kitchen_courses_name_key" UNIQUE("location_id","name");--> statement-breakpoint
ALTER TABLE "ticket_items" ADD CONSTRAINT "ticket_items_working_order_line_id_key" UNIQUE("working_order_line_id");--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_tenant_node_key" UNIQUE("node_id");--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_number_key" UNIQUE("supplier_tax_id","supplier_invoice_number");--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_tenant_name_key" UNIQUE("name");--> statement-breakpoint
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_tenant_name_key" UNIQUE("name");--> statement-breakpoint
ALTER TABLE "table_service_statuses" ADD CONSTRAINT "table_service_statuses_tenant_label_key" UNIQUE("label");--> statement-breakpoint
ALTER TABLE "sale_settlements" ADD CONSTRAINT "sale_settlements_sale_key" UNIQUE("sale_id");--> statement-breakpoint
ALTER TABLE "sale_substitutions" ADD CONSTRAINT "sale_substitutions_substituted_key" UNIQUE("substituted_sale_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_series_invoice_number_key" UNIQUE("series_id","invoice_number");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_working_order_id_key" UNIQUE("working_order_id");--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_business_day_key" UNIQUE("node_id","business_day");--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_sequence_key" UNIQUE("node_id","sequence_no");--> statement-breakpoint
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_singleton_ck" CHECK ("tenant_themes"."id" = 1);--> statement-breakpoint
ALTER TABLE "tenant_receipts" ADD CONSTRAINT "tenant_receipts_singleton_ck" CHECK ("tenant_receipts"."id" = 1);
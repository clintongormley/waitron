CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`invoice_locales` text NOT NULL,
	`operation_description` text NOT NULL,
	`fiscal_territory` text DEFAULT 'ES-common' NOT NULL,
	`address_line1` text,
	`address_line2` text,
	`postal_code` text,
	`city` text,
	`province` text,
	`time_zone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`day_cutover` text DEFAULT '06:00:00' NOT NULL,
	`order_flow` text DEFAULT 'prepay' NOT NULL,
	`bump_mode` text DEFAULT 'line' NOT NULL,
	`fire_control` text DEFAULT 'waiter' NOT NULL,
	`receipt_print_mode` text DEFAULT 'auto' NOT NULL,
	`drawer_open_policy` text DEFAULT 'gated' NOT NULL,
	`catalogue_id` text,
	CONSTRAINT "locations_invoice_locales_len" CHECK(json_array_length("locations"."invoice_locales") between 1 and 2),
	CONSTRAINT "locations_order_flow_ck" CHECK("locations"."order_flow" in ('prepay', 'invoice_first', 'ticket_then_pay')),
	CONSTRAINT "locations_bump_mode_ck" CHECK("locations"."bump_mode" in ('line', 'ticket')),
	CONSTRAINT "locations_fire_control_ck" CHECK("locations"."fire_control" in ('waiter', 'kitchen', 'expo')),
	CONSTRAINT "locations_receipt_print_mode_ck" CHECK("locations"."receipt_print_mode" in ('auto', 'on_request', 'never')),
	CONSTRAINT "locations_drawer_open_policy_ck" CHECK("locations"."drawer_open_policy" in ('gated', 'open'))
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`country` text NOT NULL,
	`tax_id` text NOT NULL,
	`legal_name` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "tenants_singleton_ck" CHECK("tenants"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_country_tax_id_key` ON `tenants` (`country`,`tax_id`);--> statement-breakpoint
CREATE TABLE `tills` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`receipt_printer_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`filing_module` text,
	`tax_module` text,
	`public_key` text,
	`endorsement` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoice_series` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`code` text NOT NULL,
	`purpose` text DEFAULT 'standard' NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`retired_at` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_series_purpose_ck" CHECK("invoice_series"."purpose" in ('standard', 'rectificative')),
	CONSTRAINT "invoice_series_next_number_ck" CHECK("invoice_series"."next_number" >= 1),
	CONSTRAINT "invoice_series_code_ck" CHECK("invoice_series"."code" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_series_node_code_key` ON `invoice_series` (`node_id`,`code`);--> statement-breakpoint
CREATE TABLE `working_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`descriptions` text NOT NULL,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`unit_price_gross` integer NOT NULL,
	`vat_rate` integer NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`served_at` text,
	`course_id` text,
	`parent_line_id` text,
	`note` text,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "working_order_lines_unit_precision_ck" CHECK("working_order_lines"."unit_precision" is null or "working_order_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK("working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_vat_rate_ck" CHECK("working_order_lines"."vat_rate" >= 0 and "working_order_lines"."vat_rate" <= 10000),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK("working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX `working_order_lines_order_idx` ON `working_order_lines` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `working_order_lines_line_no_key` ON `working_order_lines` (`working_order_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `working_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text NOT NULL,
	`node_id` text,
	`order_number` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`settled_at` text,
	`delivery_table_id` text,
	`collected_at` text,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_orders_status_ck" CHECK("working_orders"."status" in ('open', 'placed', 'settled', 'abandoned')),
	CONSTRAINT "working_orders_settled_at_ck" CHECK(("working_orders"."status" = 'settled') = ("working_orders"."settled_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `working_orders_tenant_status_idx` ON `working_orders` (`status`);--> statement-breakpoint
CREATE TABLE `order_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text,
	`captured_by_till_id` text NOT NULL,
	`captured_by_node_id` text NOT NULL,
	`event_at` text NOT NULL,
	`event_offset_minutes` integer NOT NULL,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`is_first_entry` integer NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_amendments_sequence_no_ck" CHECK("order_amendments"."sequence_no" > 0),
	CONSTRAINT "order_amendments_kind_ck" CHECK("order_amendments"."kind" in ('order_placed', 'order_cancelled')),
	CONSTRAINT "order_amendments_entry_hash_ck" CHECK(length("order_amendments"."entry_hash") = 64 and "order_amendments"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "order_amendments_event_offset_ck" CHECK("order_amendments"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "order_amendments_event_at_second_ck" CHECK("order_amendments"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "order_amendments_chaining_ck" CHECK(("order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is null)
          or (not "order_amendments"."is_first_entry" and "order_amendments"."prev_entry_hash" is not null))
);
--> statement-breakpoint
CREATE INDEX `order_amendments_order_idx` ON `order_amendments` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_amendments_chain_position_key` ON `order_amendments` (`working_order_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`zone_id` text,
	`capacity` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`tab_id` text,
	`status_id` text,
	`pos_x` integer,
	`pos_y` integer,
	`shape` text,
	`rotation` integer,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `table_service_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dining_tables_shape_ck" CHECK("dining_tables"."shape" in ('round', 'square', 'rect'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_location_label_key` ON `dining_tables` (`location_id`,`label`);--> statement-breakpoint
CREATE TABLE `floor_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_zones_name_key` ON `floor_zones` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `kitchen_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`warm_after_minutes` integer DEFAULT 5 NOT NULL,
	`overdue_after_minutes` integer DEFAULT 10 NOT NULL,
	`forgotten_after_minutes` integer DEFAULT 15 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_stations_name_key` ON `kitchen_stations` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `kitchen_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_courses_name_key` ON `kitchen_courses` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `ticket_items` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`working_order_line_id` text NOT NULL,
	`station_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`queued_at` text NOT NULL,
	`preparing_at` text,
	`ready_at` text,
	`course_id` text,
	`fired_at` text,
	`away_at` text,
	`note` text,
	CONSTRAINT "ticket_items_state_ck" CHECK("ticket_items"."state" in ('queued', 'preparing', 'ready'))
);
--> statement-breakpoint
CREATE INDEX `ticket_items_queue_idx` ON `ticket_items` (`station_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_items_working_order_line_id_key` ON `ticket_items` (`working_order_line_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`station_id` text,
	`till_id` text,
	`device_profile_id` text NOT NULL,
	`receipt_printer_id` text,
	`has_cash_drawer` integer DEFAULT false NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`enrolled_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`verification_number` text NOT NULL,
	`decoy_numbers` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "join_requests_kind_ck" CHECK("join_requests"."kind" in ('device', 'print_agent'))
);
--> statement-breakpoint
CREATE TABLE `print_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text,
	`node_id` text,
	`token_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`enrolled_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_agents_tenant_node_key` ON `print_agents` (`node_id`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`local_key` text,
	`host` text,
	`port` integer DEFAULT 9100,
	`poll_id` text,
	`poll_token_hash` text,
	`ticket_scope` text DEFAULT 'station' NOT NULL,
	`paper_width` text DEFAULT '80mm' NOT NULL,
	`resolution` text DEFAULT '180dpi' NOT NULL,
	`character_set` text DEFAULT 'wpc1252' NOT NULL,
	`character_table` integer DEFAULT 16 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "printers_transport_ck" CHECK("printers"."transport" in ('usb', 'network_tcp', 'bluetooth', 'cloud_poll')),
	CONSTRAINT "printers_ticket_scope_ck" CHECK("printers"."ticket_scope" in ('station', 'order')),
	CONSTRAINT "printers_paper_width_ck" CHECK("printers"."paper_width" in ('58mm', '80mm')),
	CONSTRAINT "printers_resolution_ck" CHECK("printers"."resolution" in ('180dpi', '203dpi')),
	CONSTRAINT "printers_character_set_ck" CHECK("printers"."character_set" in ('wpc1252', 'pc858', 'plain')),
	CONSTRAINT "printers_character_table_ck" CHECK("printers"."character_table" between 0 and 255)
);
--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`printer_id` text NOT NULL,
	`claimed_by` text,
	`payload` blob NOT NULL,
	`kind` text DEFAULT 'document' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`delivered_at` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "print_jobs_kind_ck" CHECK("print_jobs"."kind" in ('document', 'drawer')),
	CONSTRAINT "print_jobs_status_ck" CHECK("print_jobs"."status" in ('queued', 'printing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `print_jobs_pull_idx` ON `print_jobs` (`printer_id`,`status`);--> statement-breakpoint
CREATE TABLE `station_printers` (
	`station_id` text NOT NULL,
	`printer_id` text NOT NULL,
	PRIMARY KEY(`station_id`, `printer_id`)
);
--> statement-breakpoint
CREATE TABLE `drawer_opens` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text NOT NULL,
	`person_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`sale_id` text,
	`authorized_by` text,
	`via_override` integer DEFAULT false NOT NULL,
	CONSTRAINT "drawer_opens_reason_ck" CHECK("drawer_opens"."reason" in ('cash_sale', 'manual'))
);
--> statement-breakpoint
CREATE TABLE `catalogues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`station_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`catalogue_id` text NOT NULL,
	`category_id` text,
	`station_id` text,
	`course_id` text,
	`name` text NOT NULL,
	`customer_name` text,
	`description` text,
	`kitchen_name` text,
	`dietary_declarations` text DEFAULT '[]' NOT NULL,
	`pricing_unit` text NOT NULL,
	`unit_price` integer NOT NULL,
	`vat_class` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sold_alone` integer DEFAULT true NOT NULL,
	`image` text,
	`allergens` text,
	`manual_allergens` text,
	`recipe_derivation` text,
	`diet_derivation` text,
	`diet_override` text,
	`diet` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_pricing_unit_ck" CHECK("products"."pricing_unit" in ('each','weight')),
	CONSTRAINT "products_vat_class_ck" CHECK("products"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
CREATE INDEX `products_catalogue_id_idx` ON `products` (`catalogue_id`);--> statement-breakpoint
CREATE TABLE `location_catalogues` (
	`location_id` text NOT NULL,
	`catalogue_id` text NOT NULL,
	PRIMARY KEY(`location_id`, `catalogue_id`)
);
--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`allergens` text,
	`dietary_origin` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ingredients_dietary_origin_ck" CHECK("ingredients"."dietary_origin" in ('plant', 'meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey', 'other_animal'))
);
--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_lines_product_id_idx` ON `recipe_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `recipe_lines_ingredient_id_idx` ON `recipe_lines` (`ingredient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_lines_product_ingredient_key` ON `recipe_lines` (`product_id`,`ingredient_id`);--> statement-breakpoint
CREATE TABLE `purchase_invoice_vat` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_invoice_id` text NOT NULL,
	`rate` integer NOT NULL,
	`base` integer NOT NULL,
	`tax` integer NOT NULL,
	`kind` text DEFAULT 'ordinary' NOT NULL,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchase_invoice_vat_rate_ck" CHECK("purchase_invoice_vat"."rate" >= 0 and "purchase_invoice_vat"."rate" <= 10000),
	CONSTRAINT "purchase_invoice_vat_kind_ck" CHECK("purchase_invoice_vat"."kind" in ('ordinary', 'capital'))
);
--> statement-breakpoint
CREATE INDEX `purchase_invoice_vat_invoice_idx` ON `purchase_invoice_vat` (`purchase_invoice_id`);--> statement-breakpoint
CREATE TABLE `purchase_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_tax_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_invoice_number` text NOT NULL,
	`issued_on` text NOT NULL,
	`received_on` text NOT NULL,
	`total` integer NOT NULL,
	`regime` text DEFAULT 'general' NOT NULL,
	`deductible_proportion` integer DEFAULT 10000 NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "purchase_invoices_regime_ck" CHECK("purchase_invoices"."regime" in ('general', 'equivalence_surcharge')),
	CONSTRAINT "purchase_invoices_deductible_proportion_ck" CHECK("purchase_invoices"."deductible_proportion" >= 0 and "purchase_invoices"."deductible_proportion" <= 10000)
);
--> statement-breakpoint
CREATE INDEX `purchase_invoices_tenant_received_idx` ON `purchase_invoices` (`received_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_invoices_supplier_number_key` ON `purchase_invoices` (`supplier_tax_id`,`supplier_invoice_number`);--> statement-breakpoint
CREATE TABLE `canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvases_tenant_name_key` ON `canvases` (`name`);--> statement-breakpoint
CREATE TABLE `device_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`form_factor` text NOT NULL,
	`canvas_id` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`inactivity_timeout_seconds` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "device_profiles_form_factor_ck" CHECK("device_profiles"."form_factor" in ('till', 'phone-portrait', 'tablet-landscape', 'kds'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profiles_tenant_name_key` ON `device_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `tenant_themes` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`theme` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tenant_themes_singleton_ck" CHECK("tenant_themes"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `tenant_receipts` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`receipt` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tenant_receipts_singleton_ck" CHECK("tenant_receipts"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `table_service_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `table_service_statuses_tenant_label_key` ON `table_service_statuses` (`label`);--> statement-breakpoint
CREATE TABLE `working_order_counters` (
	`node_id` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`descriptions` text NOT NULL,
	`variant_id` text,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`vat_rate` integer NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`parent_line_id` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_lines_unit_precision_ck" CHECK("sale_lines"."unit_precision" is null or "sale_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "sale_lines_quantity_ck" CHECK("sale_lines"."quantity" <> 0),
	CONSTRAINT "sale_lines_vat_rate_ck" CHECK("sale_lines"."vat_rate" >= 0 and "sale_lines"."vat_rate" <= 10000),
	CONSTRAINT "sale_lines_line_no_ck" CHECK("sale_lines"."line_no" >= 1)
);
--> statement-breakpoint
CREATE INDEX `sale_lines_sale_idx` ON `sale_lines` (`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_lines_line_no_key` ON `sale_lines` (`sale_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `sale_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_settlements_sale_key` ON `sale_settlements` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_substitutions` (
	`id` text PRIMARY KEY NOT NULL,
	`substitution_sale_id` text NOT NULL,
	`substituted_sale_id` text NOT NULL,
	FOREIGN KEY (`substitution_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`substituted_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_substitutions_substitution_idx` ON `sale_substitutions` (`substitution_sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_substitutions_substituted_key` ON `sale_substitutions` (`substituted_sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text NOT NULL,
	`series_id` text NOT NULL,
	`node_id` text NOT NULL,
	`invoice_number` integer NOT NULL,
	`issued_at` text NOT NULL,
	`issued_offset_minutes` integer NOT NULL,
	`total` integer NOT NULL,
	`vat_breakdown` text NOT NULL,
	`locale` text NOT NULL,
	`invoice_locales` text NOT NULL,
	`fiscal_backend` text NOT NULL,
	`fiscal_state` text NOT NULL,
	`corrects_sale_id` text,
	`counterparty_tax_id` text,
	`counterparty_legal_name` text,
	`counterparty_country_code` text,
	`authorized_by` text,
	`operator_id` text,
	`working_order_id` text,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sales_total_ck" CHECK("sales"."total" >= 0 or "sales"."corrects_sale_id" is not null),
	CONSTRAINT "sales_invoice_number_ck" CHECK("sales"."invoice_number" >= 1),
	CONSTRAINT "sales_invoice_locales_ck" CHECK(json_array_length("sales"."invoice_locales") between 1 and 2),
	CONSTRAINT "sales_locale_member_ck" CHECK(instr("sales"."invoice_locales", '"' || "sales"."locale" || '"') > 0),
	CONSTRAINT "sales_issued_offset_ck" CHECK("sales"."issued_offset_minutes" between -840 and 840),
	CONSTRAINT "sales_fiscal_state_ck" CHECK("sales"."fiscal_state" in ('recorded', 'not_applicable'))
);
--> statement-breakpoint
CREATE INDEX `sales_tenant_issued_idx` ON `sales` (`issued_at`);--> statement-breakpoint
CREATE INDEX `sales_fiscal_state_idx` ON `sales` (`fiscal_state`);--> statement-breakpoint
CREATE INDEX `sales_corrects_idx` ON `sales` (`corrects_sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_series_invoice_number_key` ON `sales` (`series_id`,`invoice_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_working_order_id_key` ON `sales` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`cash_tendered` integer,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tenders_amount_ck" CHECK("tenders"."amount" > 0),
	CONSTRAINT "tenders_cash_tendered_ck" CHECK("tenders"."cash_tendered" is null or ("tenders"."method" = 'cash' and "tenders"."cash_tendered" >= "tenders"."amount")),
	CONSTRAINT "tenders_tip_amount_ck" CHECK("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount"),
	CONSTRAINT "tenders_method_ck" CHECK("tenders"."method" in ('cash', 'card', 'voucher', 'transfer', 'other'))
);
--> statement-breakpoint
CREATE INDEX `tenders_sale_idx` ON `tenders` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_voids` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`reason` text NOT NULL,
	`voided_at` text NOT NULL,
	`voided_by` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_voids_sale_id_key` ON `sale_voids` (`sale_id`);--> statement-breakpoint
CREATE TABLE `daily_close_chain` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_hash` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`business_day` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`prev_entry_hash` text NOT NULL,
	`entry_hash` text NOT NULL,
	`closed_at` text NOT NULL,
	`closed_by` text NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closes_business_day_key` ON `daily_closes` (`node_id`,`business_day`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_closes_sequence_key` ON `daily_closes` (`node_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text NOT NULL,
	`sale_id` text,
	`code` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`severity` text NOT NULL,
	`detected_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by` text,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incidents_severity_ck" CHECK("incidents"."severity" in ('warning', 'error')),
	CONSTRAINT "incidents_code_ck" CHECK("incidents"."code" <> '')
);
--> statement-breakpoint
CREATE INDEX `incidents_till_open_idx` ON `incidents` (`till_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `incidents_handled_idx` ON `incidents` (`acknowledged_at`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);

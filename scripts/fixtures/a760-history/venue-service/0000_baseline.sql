CREATE TABLE `department_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "department_hours_weekday_ck" CHECK("department_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_hours_interval_key` ON `department_hours` (`department_id`,`weekday`,`opens_at`,`closes_at`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`trading_name` text NOT NULL,
	`default_service_mode` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "departments_service_mode_ck" CHECK("departments"."default_service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_one_default_per_location_key` ON `departments` (`location_id`) WHERE "departments"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX `departments_location_name_key` ON `departments` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `device_zone_defaults` (
	`device_id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_service_contexts` (
	`working_order_id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`department_id` text NOT NULL,
	`service_mode` text NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_service_contexts_mode_ck" CHECK("order_service_contexts"."service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
CREATE TABLE `preparation_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`zone_id` text,
	`category_id` text,
	`product_id` text,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "preparation_routes_subject_ck" CHECK(("preparation_routes"."category_id" is not null) + ("preparation_routes"."product_id" is not null) = 1),
	CONSTRAINT "preparation_routes_target_ck" CHECK(("preparation_routes"."station_id" is not null) + (nullif("preparation_routes"."no_preparation", false) is not null) = 1)
);
--> statement-breakpoint
CREATE INDEX `preparation_routes_lookup_idx` ON `preparation_routes` (`location_id`,`zone_id`,`product_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_routes_zone_product_key` ON `preparation_routes` (`location_id`,`zone_id`,`product_id`) WHERE "preparation_routes"."zone_id" is not null and "preparation_routes"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_routes_zone_category_key` ON `preparation_routes` (`location_id`,`zone_id`,`category_id`) WHERE "preparation_routes"."zone_id" is not null and "preparation_routes"."category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_routes_venue_product_key` ON `preparation_routes` (`location_id`,`product_id`) WHERE "preparation_routes"."zone_id" is null and "preparation_routes"."product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_routes_venue_category_key` ON `preparation_routes` (`location_id`,`category_id`) WHERE "preparation_routes"."zone_id" is null and "preparation_routes"."category_id" is not null;--> statement-breakpoint
CREATE TABLE `working_line_contexts` (
	`working_order_line_id` text PRIMARY KEY NOT NULL,
	`menu_item_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`menu_name` text NOT NULL,
	`department_id` text NOT NULL,
	`department_name` text NOT NULL,
	`category_name` text NOT NULL,
	`unit_id` text NOT NULL,
	`unit_name` text NOT NULL,
	`unit_precision` integer NOT NULL,
	`hardware_unit` text,
	`vat_class` text NOT NULL,
	`allergens` text,
	`diet` text,
	`diet_derivation` text,
	`diet_override` text,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_line_contexts_unit_precision_ck" CHECK("working_line_contexts"."unit_precision" between 0 and 3),
	CONSTRAINT "working_line_contexts_hardware_unit_ck" CHECK("working_line_contexts"."hardware_unit" is null or "working_line_contexts"."hardware_unit" in ('kg','g','mg')),
	CONSTRAINT "working_line_contexts_vat_class_ck" CHECK("working_line_contexts"."vat_class" in ('general','reduced','super_reduced','zero'))
);
--> statement-breakpoint
CREATE TABLE `zone_menus` (
	`zone_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`zone_id`, `menu_id`),
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `zone_menus_order_idx` ON `zone_menus` (`zone_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `zone_service_policies` (
	`location_id` text NOT NULL,
	`zone_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`service_mode` text,
	`default_menu_id` text,
	`is_counter_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`,`default_menu_id`) REFERENCES `zone_menus`(`zone_id`,`menu_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zone_service_policies_mode_ck" CHECK("zone_service_policies"."service_mode" is null or "zone_service_policies"."service_mode" in ('table_tab','prepay','invoice_first','ticket_then_pay'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_service_policies_one_counter_default_key` ON `zone_service_policies` (`location_id`) WHERE "zone_service_policies"."is_counter_default";
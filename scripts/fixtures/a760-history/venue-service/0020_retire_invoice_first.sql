PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_departments` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`trading_name` text NOT NULL,
	`default_service_mode` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "departments_service_mode_ck" CHECK("__new_departments"."default_service_mode" in ('table_tab','prepay','ticket_then_pay'))
);
--> statement-breakpoint
INSERT INTO `__new_departments`("id", "location_id", "name", "trading_name", "default_service_mode", "is_default", "active", "created_at") SELECT "id", "location_id", "name", "trading_name", "default_service_mode", "is_default", "active", "created_at" FROM `departments`;--> statement-breakpoint
DROP TABLE `departments`;--> statement-breakpoint
ALTER TABLE `__new_departments` RENAME TO `departments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_one_default_per_location_key` ON `departments` (`location_id`) WHERE "departments"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX `departments_location_name_key` ON `departments` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_order_service_contexts` (
	`working_order_id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`department_id` text NOT NULL,
	`service_mode` text NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_service_contexts_mode_ck" CHECK("__new_order_service_contexts"."service_mode" in ('table_tab','prepay','ticket_then_pay'))
);
--> statement-breakpoint
INSERT INTO `__new_order_service_contexts`("working_order_id", "location_id", "zone_id", "department_id", "service_mode") SELECT "working_order_id", "location_id", "zone_id", "department_id", "service_mode" FROM `order_service_contexts`;--> statement-breakpoint
DROP TABLE `order_service_contexts`;--> statement-breakpoint
ALTER TABLE `__new_order_service_contexts` RENAME TO `order_service_contexts`;--> statement-breakpoint
CREATE TABLE `__new_zone_service_policies` (
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
	CONSTRAINT "zone_service_policies_mode_ck" CHECK("__new_zone_service_policies"."service_mode" is null or "__new_zone_service_policies"."service_mode" in ('table_tab','prepay','ticket_then_pay'))
);
--> statement-breakpoint
INSERT INTO `__new_zone_service_policies`("location_id", "zone_id", "department_id", "service_mode", "default_menu_id", "is_counter_default") SELECT "location_id", "zone_id", "department_id", "service_mode", "default_menu_id", "is_counter_default" FROM `zone_service_policies`;--> statement-breakpoint
DROP TABLE `zone_service_policies`;--> statement-breakpoint
ALTER TABLE `__new_zone_service_policies` RENAME TO `zone_service_policies`;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_service_policies_one_counter_default_key` ON `zone_service_policies` (`location_id`) WHERE "zone_service_policies"."is_counter_default";
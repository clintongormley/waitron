PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_departments` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`trading_name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_departments`("id", "location_id", "name", "trading_name", "is_default", "active", "created_at") SELECT "id", "location_id", "name", "trading_name", "is_default", "active", "created_at" FROM `departments`;--> statement-breakpoint
DROP TABLE `departments`;--> statement-breakpoint
ALTER TABLE `__new_departments` RENAME TO `departments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_one_default_per_location_key` ON `departments` (`location_id`) WHERE "departments"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX `departments_location_name_key` ON `departments` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_zone_service_policies` (
	`location_id` text NOT NULL,
	`zone_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`is_counter_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_zone_service_policies`("location_id", "zone_id", "department_id", "is_counter_default") SELECT "location_id", "zone_id", "department_id", "is_counter_default" FROM `zone_service_policies`;--> statement-breakpoint
DROP TABLE `zone_service_policies`;--> statement-breakpoint
ALTER TABLE `__new_zone_service_policies` RENAME TO `zone_service_policies`;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_service_policies_one_counter_default_key` ON `zone_service_policies` (`location_id`) WHERE "zone_service_policies"."is_counter_default";
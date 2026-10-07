DROP TABLE `zone_menus`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_zone_service_policies` (
	`location_id` text NOT NULL,
	`zone_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`service_mode` text,
	`is_counter_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zone_service_policies_mode_ck" CHECK("__new_zone_service_policies"."service_mode" is null or "__new_zone_service_policies"."service_mode" in ('table_tab','prepay','ticket_then_pay'))
);
--> statement-breakpoint
INSERT INTO `__new_zone_service_policies`("location_id", "zone_id", "department_id", "service_mode", "is_counter_default") SELECT "location_id", "zone_id", "department_id", "service_mode", "is_counter_default" FROM `zone_service_policies`;--> statement-breakpoint
DROP TABLE `zone_service_policies`;--> statement-breakpoint
ALTER TABLE `__new_zone_service_policies` RENAME TO `zone_service_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_service_policies_one_counter_default_key` ON `zone_service_policies` (`location_id`) WHERE "zone_service_policies"."is_counter_default";
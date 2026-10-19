DROP TABLE `table_service_statuses`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`zone_id` text NOT NULL,
	`created_at` text NOT NULL,
	`needs_clearing_since` text,
	`plan_table_id` text,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_dining_tables`("id", "location_id", "label", "zone_id", "created_at", "needs_clearing_since", "plan_table_id") SELECT "id", "location_id", "label", "zone_id", "created_at", "needs_clearing_since", "plan_table_id" FROM `dining_tables`;--> statement-breakpoint
DROP TABLE `dining_tables`;--> statement-breakpoint
ALTER TABLE `__new_dining_tables` RENAME TO `dining_tables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_location_label_key` ON `dining_tables` (`location_id`,`label`);
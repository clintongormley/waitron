PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_floor_plan_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`label` text NOT NULL,
	`seats` integer,
	`fixed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_tables_seats_ck" CHECK("__new_floor_plan_tables"."seats" is null or "__new_floor_plan_tables"."seats" between 0 and 999)
);
--> statement-breakpoint
INSERT INTO `__new_floor_plan_tables`("id", "zone_id", "label", "seats", "fixed") SELECT "id", "zone_id", "label", "seats", "fixed" FROM `floor_plan_tables`;--> statement-breakpoint
DROP TABLE `floor_plan_tables`;--> statement-breakpoint
ALTER TABLE `__new_floor_plan_tables` RENAME TO `floor_plan_tables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_tables_zone_label_key` ON `floor_plan_tables` (`zone_id`,`label`);--> statement-breakpoint
CREATE TABLE `__new_floor_plan_table_sizes` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_table_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `floor_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_table_sizes_width_ck" CHECK("__new_floor_plan_table_sizes"."width" is null or "__new_floor_plan_table_sizes"."width" between 1 and 99),
	CONSTRAINT "floor_plan_table_sizes_height_ck" CHECK("__new_floor_plan_table_sizes"."height" is null or "__new_floor_plan_table_sizes"."height" between 1 and 99)
);
--> statement-breakpoint
INSERT INTO `__new_floor_plan_table_sizes`("id", "plan_id", "plan_table_id", "width", "height") SELECT "id", "plan_id", "plan_table_id", "width", "height" FROM `floor_plan_table_sizes`;--> statement-breakpoint
DROP TABLE `floor_plan_table_sizes`;--> statement-breakpoint
ALTER TABLE `__new_floor_plan_table_sizes` RENAME TO `floor_plan_table_sizes`;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_table_sizes_plan_table_key` ON `floor_plan_table_sizes` (`plan_id`,`plan_table_id`);--> statement-breakpoint
CREATE TABLE `__new_floor_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`set_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_id`) REFERENCES `floor_plan_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_floor_plans`("id", "zone_id", "set_id", "revision", "saved_at") SELECT "id", "zone_id", "set_id", "revision", "saved_at" FROM `floor_plans`;--> statement-breakpoint
DROP TABLE `floor_plans`;--> statement-breakpoint
ALTER TABLE `__new_floor_plans` RENAME TO `floor_plans`;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plans_set_zone_key` ON `floor_plans` (`set_id`,`zone_id`);
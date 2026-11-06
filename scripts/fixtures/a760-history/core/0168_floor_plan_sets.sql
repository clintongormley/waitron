CREATE TABLE `floor_plan_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`plan_table_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`shape` text NOT NULL,
	`rotation` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `floor_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_placements_x_ck" CHECK("floor_plan_placements"."x" is null or "floor_plan_placements"."x" between 0 and 999),
	CONSTRAINT "floor_plan_placements_y_ck" CHECK("floor_plan_placements"."y" is null or "floor_plan_placements"."y" between 0 and 999),
	CONSTRAINT "floor_plan_placements_width_ck" CHECK("floor_plan_placements"."width" is null or "floor_plan_placements"."width" between 1 and 99),
	CONSTRAINT "floor_plan_placements_height_ck" CHECK("floor_plan_placements"."height" is null or "floor_plan_placements"."height" between 1 and 99),
	CONSTRAINT "floor_plan_placements_rotation_ck" CHECK("floor_plan_placements"."rotation" is null or ("floor_plan_placements"."rotation" between 0 and 345 and "floor_plan_placements"."rotation" % 15 = 0)),
	CONSTRAINT "floor_plan_placements_shape_ck" CHECK("floor_plan_placements"."shape" in ('rect', 'round')),
	CONSTRAINT "floor_plan_placements_placement_ck" CHECK(("floor_plan_placements"."x" is null and "floor_plan_placements"."y" is null and "floor_plan_placements"."width" is null and "floor_plan_placements"."height" is null and "floor_plan_placements"."shape" is null and "floor_plan_placements"."rotation" is null) or ("floor_plan_placements"."x" is not null and "floor_plan_placements"."y" is not null and "floor_plan_placements"."width" is not null and "floor_plan_placements"."height" is not null and "floor_plan_placements"."shape" is not null and "floor_plan_placements"."rotation" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_placements_table_key` ON `floor_plan_placements` (`plan_id`,`plan_table_id`);--> statement-breakpoint
CREATE TABLE `floor_plan_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `floor_plan_table_sizes_table_key`;--> statement-breakpoint
ALTER TABLE `floor_plan_table_sizes` ADD `plan_id` text REFERENCES floor_plans(id);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_table_sizes_plan_table_key` ON `floor_plan_table_sizes` (`plan_id`,`plan_table_id`);--> statement-breakpoint
DROP INDEX `floor_plans_zone_key`;--> statement-breakpoint
ALTER TABLE `floor_plans` ADD `set_id` text REFERENCES floor_plan_sets(id);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plans_set_zone_key` ON `floor_plans` (`set_id`,`zone_id`);--> statement-breakpoint
ALTER TABLE `floor_plan_tables` ADD `zone_id` text REFERENCES floor_zones(id);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_tables_zone_label_key` ON `floor_plan_tables` (`zone_id`,`label`);--> statement-breakpoint
ALTER TABLE `floor_reset_tables` ADD `ready_to_move` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `floor_today_zones` ADD `set_id` text REFERENCES floor_plan_sets(id);--> statement-breakpoint
ALTER TABLE `floor_today_zones` ADD `layout_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `floor_today_zones` ADD `occurrence` text;
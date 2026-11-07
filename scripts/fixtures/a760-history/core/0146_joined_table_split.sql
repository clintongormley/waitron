CREATE TABLE `floor_plan_table_sizes` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_table_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	FOREIGN KEY (`plan_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_table_sizes_width_ck" CHECK("floor_plan_table_sizes"."width" is null or "floor_plan_table_sizes"."width" between 1 and 99),
	CONSTRAINT "floor_plan_table_sizes_height_ck" CHECK("floor_plan_table_sizes"."height" is null or "floor_plan_table_sizes"."height" between 1 and 99)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_table_sizes_table_key` ON `floor_plan_table_sizes` (`plan_table_id`);--> statement-breakpoint
CREATE TABLE `floor_today_split_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`joined_table_id` text NOT NULL,
	`part_table_id` text NOT NULL,
	FOREIGN KEY (`joined_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_today_split_parts_not_self_ck" CHECK("floor_today_split_parts"."joined_table_id" <> "floor_today_split_parts"."part_table_id")
);
--> statement-breakpoint
CREATE INDEX `floor_today_split_parts_joined_idx` ON `floor_today_split_parts` (`joined_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_today_split_parts_part_key` ON `floor_today_split_parts` (`part_table_id`);
CREATE TABLE `floor_plan_table_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`joined_table_id` text NOT NULL,
	`part_table_id` text NOT NULL,
	FOREIGN KEY (`joined_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_table_id`) REFERENCES `floor_plan_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_plan_table_parts_not_self_ck" CHECK("floor_plan_table_parts"."joined_table_id" <> "floor_plan_table_parts"."part_table_id")
);
--> statement-breakpoint
CREATE INDEX `floor_plan_table_parts_joined_idx` ON `floor_plan_table_parts` (`joined_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_plan_table_parts_part_key` ON `floor_plan_table_parts` (`part_table_id`);--> statement-breakpoint
CREATE TABLE `floor_reset_table_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`joined_reset_table_id` text NOT NULL,
	`part_reset_table_id` text NOT NULL,
	FOREIGN KEY (`joined_reset_table_id`) REFERENCES `floor_reset_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_reset_table_id`) REFERENCES `floor_reset_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_reset_table_parts_not_self_ck" CHECK("floor_reset_table_parts"."joined_reset_table_id" <> "floor_reset_table_parts"."part_reset_table_id")
);
--> statement-breakpoint
CREATE INDEX `floor_reset_table_parts_joined_idx` ON `floor_reset_table_parts` (`joined_reset_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_reset_table_parts_part_key` ON `floor_reset_table_parts` (`part_reset_table_id`);
ALTER TABLE `dining_tables` ADD `short_name` text;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD `short_name_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_location_short_name_key_uq` ON `dining_tables` (`location_id`,`short_name_key`);--> statement-breakpoint
ALTER TABLE `floor_plan_tables` ADD `short_name` text;--> statement-breakpoint
ALTER TABLE `floor_reset_tables` ADD `short_name` text;
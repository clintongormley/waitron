CREATE TABLE `floor_reset_join_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`join_id` text NOT NULL,
	`reset_table_id` text NOT NULL,
	FOREIGN KEY (`join_id`) REFERENCES `floor_reset_joins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reset_table_id`) REFERENCES `floor_reset_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `floor_reset_join_tables_table_idx` ON `floor_reset_join_tables` (`reset_table_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `floor_reset_join_tables_join_table_key` ON `floor_reset_join_tables` (`join_id`,`reset_table_id`);--> statement-breakpoint
CREATE TABLE `floor_reset_joins` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`seats` integer NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "floor_reset_joins_seats_ck" CHECK("floor_reset_joins"."seats" >= 1)
);
--> statement-breakpoint
CREATE INDEX `floor_reset_joins_zone_idx` ON `floor_reset_joins` (`zone_id`);
CREATE TABLE `order_group_hold_stations` (
	`group_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `station_id`),
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `ticket_grouping` text DEFAULT 'combined' NOT NULL;--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `print_held_work` integer DEFAULT false NOT NULL;
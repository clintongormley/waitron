CREATE TABLE `device_made_here_stations` (
	`device_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `station_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `shows_rest_of_order` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `made_here` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `ticket_items_order_idx` ON `ticket_items` (`working_order_id`);
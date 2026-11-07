CREATE TABLE `ticket_item_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_line_id` text NOT NULL,
	`from_station_id` text NOT NULL,
	`to_station_id` text NOT NULL,
	`moved_at` text NOT NULL,
	`moved_by_device_id` text NOT NULL,
	`moved_by_person_id` text,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moved_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ticket_item_moves_line_idx` ON `ticket_item_moves` (`working_order_line_id`);
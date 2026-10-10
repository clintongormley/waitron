PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ticket_item_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_line_id` text NOT NULL,
	`from_station_id` text NOT NULL,
	`to_station_id` text NOT NULL,
	`moved_at` text NOT NULL,
	`moved_by_device_id` text,
	`moved_by_person_id` text,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moved_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_item_moves_actor_ck" CHECK("__new_ticket_item_moves"."moved_by_device_id" is not null or "__new_ticket_item_moves"."moved_by_person_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_ticket_item_moves`("id", "working_order_line_id", "from_station_id", "to_station_id", "moved_at", "moved_by_device_id", "moved_by_person_id") SELECT "id", "working_order_line_id", "from_station_id", "to_station_id", "moved_at", "moved_by_device_id", "moved_by_person_id" FROM `ticket_item_moves`;--> statement-breakpoint
DROP TABLE `ticket_item_moves`;--> statement-breakpoint
ALTER TABLE `__new_ticket_item_moves` RENAME TO `ticket_item_moves`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ticket_item_moves_line_idx` ON `ticket_item_moves` (`working_order_line_id`);--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `station_retained_at_release` integer DEFAULT false NOT NULL;
CREATE TABLE `watcher_printers` (
	`printer_id` text PRIMARY KEY NOT NULL,
	`watcher_id` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `watcher_stations` (
	`watcher_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`watcher_id`, `station_id`),
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `watcher_zones` (
	`watcher_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`watcher_id`, `zone_id`),
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `watchers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`every_station` integer DEFAULT false NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	`runs_pass` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchers_name_key` ON `watchers` (`location_id`,`name`) WHERE "watchers"."active";--> statement-breakpoint
CREATE TABLE `watcher_item_marks` (
	`watcher_id` text NOT NULL,
	`ticket_item_id` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by_person_id` text,
	`done_by_device_id` text,
	PRIMARY KEY(`watcher_id`, `ticket_item_id`),
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_item_id`) REFERENCES `ticket_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "watcher_item_marks_done_by_ck" CHECK(("watcher_item_marks"."done_by_person_id" is null) <> ("watcher_item_marks"."done_by_device_id" is null))
);
--> statement-breakpoint
CREATE INDEX `watcher_item_marks_item_idx` ON `watcher_item_marks` (`ticket_item_id`);--> statement-breakpoint
ALTER TABLE `devices` ADD `watcher_id` text REFERENCES watchers(id);
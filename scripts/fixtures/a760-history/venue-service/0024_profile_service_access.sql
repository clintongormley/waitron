CREATE TABLE `device_profile_service_access` (
	`device_profile_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	`starting_zone_id` text NOT NULL,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`starting_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_profile_stations` (
	`device_profile_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `station_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_profile_watchers` (
	`device_profile_id` text NOT NULL,
	`watcher_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `watcher_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`watcher_id`) REFERENCES `watchers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_profile_zones` (
	`device_profile_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `zone_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profile_service_access`(`device_profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `device_zone_selection_zones` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `device_profile_id`, `zone_id`),
	FOREIGN KEY (`device_id`,`device_profile_id`) REFERENCES `device_zone_selections`(`device_id`,`device_profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_zone_selections` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	`starting_zone_id` text,
	PRIMARY KEY(`device_id`, `device_profile_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`starting_zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action
);

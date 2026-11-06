CREATE TABLE `device_kitchen_screen_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text,
	`zone_id` text,
	`removed_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_removals_screen_ck" CHECK("device_kitchen_screen_removals"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screen_removals_one_target_ck" CHECK("device_kitchen_screen_removals"."station_id" is null or "device_kitchen_screen_removals"."zone_id" is null)
);
--> statement-breakpoint
CREATE INDEX `device_kitchen_screen_removals_device_idx` ON `device_kitchen_screen_removals` (`device_id`);--> statement-breakpoint
CREATE TABLE `device_kitchen_screen_stations` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `screen`, `station_id`),
	FOREIGN KEY (`device_id`,`screen`) REFERENCES `device_kitchen_screens`(`device_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_stations_screen_ck" CHECK("device_kitchen_screen_stations"."screen" in ('station', 'pass', 'pass_monitor'))
);
--> statement-breakpoint
CREATE TABLE `device_kitchen_screen_zones` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `screen`, `zone_id`),
	FOREIGN KEY (`device_id`,`screen`) REFERENCES `device_kitchen_screens`(`device_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screen_zones_screen_ck" CHECK("device_kitchen_screen_zones"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screen_zones_not_station_ck" CHECK("device_kitchen_screen_zones"."screen" <> 'station')
);
--> statement-breakpoint
CREATE TABLE `device_kitchen_screens` (
	`device_id` text NOT NULL,
	`screen` text NOT NULL,
	`every_station` integer DEFAULT false NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`device_id`, `screen`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_kitchen_screens_screen_ck" CHECK("device_kitchen_screens"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_kitchen_screens_station_zones_ck" CHECK("device_kitchen_screens"."screen" <> 'station' or "device_kitchen_screens"."every_zone" = 0)
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screen_stations` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`, `station_id`),
	FOREIGN KEY (`device_profile_id`,`screen`) REFERENCES `device_profile_kitchen_screens`(`device_profile_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_profile_kitchen_screen_stations_screen_ck" CHECK("device_profile_kitchen_screen_stations"."screen" in ('station', 'pass', 'pass_monitor'))
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screen_zones` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`zone_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`, `zone_id`),
	FOREIGN KEY (`device_profile_id`,`screen`) REFERENCES `device_profile_kitchen_screens`(`device_profile_id`,`screen`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "device_profile_kitchen_screen_zones_screen_ck" CHECK("device_profile_kitchen_screen_zones"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_profile_kitchen_screen_zones_not_station_ck" CHECK("device_profile_kitchen_screen_zones"."screen" <> 'station')
);
--> statement-breakpoint
CREATE TABLE `device_profile_kitchen_screens` (
	`device_profile_id` text NOT NULL,
	`screen` text NOT NULL,
	`every_station` integer DEFAULT false NOT NULL,
	`every_zone` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`device_profile_id`, `screen`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_profile_kitchen_screens_screen_ck" CHECK("device_profile_kitchen_screens"."screen" in ('station', 'pass', 'pass_monitor')),
	CONSTRAINT "device_profile_kitchen_screens_station_zones_ck" CHECK("device_profile_kitchen_screens"."screen" <> 'station' or "device_profile_kitchen_screens"."every_zone" = 0)
);

CREATE TABLE `station_day_states` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`business_day` text NOT NULL,
	`open` integer NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `station_day_states_day_key` ON `station_day_states` (`station_id`,`business_day`);--> statement-breakpoint
CREATE TABLE `station_fallbacks` (
	`station_id` text PRIMARY KEY NOT NULL,
	`fallback_station_id` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fallback_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "station_fallbacks_not_self_ck" CHECK("station_fallbacks"."station_id" <> "station_fallbacks"."fallback_station_id")
);
--> statement-breakpoint
CREATE TABLE `station_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "station_hours_weekday_ck" CHECK("station_hours"."weekday" between 0 and 6),
	CONSTRAINT "station_hours_distinct_ck" CHECK("station_hours"."opens_at" <> "station_hours"."closes_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `station_hours_interval_key` ON `station_hours` (`station_id`,`weekday`,`opens_at`,`closes_at`);
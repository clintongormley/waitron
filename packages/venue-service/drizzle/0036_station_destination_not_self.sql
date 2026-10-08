PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_station_day_states` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`business_day` text NOT NULL,
	`open` integer NOT NULL,
	`sends_to_station_id` text,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sends_to_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "station_day_states_sends_to_not_self_ck" CHECK("__new_station_day_states"."sends_to_station_id" <> "__new_station_day_states"."station_id")
);
--> statement-breakpoint
INSERT INTO `__new_station_day_states`("id", "station_id", "business_day", "open", "sends_to_station_id") SELECT "id", "station_id", "business_day", "open", "sends_to_station_id" FROM `station_day_states`;--> statement-breakpoint
DROP TABLE `station_day_states`;--> statement-breakpoint
ALTER TABLE `__new_station_day_states` RENAME TO `station_day_states`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `station_day_states_day_key` ON `station_day_states` (`station_id`,`business_day`);
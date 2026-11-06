DROP TABLE `local_holidays`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_special_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'working_day' NOT NULL,
	`repeat_on` text,
	`own_hours` integer DEFAULT false NOT NULL,
	`close_whole_venue` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "special_dates_date_ck" CHECK("__new_special_dates"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "special_dates_name_ck" CHECK(trim("__new_special_dates"."name") <> ''),
	CONSTRAINT "special_dates_kind_ck" CHECK("__new_special_dates"."kind" in ('holiday', 'working_day')),
	CONSTRAINT "special_dates_repeat_ck" CHECK("__new_special_dates"."repeat_on" is null or "__new_special_dates"."repeat_on" = substr("__new_special_dates"."date", 6, 5))
);
--> statement-breakpoint
INSERT INTO `__new_special_dates`("id", "location_id", "date", "name", "kind", "repeat_on", "own_hours", "close_whole_venue") SELECT "id", "location_id", "date", "name", "kind", "repeat_on", "own_hours", "close_whole_venue" FROM `special_dates`;--> statement-breakpoint
DROP TABLE `special_dates`;--> statement-breakpoint
ALTER TABLE `__new_special_dates` RENAME TO `special_dates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `special_dates_location_date_key` ON `special_dates` (`location_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `special_dates_location_repeat_key` ON `special_dates` (`location_id`,`repeat_on`) WHERE "special_dates"."repeat_on" is not null;
CREATE TABLE `location_business_day_settings` (
	`location_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "location_business_day_settings_revision_ck" CHECK(typeof("location_business_day_settings"."revision") = 'integer' and "location_business_day_settings"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `location_day_cutover_changes` (
	`location_id` text NOT NULL,
	`effective_business_day` text NOT NULL,
	`day_cutover` text NOT NULL,
	PRIMARY KEY(`location_id`, `effective_business_day`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "location_day_cutover_changes_date_ck" CHECK(length("location_day_cutover_changes"."effective_business_day") = 10 and "location_day_cutover_changes"."effective_business_day" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "location_day_cutover_changes_time_ck" CHECK(length("location_day_cutover_changes"."day_cutover") = 8 and "location_day_cutover_changes"."day_cutover" glob '[0-2][0-9]:[0-5][0-9]:00' and substr("location_day_cutover_changes"."day_cutover", 1, 2) <= '23')
);

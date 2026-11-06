CREATE TABLE `holiday_geographies` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`country` text NOT NULL,
	`province_code` text NOT NULL,
	`city` text NOT NULL,
	`city_key` text NOT NULL,
	`area_key` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holiday_geographies_city_ck" CHECK(trim("holiday_geographies"."city") <> '' and "holiday_geographies"."city_key" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_geographies_location_place_key` ON `holiday_geographies` (`location_id`,`country`,`province_code`,`city_key`);--> statement-breakpoint
CREATE TABLE `local_holidays` (
	`id` text PRIMARY KEY NOT NULL,
	`geography_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`geography_id`) REFERENCES `holiday_geographies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "local_holidays_date_ck" CHECK("local_holidays"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "local_holidays_name_ck" CHECK(trim("local_holidays"."name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_holidays_geography_date_key` ON `local_holidays` (`geography_id`,`date`);
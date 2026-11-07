CREATE TABLE `department_day_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`department_id` text NOT NULL,
	`period_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`,`department_id`) REFERENCES `department_days`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_day_ranges_step_ck" CHECK(substr("department_day_ranges"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("department_day_ranges"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `department_day_ranges_day_idx` ON `department_day_ranges` (`day_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `department_days` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "department_days_one_day_ck" CHECK(("department_days"."season_id" is null) <> ("department_days"."special_day_date_id" is null) and ("department_days"."season_id" is null) = ("department_days"."weekday" is null)),
	CONSTRAINT "department_days_weekday_ck" CHECK("department_days"."weekday" is null or "department_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_season_key` ON `department_days` (`department_id`,`season_id`,`weekday`) WHERE "department_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_date_key` ON `department_days` (`department_id`,`special_day_date_id`) WHERE "department_days"."special_day_date_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `department_days_department_key` ON `department_days` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "seasons_name_ck" CHECK(trim("seasons"."name") <> ''),
	CONSTRAINT "seasons_starts_on_ck" CHECK("seasons"."starts_on" glob '[01][0-9]-[0-3][0-9]' and "seasons"."starts_on" <> '02-29')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_location_starts_key` ON `seasons` (`location_id`,`starts_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_location_name_key` ON `seasons` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE `special_day_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`special_day_id` text NOT NULL,
	`location_id` text NOT NULL,
	`date` text NOT NULL,
	`closed_all_day` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`special_day_id`) REFERENCES `special_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "special_day_dates_date_ck" CHECK("special_day_dates"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `special_day_dates_location_date_key` ON `special_day_dates` (`location_id`,`date`);--> statement-breakpoint
CREATE TABLE `special_days` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`repeats_yearly` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "special_days_name_ck" CHECK(trim("special_days"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE `zone_day_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`kind` text DEFAULT 'closed' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `zone_days`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_day_ranges_kind_ck" CHECK("zone_day_ranges"."kind" in ('closed', 'open')),
	CONSTRAINT "zone_day_ranges_step_ck" CHECK(substr("zone_day_ranges"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("zone_day_ranges"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `zone_day_ranges_day_idx` ON `zone_day_ranges` (`day_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `zone_days` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_days_one_day_ck" CHECK(("zone_days"."season_id" is null) <> ("zone_days"."special_day_date_id" is null) and ("zone_days"."season_id" is null) = ("zone_days"."weekday" is null)),
	CONSTRAINT "zone_days_weekday_ck" CHECK("zone_days"."weekday" is null or "zone_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_days_season_key` ON `zone_days` (`zone_id`,`season_id`,`weekday`) WHERE "zone_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `zone_days_date_key` ON `zone_days` (`zone_id`,`special_day_date_id`) WHERE "zone_days"."special_day_date_id" is not null;
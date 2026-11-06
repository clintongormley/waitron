CREATE TABLE `hours_week_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`station_id` text,
	`weekday` integer NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hours_week_cells_weekday_ck" CHECK("hours_week_cells"."weekday" between 0 and 6),
	CONSTRAINT "hours_week_cells_one_owner_ck" CHECK(("hours_week_cells"."department_id" is null) <> ("hours_week_cells"."station_id" is null)),
	CONSTRAINT "hours_week_cells_mode_ck" CHECK("hours_week_cells"."mode" in ('closed', 'all_day', 'periods'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hours_week_cells_department_day_key` ON `hours_week_cells` (`department_id`,`weekday`) WHERE "hours_week_cells"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `hours_week_cells_station_day_key` ON `hours_week_cells` (`station_id`,`weekday`) WHERE "hours_week_cells"."station_id" is not null;--> statement-breakpoint
CREATE TABLE `hours_week_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`position` integer NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `hours_week_cells`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "hours_week_periods_distinct_ck" CHECK("hours_week_periods"."opens_at" <> "hours_week_periods"."closes_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hours_week_periods_position_key` ON `hours_week_periods` (`cell_id`,`position`);--> statement-breakpoint
CREATE TABLE `special_date_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`special_date_id` text NOT NULL,
	`department_id` text,
	`station_id` text,
	`mode` text NOT NULL,
	FOREIGN KEY (`special_date_id`) REFERENCES `special_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "special_date_hours_one_owner_ck" CHECK(("special_date_hours"."department_id" is null) <> ("special_date_hours"."station_id" is null)),
	CONSTRAINT "special_date_hours_mode_ck" CHECK("special_date_hours"."mode" in ('closed', 'all_day', 'periods'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `special_date_hours_department_key` ON `special_date_hours` (`special_date_id`,`department_id`) WHERE "special_date_hours"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `special_date_hours_station_key` ON `special_date_hours` (`special_date_id`,`station_id`) WHERE "special_date_hours"."station_id" is not null;--> statement-breakpoint
CREATE TABLE `special_date_hours_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`position` integer NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `special_date_hours`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "special_date_hours_periods_distinct_ck" CHECK("special_date_hours_periods"."opens_at" <> "special_date_hours_periods"."closes_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `special_date_hours_periods_position_key` ON `special_date_hours_periods` (`cell_id`,`position`);--> statement-breakpoint
CREATE TABLE `special_dates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`colour` text NOT NULL,
	`close_whole_venue` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "special_dates_date_ck" CHECK("special_dates"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "special_dates_name_ck" CHECK(trim("special_dates"."name") <> ''),
	CONSTRAINT "special_dates_colour_ck" CHECK("special_dates"."colour" in ('red', 'amber', 'grey', 'blue', 'green', 'purple'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `special_dates_location_date_key` ON `special_dates` (`location_id`,`date`);
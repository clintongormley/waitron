CREATE TABLE `menu_day_timetables` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`weekday` integer,
	`special_date_id` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`special_date_id`) REFERENCES `special_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_day_timetables_one_day_ck" CHECK(("menu_day_timetables"."weekday" is null) <> ("menu_day_timetables"."special_date_id" is null)),
	CONSTRAINT "menu_day_timetables_weekday_ck" CHECK("menu_day_timetables"."weekday" is null or "menu_day_timetables"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_day_timetables_week_key` ON `menu_day_timetables` (`department_id`,`weekday`) WHERE "menu_day_timetables"."weekday" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_day_timetables_date_key` ON `menu_day_timetables` (`special_date_id`,`department_id`) WHERE "menu_day_timetables"."special_date_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_day_timetables_department_key` ON `menu_day_timetables` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `menu_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`,`menu_id`) REFERENCES `department_menus`(`department_id`,`menu_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_periods_name_ck" CHECK(trim("menu_periods"."name") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_name_key` ON `menu_periods` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_key` ON `menu_periods` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `menu_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`timetable_id` text NOT NULL,
	`department_id` text NOT NULL,
	`period_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`timetable_id`,`department_id`) REFERENCES `menu_day_timetables`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_slots_distinct_ck" CHECK("menu_slots"."starts_at" <> "menu_slots"."ends_at")
);
--> statement-breakpoint
CREATE INDEX `menu_slots_timetable_idx` ON `menu_slots` (`timetable_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `zone_period_menus` (
	`zone_id` text NOT NULL,
	`period_id` text NOT NULL,
	`department_id` text NOT NULL,
	`menu_id` text NOT NULL,
	PRIMARY KEY(`zone_id`, `period_id`),
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`,`menu_id`) REFERENCES `department_menus`(`department_id`,`menu_id`) ON UPDATE no action ON DELETE no action
);

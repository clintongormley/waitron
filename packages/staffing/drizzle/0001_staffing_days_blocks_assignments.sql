CREATE TABLE `shift_assignments` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`station_id` text,
	`staff_role_id` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shift_assignments_one_area_ck" CHECK(("shift_assignments"."department_id" is null) <> ("shift_assignments"."station_id" is null))
);
--> statement-breakpoint
CREATE TABLE `staffing_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	`headcount` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `staffing_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staffing_blocks_headcount_ck" CHECK("staffing_blocks"."headcount" between 1 and 50),
	CONSTRAINT "staffing_blocks_step_ck" CHECK(substr("staffing_blocks"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("staffing_blocks"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `staffing_blocks_day_idx` ON `staffing_blocks` (`day_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `staffing_days` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`station_id` text,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staffing_days_one_area_ck" CHECK(("staffing_days"."department_id" is null) <> ("staffing_days"."station_id" is null)),
	CONSTRAINT "staffing_days_one_day_ck" CHECK(("staffing_days"."season_id" is null) <> ("staffing_days"."special_day_date_id" is null) and ("staffing_days"."season_id" is null) = ("staffing_days"."weekday" is null)),
	CONSTRAINT "staffing_days_weekday_ck" CHECK("staffing_days"."weekday" is null or "staffing_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_department_season_key` ON `staffing_days` (`department_id`,`season_id`,`weekday`) WHERE "staffing_days"."department_id" is not null and "staffing_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_department_date_key` ON `staffing_days` (`department_id`,`special_day_date_id`) WHERE "staffing_days"."department_id" is not null and "staffing_days"."special_day_date_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_station_season_key` ON `staffing_days` (`station_id`,`season_id`,`weekday`) WHERE "staffing_days"."station_id" is not null and "staffing_days"."season_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_station_date_key` ON `staffing_days` (`station_id`,`special_day_date_id`) WHERE "staffing_days"."station_id" is not null and "staffing_days"."special_day_date_id" is not null;
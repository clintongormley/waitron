DROP TABLE `department_all_day_menus`;--> statement-breakpoint
DROP TABLE `department_menus`;--> statement-breakpoint
DROP TABLE `zone_all_day_menus`;--> statement-breakpoint
DROP TABLE `zone_period_menus`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_menu_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_periods_name_ck" CHECK(trim("__new_menu_periods"."name") <> ''),
	CONSTRAINT "menu_periods_colour_ck" CHECK("__new_menu_periods"."colour" in ('red', 'amber', 'grey', 'blue', 'green', 'purple'))
);
--> statement-breakpoint
INSERT INTO `__new_menu_periods`("id", "department_id", "name", "colour", "menu_id") SELECT "id", "department_id", "name", "colour", "menu_id" FROM `menu_periods`;--> statement-breakpoint
DROP TABLE `menu_periods`;--> statement-breakpoint
ALTER TABLE `__new_menu_periods` RENAME TO `menu_periods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_name_key` ON `menu_periods` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_key` ON `menu_periods` (`id`,`department_id`);--> statement-breakpoint
CREATE TABLE `__new_menu_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`timetable_id` text NOT NULL,
	`department_id` text NOT NULL,
	`period_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`timetable_id`,`department_id`) REFERENCES `menu_day_timetables`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_slots_step_ck" CHECK(substr("__new_menu_slots"."starts_at", 4, 2) in ('00', '15', '30', '45')
      and substr("__new_menu_slots"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
INSERT INTO `__new_menu_slots`("id", "timetable_id", "department_id", "period_id", "starts_at", "ends_at") SELECT "id", "timetable_id", "department_id", "period_id", "starts_at", "ends_at" FROM `menu_slots`;--> statement-breakpoint
DROP TABLE `menu_slots`;--> statement-breakpoint
ALTER TABLE `__new_menu_slots` RENAME TO `menu_slots`;--> statement-breakpoint
CREATE INDEX `menu_slots_timetable_idx` ON `menu_slots` (`timetable_id`,`starts_at`);
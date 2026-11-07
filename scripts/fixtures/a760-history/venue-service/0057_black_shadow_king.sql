PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_menu_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`menu_id` text NOT NULL,
	`end_offset_minutes` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_periods_name_ck" CHECK(trim("__new_menu_periods"."name") <> ''),
	CONSTRAINT "menu_periods_colour_ck" CHECK("__new_menu_periods"."colour" in ('red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'grey'))
);
--> statement-breakpoint
INSERT INTO `__new_menu_periods`("id", "department_id", "name", "colour", "menu_id", "end_offset_minutes") SELECT "id", "department_id", "name", "colour", "menu_id", "end_offset_minutes" FROM `menu_periods`;--> statement-breakpoint
DROP TABLE `menu_periods`;--> statement-breakpoint
ALTER TABLE `__new_menu_periods` RENAME TO `menu_periods`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_name_key` ON `menu_periods` (`department_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_periods_department_key` ON `menu_periods` (`id`,`department_id`);
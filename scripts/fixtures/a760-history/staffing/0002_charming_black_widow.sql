PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_roles_name_ck" CHECK(trim("__new_staff_roles"."name") <> ''),
	CONSTRAINT "staff_roles_colour_ck" CHECK("__new_staff_roles"."colour" in ('red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'grey'))
);
--> statement-breakpoint
INSERT INTO `__new_staff_roles`("id", "location_id", "name", "colour", "position") SELECT "id", "location_id", "name", "colour", "position" FROM `staff_roles`;--> statement-breakpoint
DROP TABLE `staff_roles`;--> statement-breakpoint
ALTER TABLE `__new_staff_roles` RENAME TO `staff_roles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `staff_roles_location_name_key` ON `staff_roles` (`location_id`,`name`);
CREATE TABLE `person_staff_roles` (
	`person_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	PRIMARY KEY(`person_id`, `staff_role_id`),
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_roles_name_ck" CHECK(trim("staff_roles"."name") <> ''),
	CONSTRAINT "staff_roles_colour_ck" CHECK("staff_roles"."colour" in ('red', 'amber', 'grey', 'blue', 'green', 'purple'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_roles_location_name_key` ON `staff_roles` (`location_id`,`name`);
CREATE TABLE `device_profile_admission_persons` (
	`device_profile_id` text NOT NULL,
	`person_id` text NOT NULL,
	`admitted` integer NOT NULL,
	PRIMARY KEY(`device_profile_id`, `person_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_profile_admission_roles` (
	`device_profile_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `role`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_profile_admission_roles_role_ck" CHECK("device_profile_admission_roles"."role" in ('staff', 'supervisor', 'manager', 'admin'))
);

CREATE TABLE `device_approved_profiles` (
	`device_id` text NOT NULL,
	`device_profile_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `device_profile_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `device_profile_home_layouts` (
	`device_profile_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`layout_id` text NOT NULL,
	PRIMARY KEY(`device_profile_id`, `menu_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);

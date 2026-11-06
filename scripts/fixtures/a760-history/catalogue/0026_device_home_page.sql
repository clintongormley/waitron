DROP TABLE `device_profile_home_layouts`;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `handheld_columns` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `handheld_tiles` text DEFAULT 'colours' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `handheld_order` text DEFAULT 'home_first' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `till_columns` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `till_tiles` text DEFAULT 'colours' NOT NULL;--> statement-breakpoint
ALTER TABLE `menu_details` ADD `till_order` text DEFAULT 'home_first' NOT NULL;
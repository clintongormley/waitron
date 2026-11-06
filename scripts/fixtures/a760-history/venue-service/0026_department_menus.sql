CREATE TABLE `department_all_day_menus` (
	`department_id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`department_id`,`menu_id`) REFERENCES `department_menus`(`department_id`,`menu_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `department_menus` (
	`department_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`department_id`, `menu_id`),
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `department_menus_order_idx` ON `department_menus` (`department_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `zone_all_day_menus` (
	`zone_id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`menu_id` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`,`menu_id`) REFERENCES `department_menus`(`department_id`,`menu_id`) ON UPDATE no action ON DELETE no action
);

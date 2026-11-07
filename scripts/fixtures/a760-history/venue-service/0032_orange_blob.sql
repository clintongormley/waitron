CREATE TABLE `menu_period_staff_menus` (
	`period_id` text NOT NULL,
	`department_id` text NOT NULL,
	`menu_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`period_id`, `menu_id`),
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `menu_periods` ADD `colour` text DEFAULT 'grey' NOT NULL;
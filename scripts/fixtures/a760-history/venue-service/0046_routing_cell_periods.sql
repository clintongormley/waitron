CREATE TABLE `routing_cell_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`cell_id` text NOT NULL,
	`period_id` text NOT NULL,
	`department_id` text NOT NULL,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`cell_id`) REFERENCES `routing_cells`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routing_cell_periods_target_ck" CHECK(("routing_cell_periods"."station_id" is not null and "routing_cell_periods"."no_preparation" = 0) or ("routing_cell_periods"."station_id" is null and "routing_cell_periods"."no_preparation" = 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cell_periods_cell_period_key` ON `routing_cell_periods` (`cell_id`,`period_id`);
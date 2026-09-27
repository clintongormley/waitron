CREATE TABLE `kitchen_print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`print_job_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`station_id` text NOT NULL,
	`reprint` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kitchen_print_jobs_order_station_idx` ON `kitchen_print_jobs` (`working_order_id`,`station_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_print_jobs_job_order_station_key` ON `kitchen_print_jobs` (`print_job_id`,`working_order_id`,`station_id`);
CREATE TABLE `kitchen_print_job_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`print_job_id` text NOT NULL,
	`working_order_line_id` text NOT NULL,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kitchen_print_job_lines_line_idx` ON `kitchen_print_job_lines` (`working_order_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_print_job_lines_job_line_key` ON `kitchen_print_job_lines` (`print_job_id`,`working_order_line_id`);
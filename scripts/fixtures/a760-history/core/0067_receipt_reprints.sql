CREATE TABLE `receipt_reprints` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`print_job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `receipt_reprints_sale_idx` ON `receipt_reprints` (`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_reprints_job_uq` ON `receipt_reprints` (`print_job_id`);
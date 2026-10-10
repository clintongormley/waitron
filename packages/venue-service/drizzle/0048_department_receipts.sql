CREATE TABLE `department_receipts` (
	`department_id` text PRIMARY KEY NOT NULL,
	`receipt` text NOT NULL,
	`logo_rasters` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);

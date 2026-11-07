ALTER TABLE `print_jobs` ADD `sale_id` text REFERENCES sales(id);--> statement-breakpoint
CREATE INDEX `print_jobs_sale_id_idx` ON `print_jobs` (`sale_id`);
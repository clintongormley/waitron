ALTER TABLE `print_jobs` ADD `resend_of` text REFERENCES print_jobs(id);--> statement-breakpoint
CREATE INDEX `print_jobs_resend_of_idx` ON `print_jobs` (`resend_of`);
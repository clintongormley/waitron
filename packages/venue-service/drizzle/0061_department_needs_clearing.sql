ALTER TABLE `departments` ADD `needs_clearing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `service_settings` DROP COLUMN `clearing_workflow`;
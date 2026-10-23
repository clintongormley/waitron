ALTER TABLE `departments` ADD `release_reminder_minutes` integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE `service_settings` DROP COLUMN `release_reminder_minutes`;
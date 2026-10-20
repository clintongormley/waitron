DROP INDEX `adjustment_reasons_active_name_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_reasons_name_key` ON `adjustment_reasons` (`name`);--> statement-breakpoint
ALTER TABLE `adjustment_reasons` DROP COLUMN `active`;
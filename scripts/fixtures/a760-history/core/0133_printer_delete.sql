DROP INDEX `printers_local_key_key`;--> statement-breakpoint
ALTER TABLE `printers` ADD `deleted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `printers_local_key_key` ON `printers` (`location_id`,`local_key`) WHERE "printers"."local_key" is not null and "printers"."deleted_at" is null;
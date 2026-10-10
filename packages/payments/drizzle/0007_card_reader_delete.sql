DROP INDEX `card_readers_provider_ref_key`;--> statement-breakpoint
ALTER TABLE `card_readers` ADD `deleted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `card_readers_provider_ref_key` ON `card_readers` (`provider`,`provider_ref`) WHERE "card_readers"."deleted_at" is null;
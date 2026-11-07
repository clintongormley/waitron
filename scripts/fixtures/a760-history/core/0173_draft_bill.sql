DROP INDEX `order_drafts_open_owner_uq`;--> statement-breakpoint
ALTER TABLE `order_drafts` ADD `bill_id` text REFERENCES working_orders(id);--> statement-breakpoint
CREATE UNIQUE INDEX `order_drafts_open_owner_uq` ON `order_drafts` (`party_id`,`owner_id`,`bill_id`) WHERE "order_drafts"."state" = 'open';
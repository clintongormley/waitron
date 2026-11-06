DROP INDEX `order_drafts_open_owner_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `order_drafts_open_owner_uq` ON `order_drafts` (`bill_id`) WHERE "order_drafts"."state" = 'open';
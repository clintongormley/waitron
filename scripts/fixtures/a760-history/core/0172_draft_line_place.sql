-- Add in place: rebuilding draft lines would cascade-delete their allergy ticks.
ALTER TABLE `order_draft_lines` ADD `slot` integer DEFAULT 0 NOT NULL CONSTRAINT "order_draft_lines_slot_ck" CHECK("order_draft_lines"."slot" >= 0);--> statement-breakpoint
ALTER TABLE `order_draft_lines` ADD `join_group_id` text REFERENCES `order_groups`(`id`) CONSTRAINT "order_draft_lines_place_ck" CHECK("order_draft_lines"."join_group_id" is null or "order_draft_lines"."slot" = 0);--> statement-breakpoint
ALTER TABLE `order_draft_lines` ADD `after_group_id` text REFERENCES `order_groups`(`id`) CONSTRAINT "order_draft_lines_after_ck" CHECK("order_draft_lines"."after_group_id" is null or "order_draft_lines"."slot" >= 1);

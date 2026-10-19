CREATE TABLE `order_draft_recalled_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`source_line_id` text NOT NULL,
	`position` integer NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`join_group_id` text,
	`after_group_id` text,
	FOREIGN KEY (`draft_id`) REFERENCES `order_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`join_group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`after_group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_draft_recalled_lines_slot_ck" CHECK("order_draft_recalled_lines"."slot" >= 0),
	CONSTRAINT "order_draft_recalled_lines_place_ck" CHECK("order_draft_recalled_lines"."join_group_id" is null or "order_draft_recalled_lines"."slot" = 0),
	CONSTRAINT "order_draft_recalled_lines_after_ck" CHECK("order_draft_recalled_lines"."after_group_id" is null or "order_draft_recalled_lines"."slot" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_draft_recalled_lines_source_uq` ON `order_draft_recalled_lines` (`source_line_id`);--> statement-breakpoint
CREATE INDEX `order_draft_recalled_lines_draft_idx` ON `order_draft_recalled_lines` (`draft_id`);
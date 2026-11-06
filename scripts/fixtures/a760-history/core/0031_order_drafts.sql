CREATE TABLE `order_draft_events` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_person` text,
	`to_person` text NOT NULL,
	`actor_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `order_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_draft_events_kind_ck" CHECK("order_draft_events"."kind" in ('created', 'taken_over', 'submitted', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `order_draft_events_draft_idx` ON `order_draft_events` (`draft_id`);--> statement-breakpoint
CREATE TABLE `order_draft_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`menu_item_id` text NOT NULL,
	`variant_id` text,
	`menu_version_id` text,
	`options` text NOT NULL,
	`extras` text NOT NULL,
	`note` text,
	`quantity` integer NOT NULL,
	`course_id` text,
	`no_merge` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `order_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_draft_lines_quantity_ck" CHECK("order_draft_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `order_draft_lines_draft_idx` ON `order_draft_lines` (`draft_id`);--> statement-breakpoint
CREATE TABLE `order_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_drafts_state_ck" CHECK("order_drafts"."state" in ('open', 'submitted', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `order_drafts_visit_idx` ON `order_drafts` (`visit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_drafts_open_owner_uq` ON `order_drafts` (`visit_id`,`owner_id`) WHERE "order_drafts"."state" = 'open';
CREATE TABLE `order_group_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`group_id` text,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_group_events_kind_ck" CHECK("order_group_events"."kind" in ('submitted', 'joined', 'fired', 'reordered', 'lines_moved', 'removed'))
);
--> statement-breakpoint
CREATE INDEX `order_group_events_visit_idx` ON `order_group_events` (`visit_id`);--> statement-breakpoint
CREATE INDEX `order_group_events_group_idx` ON `order_group_events` (`group_id`);--> statement-breakpoint
CREATE TABLE `order_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`position` integer NOT NULL,
	`state` text NOT NULL,
	`fired_at` text,
	`fired_by` text,
	`submitted_by` text NOT NULL,
	`remind_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_groups_state_ck" CHECK("order_groups"."state" in ('held', 'fired', 'removed')),
	CONSTRAINT "order_groups_fired_at_ck" CHECK(("order_groups"."state" = 'fired') = ("order_groups"."fired_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `order_groups_visit_idx` ON `order_groups` (`visit_id`);--> statement-breakpoint
ALTER TABLE `working_order_lines` ADD `group_id` text REFERENCES order_groups(id);--> statement-breakpoint
ALTER TABLE `working_order_lines` ADD `credited_to` text;--> statement-breakpoint
CREATE INDEX `working_order_lines_group_idx` ON `working_order_lines` (`group_id`);
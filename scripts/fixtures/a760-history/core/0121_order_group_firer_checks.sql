PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order_group_events` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`group_id` text,
	`kind` text NOT NULL,
	`actor_id` text,
	`actor_device_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_group_events_kind_ck" CHECK("__new_order_group_events"."kind" in ('submitted', 'joined', 'fired', 'reordered', 'lines_moved', 'removed')),
	CONSTRAINT "order_group_events_actor_ck" CHECK(("__new_order_group_events"."actor_id" is null) <> ("__new_order_group_events"."actor_device_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_order_group_events`("id", "party_id", "group_id", "kind", "actor_id", "actor_device_id", "detail", "created_at") SELECT "id", "party_id", "group_id", "kind", "actor_id", "actor_device_id", "detail", "created_at" FROM `order_group_events`;--> statement-breakpoint
DROP TABLE `order_group_events`;--> statement-breakpoint
ALTER TABLE `__new_order_group_events` RENAME TO `order_group_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_group_events_party_idx` ON `order_group_events` (`party_id`);--> statement-breakpoint
CREATE INDEX `order_group_events_group_idx` ON `order_group_events` (`group_id`);--> statement-breakpoint
CREATE TABLE `__new_order_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`position` integer NOT NULL,
	`state` text NOT NULL,
	`fired_at` text,
	`fired_by` text,
	`fired_by_device_id` text,
	`submitted_by` text NOT NULL,
	`remind_at` text,
	`hold_printed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fired_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_groups_state_ck" CHECK("__new_order_groups"."state" in ('held', 'fired', 'removed')),
	CONSTRAINT "order_groups_fired_at_ck" CHECK(("__new_order_groups"."state" = 'fired') = ("__new_order_groups"."fired_at" is not null)),
	CONSTRAINT "order_groups_firer_ck" CHECK("__new_order_groups"."fired_by" is null or "__new_order_groups"."fired_by_device_id" is null)
);
--> statement-breakpoint
INSERT INTO `__new_order_groups`("id", "party_id", "position", "state", "fired_at", "fired_by", "fired_by_device_id", "submitted_by", "remind_at", "hold_printed_at", "created_at") SELECT "id", "party_id", "position", "state", "fired_at", "fired_by", "fired_by_device_id", "submitted_by", "remind_at", "hold_printed_at", "created_at" FROM `order_groups`;--> statement-breakpoint
DROP TABLE `order_groups`;--> statement-breakpoint
ALTER TABLE `__new_order_groups` RENAME TO `order_groups`;--> statement-breakpoint
CREATE INDEX `order_groups_party_idx` ON `order_groups` (`party_id`);
CREATE TABLE `service_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "service_commands_scope_kind_ck" CHECK("service_commands"."scope_kind" in ('visit', 'bill'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_commands_scope_submission_key` ON `service_commands` (`scope_kind`,`scope_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `visit_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`table_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_tables_active_table_uq` ON `visit_tables` (`table_id`) WHERE "visit_tables"."left_at" is null;--> statement-breakpoint
CREATE INDEX `visit_tables_visit_idx` ON `visit_tables` (`visit_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`merged_into_visit_id` text,
	`bill_requested_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`merged_into_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visits_state_ck" CHECK("visits"."state" in ('open', 'needs_clearing', 'closed')),
	CONSTRAINT "visits_guest_count_ck" CHECK("visits"."guest_count" is null or "visits"."guest_count" >= 1),
	CONSTRAINT "visits_closed_at_ck" CHECK(("visits"."state" = 'open') = ("visits"."closed_at" is null)),
	CONSTRAINT "visits_merged_into_ck" CHECK("visits"."merged_into_visit_id" is null or ("visits"."merged_into_visit_id" <> "visits"."id" and "visits"."state" = 'closed'))
);
--> statement-breakpoint
CREATE INDEX `visits_merged_into_idx` ON `visits` (`merged_into_visit_id`);--> statement-breakpoint
ALTER TABLE `working_orders` ADD `visit_id` text REFERENCES visits(id);--> statement-breakpoint
CREATE INDEX `working_orders_visit_idx` ON `working_orders` (`visit_id`);
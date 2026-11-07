PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`zone_id` text,
	`capacity` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`status_id` text,
	`pos_x` integer,
	`pos_y` integer,
	`shape` text,
	`rotation` integer,
	`needs_clearing_since` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `table_service_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dining_tables_shape_ck" CHECK("__new_dining_tables"."shape" in ('round', 'square', 'rect'))
);
--> statement-breakpoint
INSERT INTO `__new_dining_tables`("id", "location_id", "label", "zone_id", "capacity", "active", "created_at", "status_id", "pos_x", "pos_y", "shape", "rotation", "needs_clearing_since") SELECT "id", "location_id", "label", "zone_id", "capacity", "active", "created_at", "status_id", "pos_x", "pos_y", "shape", "rotation", "needs_clearing_since" FROM `dining_tables`;--> statement-breakpoint
DROP TABLE `dining_tables`;--> statement-breakpoint
ALTER TABLE `__new_dining_tables` RENAME TO `dining_tables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_location_label_key` ON `dining_tables` (`location_id`,`label`);--> statement-breakpoint
CREATE TABLE `__new_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`merged_into_party_id` text,
	`bill_requested_at` text,
	`name` text,
	`main_bill_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`main_bill_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_into_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "parties_state_ck" CHECK("__new_parties"."state" in ('open', 'closed')),
	CONSTRAINT "parties_guest_count_ck" CHECK("__new_parties"."guest_count" is null or "__new_parties"."guest_count" >= 1),
	CONSTRAINT "parties_closed_at_ck" CHECK(("__new_parties"."state" = 'open') = ("__new_parties"."closed_at" is null)),
	CONSTRAINT "parties_merged_into_ck" CHECK("__new_parties"."merged_into_party_id" is null or ("__new_parties"."merged_into_party_id" <> "__new_parties"."id" and "__new_parties"."state" = 'closed'))
);
--> statement-breakpoint
INSERT INTO `__new_parties`("id", "guest_count", "state", "opened_at", "opened_by", "closed_at", "closed_by", "merged_into_party_id", "bill_requested_at", "name", "main_bill_id", "revision") SELECT "id", "guest_count", "state", "opened_at", "opened_by", "closed_at", "closed_by", "merged_into_party_id", "bill_requested_at", "name", "main_bill_id", "revision" FROM `parties`;--> statement-breakpoint
DROP TABLE `parties`;--> statement-breakpoint
ALTER TABLE `__new_parties` RENAME TO `parties`;--> statement-breakpoint
CREATE INDEX `parties_merged_into_idx` ON `parties` (`merged_into_party_id`);--> statement-breakpoint
CREATE TABLE `__new_service_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "service_commands_scope_kind_ck" CHECK("__new_service_commands"."scope_kind" in ('party', 'bill'))
);
--> statement-breakpoint
INSERT INTO `__new_service_commands`("id", "scope_kind", "scope_id", "submission_id", "kind", "fingerprint", "result", "created_at") SELECT "id", "scope_kind", "scope_id", "submission_id", "kind", "fingerprint", "result", "created_at" FROM `service_commands`;--> statement-breakpoint
DROP TABLE `service_commands`;--> statement-breakpoint
ALTER TABLE `__new_service_commands` RENAME TO `service_commands`;--> statement-breakpoint
CREATE UNIQUE INDEX `service_commands_scope_submission_key` ON `service_commands` (`scope_kind`,`scope_id`,`submission_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`node_id` text NOT NULL,
	`entry_kind` text NOT NULL,
	`event_at` text NOT NULL,
	`event_offset_minutes` integer NOT NULL,
	`captured_by_source` text NOT NULL,
	`captured_by_device_id` text,
	`recorded_by_person_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`corrects_entry_id` text,
	`correction_reason` text,
	`correction_status` text,
	`correction_actor_id` text,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`sequence_no` integer NOT NULL,
	`is_first_entry` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`correction_actor_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "time_entries_event_offset_ck" CHECK("__new_time_entries"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "time_entries_correction_shape_ck" CHECK(("__new_time_entries"."corrects_entry_id" is null and "__new_time_entries"."correction_reason" is null
             and "__new_time_entries"."correction_status" is null and "__new_time_entries"."correction_actor_id" is null)
          or ("__new_time_entries"."corrects_entry_id" is not null and "__new_time_entries"."correction_reason" is not null
             and "__new_time_entries"."correction_status" is not null and "__new_time_entries"."correction_actor_id" is not null)),
	CONSTRAINT "time_entries_entry_hash_ck" CHECK(length("__new_time_entries"."entry_hash") = 64 and "__new_time_entries"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "time_entries_sequence_no_ck" CHECK("__new_time_entries"."sequence_no" > 0),
	CONSTRAINT "time_entries_chaining_ck" CHECK(("__new_time_entries"."is_first_entry" and "__new_time_entries"."prev_entry_hash" is null)
          or (not "__new_time_entries"."is_first_entry" and "__new_time_entries"."prev_entry_hash" is not null)),
	CONSTRAINT "time_entries_event_at_second_ck" CHECK("__new_time_entries"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_recorded_at_second_ck" CHECK("__new_time_entries"."recorded_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_entry_kind_ck" CHECK("__new_time_entries"."entry_kind" in ('in', 'out', 'break_start', 'break_end', 'correction')),
	CONSTRAINT "time_entries_captured_by_source_ck" CHECK("__new_time_entries"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test')),
	CONSTRAINT "time_entries_captured_by_source_device_ck" CHECK(("__new_time_entries"."captured_by_source" = 'device') = ("__new_time_entries"."captured_by_device_id" is not null)),
	CONSTRAINT "time_entries_correction_status_ck" CHECK("__new_time_entries"."correction_status" in ('requested', 'approved'))
);
--> statement-breakpoint
INSERT INTO `__new_time_entries`("id", "person_id", "location_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry") SELECT "id", "person_id", "location_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry" FROM `time_entries`;--> statement-breakpoint
DROP TABLE `time_entries`;--> statement-breakpoint
ALTER TABLE `__new_time_entries` RENAME TO `time_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `time_entries_person_event_idx` ON `time_entries` (`person_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `time_entries_corrects_entry_idx` ON `time_entries` (`corrects_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`location_id`,`sequence_no`);
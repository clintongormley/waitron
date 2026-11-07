CREATE TABLE `pay_period_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`location_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`clock` text NOT NULL,
	`scheduled_close_at` text NOT NULL,
	`closed_at` text NOT NULL,
	`snapshot` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`prev_closure_hash` text,
	`closure_hash` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pay_period_closures_period_ck" CHECK("pay_period_closures"."period_end" > "pay_period_closures"."period_start"),
	CONSTRAINT "pay_period_closures_sequence_ck" CHECK("pay_period_closures"."sequence_no" > 0),
	CONSTRAINT "pay_period_closures_predecessor_ck" CHECK(("pay_period_closures"."sequence_no" = 1 and "pay_period_closures"."prev_closure_hash" is null)
  or ("pay_period_closures"."sequence_no" > 1 and "pay_period_closures"."prev_closure_hash" is not null)),
	CONSTRAINT "pay_period_closures_hash_ck" CHECK(length("pay_period_closures"."closure_hash") = 64 and "pay_period_closures"."closure_hash" not glob '*[^0-9A-F]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_chain_position_uq` ON `pay_period_closures` (`node_id`,`location_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_period_uq` ON `pay_period_closures` (`location_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `pay_period_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`anchor_date` text,
	CONSTRAINT "pay_period_settings_singleton_ck" CHECK("pay_period_settings"."id" = 1),
	CONSTRAINT "pay_period_settings_frequency_ck" CHECK("pay_period_settings"."frequency" in ('monthly', 'weekly', 'fortnightly')),
	CONSTRAINT "pay_period_settings_anchor_ck" CHECK(("pay_period_settings"."frequency" <> 'fortnightly' and "pay_period_settings"."anchor_date" is null)
    or ("pay_period_settings"."frequency" = 'fortnightly' and "pay_period_settings"."anchor_date" is not null
      and date("pay_period_settings"."anchor_date", '+0 days') is not null
      and date("pay_period_settings"."anchor_date", '+0 days') = "pay_period_settings"."anchor_date" and strftime('%w', "pay_period_settings"."anchor_date") = '1'))
);
--> statement-breakpoint
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
	`recorded_by_person_id` text,
	`recorded_at` text NOT NULL,
	`corrects_entry_id` text,
	`correction_reason` text,
	`correction_status` text,
	`correction_actor_id` text,
	`author_kind` text,
	`correction_direction` text,
	`missing_entry_kind` text,
	`responds_to_entry_id` text,
	`pay_period_closure_id` text,
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
	FOREIGN KEY (`responds_to_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`responds_to_entry_id`,`person_id`,`location_id`) REFERENCES `time_entries`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pay_period_closure_id`) REFERENCES `pay_period_closures`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "time_entries_author_kind_ck" CHECK("__new_time_entries"."author_kind" is null or "__new_time_entries"."author_kind" in ('worker','manager','automatic')),
	CONSTRAINT "time_entries_correction_direction_ck" CHECK("__new_time_entries"."correction_direction" is null or "__new_time_entries"."correction_direction" in ('worker_request','manager_proposal')),
	CONSTRAINT "time_entries_missing_entry_kind_ck" CHECK("__new_time_entries"."missing_entry_kind" is null or "__new_time_entries"."missing_entry_kind" in ('in','out','break_start','break_end')),
	CONSTRAINT "time_entries_author_ck" CHECK(coalesce(("__new_time_entries"."author_kind" = 'automatic' and "__new_time_entries"."recorded_by_person_id" is null)
      or ("__new_time_entries"."author_kind" is null and "__new_time_entries"."recorded_by_person_id" is not null)
      or ("__new_time_entries"."author_kind" in ('worker','manager') and "__new_time_entries"."recorded_by_person_id" is not null), 0)),
	CONSTRAINT "time_entries_event_offset_ck" CHECK("__new_time_entries"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "time_entries_correction_shape_ck" CHECK(("__new_time_entries"."author_kind" is null and "__new_time_entries"."correction_direction" is null
          and "__new_time_entries"."missing_entry_kind" is null and "__new_time_entries"."responds_to_entry_id" is null
          and "__new_time_entries"."pay_period_closure_id" is null
          and "__new_time_entries"."entry_kind" <> 'confirmation'
          and (("__new_time_entries"."corrects_entry_id" is null and "__new_time_entries"."correction_reason" is null
            and "__new_time_entries"."correction_status" is null and "__new_time_entries"."correction_actor_id" is null)
            or ("__new_time_entries"."corrects_entry_id" is not null and "__new_time_entries"."correction_reason" is not null
            and "__new_time_entries"."correction_status" is not null and "__new_time_entries"."correction_actor_id" is not null)))
        or ("__new_time_entries"."entry_kind" in ('in','out','break_start','break_end')
          and "__new_time_entries"."corrects_entry_id" is null and "__new_time_entries"."correction_reason" is null
          and "__new_time_entries"."correction_status" is null and "__new_time_entries"."correction_actor_id" is null
          and "__new_time_entries"."correction_direction" is null and "__new_time_entries"."missing_entry_kind" is null
          and "__new_time_entries"."responds_to_entry_id" is null and "__new_time_entries"."pay_period_closure_id" is null)
        or ("__new_time_entries"."entry_kind" = 'confirmation' and "__new_time_entries"."responds_to_entry_id" is not null
          and "__new_time_entries"."author_kind" is not null
          and (("__new_time_entries"."author_kind" = 'worker' and "__new_time_entries"."pay_period_closure_id" is null)
            or ("__new_time_entries"."author_kind" = 'automatic' and "__new_time_entries"."pay_period_closure_id" is not null))
          and "__new_time_entries"."corrects_entry_id" is null and "__new_time_entries"."correction_reason" is null
          and "__new_time_entries"."correction_status" is null and "__new_time_entries"."correction_actor_id" is null
          and "__new_time_entries"."correction_direction" is null and "__new_time_entries"."missing_entry_kind" is null)
        or ("__new_time_entries"."entry_kind" = 'correction' and "__new_time_entries"."correction_reason" is not null
          and "__new_time_entries"."correction_status" is not null and "__new_time_entries"."correction_actor_id" is not null
          and "__new_time_entries"."pay_period_closure_id" is null
          and (("__new_time_entries"."corrects_entry_id" is not null and "__new_time_entries"."missing_entry_kind" is null)
            or ("__new_time_entries"."corrects_entry_id" is null and "__new_time_entries"."missing_entry_kind" is not null
              and "__new_time_entries"."correction_direction" is not null and "__new_time_entries"."author_kind" is not null)))),
	CONSTRAINT "time_entries_entry_hash_ck" CHECK(length("__new_time_entries"."entry_hash") = 64 and "__new_time_entries"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "time_entries_sequence_no_ck" CHECK("__new_time_entries"."sequence_no" > 0),
	CONSTRAINT "time_entries_chaining_ck" CHECK(("__new_time_entries"."is_first_entry" and "__new_time_entries"."prev_entry_hash" is null)
          or (not "__new_time_entries"."is_first_entry" and "__new_time_entries"."prev_entry_hash" is not null)),
	CONSTRAINT "time_entries_event_at_second_ck" CHECK("__new_time_entries"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_recorded_at_second_ck" CHECK("__new_time_entries"."recorded_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_entry_kind_ck" CHECK("__new_time_entries"."entry_kind" in ('in', 'out', 'break_start', 'break_end', 'correction', 'confirmation')),
	CONSTRAINT "time_entries_captured_by_source_ck" CHECK("__new_time_entries"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "time_entries_captured_by_source_device_ck" CHECK(("__new_time_entries"."captured_by_source" = 'device') = ("__new_time_entries"."captured_by_device_id" is not null)),
	CONSTRAINT "time_entries_correction_status_ck" CHECK("__new_time_entries"."correction_status" in ('requested', 'approved', 'declined', 'disputed'))
);
--> statement-breakpoint
INSERT INTO `__new_time_entries`("id", "person_id", "location_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "author_kind", "correction_direction", "missing_entry_kind", "responds_to_entry_id", "pay_period_closure_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry") SELECT "id", "person_id", "location_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "author_kind", "correction_direction", "missing_entry_kind", "responds_to_entry_id", "pay_period_closure_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry" FROM `time_entries`;--> statement-breakpoint
DROP TABLE `time_entries`;--> statement-breakpoint
ALTER TABLE `__new_time_entries` RENAME TO `time_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_subject_identity_uq` ON `time_entries` (`id`,`person_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `time_entries_person_event_idx` ON `time_entries` (`person_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `time_entries_corrects_entry_idx` ON `time_entries` (`corrects_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`location_id`,`sequence_no`);
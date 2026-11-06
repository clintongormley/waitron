PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attendance_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`business_day` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`shift_key` text NOT NULL,
	`kind` text NOT NULL,
	`missing_kinds` text NOT NULL,
	`open_entry_id` text,
	`automatic_entry_id` text,
	`resolved_by_entry_id` text,
	`evidence_keys` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`canonical_question_id` text,
	`inactive_reason` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`open_entry_id`,`person_id`) REFERENCES `time_entries`(`id`,`person_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`automatic_entry_id`,`person_id`) REFERENCES `time_entries`(`id`,`person_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by_entry_id`,`person_id`) REFERENCES `time_entries`(`id`,`person_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_question_id`,`person_id`,`location_id`) REFERENCES `attendance_questions`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_questions_kind_ck" CHECK("__new_attendance_questions"."kind" in ('automatic-out', 'missing-times')),
	CONSTRAINT "attendance_questions_bounds_ck" CHECK("__new_attendance_questions"."end_at" > "__new_attendance_questions"."start_at"),
	CONSTRAINT "attendance_questions_activity_ck" CHECK(("__new_attendance_questions"."active" = 1 and "__new_attendance_questions"."inactive_reason" is null and "__new_attendance_questions"."canonical_question_id" is null) or ("__new_attendance_questions"."active" = 0 and "__new_attendance_questions"."inactive_reason" is not null)),
	CONSTRAINT "attendance_questions_canonical_ck" CHECK("__new_attendance_questions"."canonical_question_id" is null or "__new_attendance_questions"."canonical_question_id" <> "__new_attendance_questions"."id"),
	CONSTRAINT "attendance_questions_automatic_ck" CHECK(("__new_attendance_questions"."kind" = 'automatic-out' and "__new_attendance_questions"."open_entry_id" is not null and "__new_attendance_questions"."automatic_entry_id" is not null and json_array_length("__new_attendance_questions"."missing_kinds") = 0) or ("__new_attendance_questions"."kind" = 'missing-times' and "__new_attendance_questions"."automatic_entry_id" is null and json_array_length("__new_attendance_questions"."missing_kinds") > 0))
);
--> statement-breakpoint
INSERT INTO `__new_attendance_questions`("id", "person_id", "location_id", "business_day", "start_at", "end_at", "shift_key", "kind", "missing_kinds", "open_entry_id", "automatic_entry_id", "resolved_by_entry_id", "evidence_keys", "created_at", "active", "canonical_question_id", "inactive_reason") SELECT "id", "person_id", "location_id", "business_day", "start_at", "end_at", "shift_key", "kind", "missing_kinds", "open_entry_id", "automatic_entry_id", "resolved_by_entry_id", "evidence_keys", "created_at", "active", "canonical_question_id", "inactive_reason" FROM `attendance_questions`;--> statement-breakpoint
DROP TABLE `attendance_questions`;--> statement-breakpoint
ALTER TABLE `__new_attendance_questions` RENAME TO `attendance_questions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_shift_uq` ON `attendance_questions` (`person_id`,`location_id`,`shift_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_subject_uq` ON `attendance_questions` (`id`,`person_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `attendance_questions_own_idx` ON `attendance_questions` (`person_id`,`active`,`resolved_by_entry_id`,`business_day`,`start_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_pay_period_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
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
	CONSTRAINT "pay_period_closures_period_ck" CHECK("__new_pay_period_closures"."period_end" > "__new_pay_period_closures"."period_start"),
	CONSTRAINT "pay_period_closures_sequence_ck" CHECK("__new_pay_period_closures"."sequence_no" > 0),
	CONSTRAINT "pay_period_closures_predecessor_ck" CHECK(("__new_pay_period_closures"."sequence_no" = 1 and "__new_pay_period_closures"."prev_closure_hash" is null)
  or ("__new_pay_period_closures"."sequence_no" > 1 and "__new_pay_period_closures"."prev_closure_hash" is not null)),
	CONSTRAINT "pay_period_closures_hash_ck" CHECK(length("__new_pay_period_closures"."closure_hash") = 64 and "__new_pay_period_closures"."closure_hash" not glob '*[^0-9A-F]*')
);
--> statement-breakpoint
INSERT INTO `__new_pay_period_closures`("id", "node_id", "period_start", "period_end", "clock", "scheduled_close_at", "closed_at", "snapshot", "sequence_no", "prev_closure_hash", "closure_hash") SELECT "id", "node_id", "period_start", "period_end", "clock", "scheduled_close_at", "closed_at", "snapshot", "sequence_no", "prev_closure_hash", "closure_hash" FROM `pay_period_closures`;--> statement-breakpoint
DROP TABLE `pay_period_closures`;--> statement-breakpoint
ALTER TABLE `__new_pay_period_closures` RENAME TO `pay_period_closures`;--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_chain_position_uq` ON `pay_period_closures` (`node_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_period_uq` ON `pay_period_closures` (`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `__new_time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
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
	`self_approved` integer DEFAULT false NOT NULL,
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
	FOREIGN KEY (`captured_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`correction_actor_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`responds_to_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`responds_to_entry_id`,`person_id`) REFERENCES `time_entries`(`id`,`person_id`) ON UPDATE no action ON DELETE restrict,
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
INSERT INTO `__new_time_entries`("id", "person_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "self_approved", "author_kind", "correction_direction", "missing_entry_kind", "responds_to_entry_id", "pay_period_closure_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry") SELECT "id", "person_id", "node_id", "entry_kind", "event_at", "event_offset_minutes", "captured_by_source", "captured_by_device_id", "recorded_by_person_id", "recorded_at", "corrects_entry_id", "correction_reason", "correction_status", "correction_actor_id", "self_approved", "author_kind", "correction_direction", "missing_entry_kind", "responds_to_entry_id", "pay_period_closure_id", "entry_hash", "prev_entry_hash", "sequence_no", "is_first_entry" FROM `time_entries`;--> statement-breakpoint
DROP TABLE `time_entries`;--> statement-breakpoint
ALTER TABLE `__new_time_entries` RENAME TO `time_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_person_entry_uq` ON `time_entries` (`id`,`person_id`);--> statement-breakpoint
CREATE INDEX `time_entries_person_event_idx` ON `time_entries` (`person_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `time_entries_person_chain_idx` ON `time_entries` (`person_id`,`node_id`,`sequence_no`);--> statement-breakpoint
CREATE INDEX `time_entries_corrects_entry_idx` ON `time_entries` (`corrects_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `__new_workforce_chains` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_id` text,
	`last_entry_hash` text,
	`last_recorded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workforce_chains_pointer_ck" CHECK(("__new_workforce_chains"."last_entry_id" is null) = ("__new_workforce_chains"."last_entry_hash" is null)
          and ("__new_workforce_chains"."last_entry_id" is null) = ("__new_workforce_chains"."last_recorded_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_workforce_chains`("node_id", "sequence_no", "last_entry_id", "last_entry_hash", "last_recorded_at", "updated_at") SELECT "node_id", "sequence_no", "last_entry_id", "last_entry_hash", "last_recorded_at", "updated_at" FROM `workforce_chains`;--> statement-breakpoint
DROP TABLE `workforce_chains`;--> statement-breakpoint
ALTER TABLE `__new_workforce_chains` RENAME TO `workforce_chains`;--> statement-breakpoint
CREATE TABLE `__new_attendance_response_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by_person_id` text NOT NULL,
	`authorized_by_person_id` text NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text,
	`question_id` text,
	`action` text NOT NULL,
	`input` text NOT NULL,
	`entry_ids` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`requested_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authorized_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`,`person_id`,`location_id`) REFERENCES `attendance_questions`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_response_commands_action_ck" CHECK("__new_attendance_response_commands"."action" in ('confirm', 'request', 'propose', 'approve', 'decline', 'accept', 'disagree')),
	CONSTRAINT "attendance_response_commands_entries_ck" CHECK(json_valid("__new_attendance_response_commands"."entry_ids") and json_type("__new_attendance_response_commands"."entry_ids") = 'array' and json_array_length("__new_attendance_response_commands"."entry_ids") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_attendance_response_commands`("id", "requested_by_person_id", "authorized_by_person_id", "person_id", "location_id", "question_id", "action", "input", "entry_ids", "created_at") SELECT "id", "requested_by_person_id", "authorized_by_person_id", "person_id", "location_id", "question_id", "action", "input", "entry_ids", "created_at" FROM `attendance_response_commands`;--> statement-breakpoint
DROP TABLE `attendance_response_commands`;--> statement-breakpoint
ALTER TABLE `__new_attendance_response_commands` RENAME TO `attendance_response_commands`;--> statement-breakpoint
CREATE INDEX `attendance_response_commands_question_idx` ON `attendance_response_commands` (`person_id`,`question_id`);
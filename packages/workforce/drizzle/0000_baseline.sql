CREATE TABLE `absences` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`absence_kind` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`note` text,
	`decided_by_person_id` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decided_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "absences_range_ck" CHECK("absences"."ends_on" >= "absences"."starts_on"),
	CONSTRAINT "absences_absence_kind_ck" CHECK("absences"."absence_kind" in ('holiday', 'sick_leave', 'leave', 'unpaid')),
	CONSTRAINT "absences_status_ck" CHECK("absences"."status" in ('requested', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `absences_person_idx` ON `absences` (`person_id`,`starts_on`);
--> statement-breakpoint
CREATE TABLE `attendance_day_work` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`business_day` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`dirty_revision` integer DEFAULT 1 NOT NULL,
	`evaluated_revision` integer DEFAULT 0 NOT NULL,
	`next_due_at` text NOT NULL,
	`deferred_shift_ids` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_day_work_bounds_ck" CHECK("attendance_day_work"."end_at" > "attendance_day_work"."start_at"),
	CONSTRAINT "attendance_day_work_revision_ck" CHECK("attendance_day_work"."dirty_revision" > 0 and "attendance_day_work"."evaluated_revision" >= 0 and "attendance_day_work"."evaluated_revision" <= "attendance_day_work"."dirty_revision")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_day_work_scope_uq` ON `attendance_day_work` (`location_id`,`business_day`);
--> statement-breakpoint
CREATE INDEX `attendance_day_work_due_idx` ON `attendance_day_work` (`location_id`,`next_due_at`);
--> statement-breakpoint
CREATE TABLE `attendance_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`next_attempt_at` text NOT NULL,
	`recipient` text,
	`outcome` text,
	FOREIGN KEY (`question_id`) REFERENCES `attendance_questions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_mail_status_ck" CHECK("attendance_mail"."status" in ('pending', 'sending', 'sent', 'rejected', 'unknown', 'cancelled')),
	CONSTRAINT "attendance_mail_outcome_ck" CHECK("attendance_mail"."outcome" in ('sent', 'rejected', 'unknown')),
	CONSTRAINT "attendance_mail_claim_ck" CHECK(("attendance_mail"."claim_token" is null and "attendance_mail"."claimed_at" is null) or ("attendance_mail"."claim_token" is not null and "attendance_mail"."claimed_at" is not null)),
	CONSTRAINT "attendance_mail_sending_ck" CHECK("attendance_mail"."status" <> 'sending' or ("attendance_mail"."claim_token" is not null and "attendance_mail"."recipient" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_mail_question_uq` ON `attendance_mail` (`question_id`);
--> statement-breakpoint
CREATE INDEX `attendance_mail_due_idx` ON `attendance_mail` (`status`,`next_attempt_at`,`id`);
--> statement-breakpoint
CREATE TABLE `attendance_operation_facts` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`offset_minutes` integer NOT NULL,
	`business_day` text NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_operation_facts_source_ck" CHECK("attendance_operation_facts"."source" in ('session', 'draft', 'order', 'whole-payment', 'bill-payment', 'refund', 'clock')),
	CONSTRAINT "attendance_operation_facts_kind_ck" CHECK("attendance_operation_facts"."kind" in ('sign-in', 'order', 'payment', 'break')),
	CONSTRAINT "attendance_operation_facts_outcome_ck" CHECK("attendance_operation_facts"."outcome" in ('pending', 'qualifying', 'refused')),
	CONSTRAINT "attendance_operation_facts_offset_ck" CHECK("attendance_operation_facts"."offset_minutes" between -840 and 840)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_operation_facts_source_uq` ON `attendance_operation_facts` (`source`,`key`);
--> statement-breakpoint
CREATE INDEX `attendance_operation_facts_day_idx` ON `attendance_operation_facts` (`location_id`,`business_day`,`person_id`,`at`);
--> statement-breakpoint
CREATE INDEX `attendance_operation_facts_pending_idx` ON `attendance_operation_facts` (`outcome`,`sequence`);
--> statement-breakpoint
CREATE INDEX `attendance_operation_facts_person_idx` ON `attendance_operation_facts` (`person_id`,`at`,`sequence`);
--> statement-breakpoint
CREATE TABLE `attendance_questions` (
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
	CONSTRAINT "attendance_questions_kind_ck" CHECK("attendance_questions"."kind" in ('automatic-out', 'missing-times')),
	CONSTRAINT "attendance_questions_bounds_ck" CHECK("attendance_questions"."end_at" > "attendance_questions"."start_at"),
	CONSTRAINT "attendance_questions_activity_ck" CHECK(("attendance_questions"."active" = 1 and "attendance_questions"."inactive_reason" is null and "attendance_questions"."canonical_question_id" is null) or ("attendance_questions"."active" = 0 and "attendance_questions"."inactive_reason" is not null)),
	CONSTRAINT "attendance_questions_canonical_ck" CHECK("attendance_questions"."canonical_question_id" is null or "attendance_questions"."canonical_question_id" <> "attendance_questions"."id"),
	CONSTRAINT "attendance_questions_automatic_ck" CHECK(("attendance_questions"."kind" = 'automatic-out' and "attendance_questions"."open_entry_id" is not null and "attendance_questions"."automatic_entry_id" is not null and json_array_length("attendance_questions"."missing_kinds") = 0) or ("attendance_questions"."kind" = 'missing-times' and "attendance_questions"."automatic_entry_id" is null and json_array_length("attendance_questions"."missing_kinds") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_shift_uq` ON `attendance_questions` (`person_id`,`location_id`,`shift_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_subject_uq` ON `attendance_questions` (`id`,`person_id`,`location_id`);
--> statement-breakpoint
CREATE INDEX `attendance_questions_own_idx` ON `attendance_questions` (`person_id`,`active`,`resolved_by_entry_id`,`business_day`,`start_at`,`id`);
--> statement-breakpoint
CREATE TABLE `attendance_response_commands` (
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
	CONSTRAINT "attendance_response_commands_action_ck" CHECK("attendance_response_commands"."action" in ('confirm', 'request', 'propose', 'approve', 'decline', 'accept', 'disagree')),
	CONSTRAINT "attendance_response_commands_entries_ck" CHECK(json_valid("attendance_response_commands"."entry_ids") and json_type("attendance_response_commands"."entry_ids") = 'array' and json_array_length("attendance_response_commands"."entry_ids") > 0)
);
--> statement-breakpoint
CREATE INDEX `attendance_response_commands_question_idx` ON `attendance_response_commands` (`person_id`,`question_id`);
--> statement-breakpoint
CREATE TABLE `attendance_source_state` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`record_kind` text NOT NULL,
	`generation` text,
	`cursor` integer,
	`endpoint` integer,
	`completed` integer,
	`fingerprint` text,
	`previous_days` text DEFAULT '[]' NOT NULL,
	`next_due_at` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_source_state_source_ck" CHECK("attendance_source_state"."source" in ('session', 'draft', 'order', 'group', 'whole-payment', 'bill-payment', 'refund', 'clock', 'rota', 'operation')),
	CONSTRAINT "attendance_source_state_kind_ck" CHECK("attendance_source_state"."record_kind" in ('scan', 'watch')),
	CONSTRAINT "attendance_source_state_shape_ck" CHECK(("attendance_source_state"."record_kind" = 'scan' and "attendance_source_state"."generation" is not null and "attendance_source_state"."cursor" is not null and "attendance_source_state"."endpoint" is not null and "attendance_source_state"."completed" is not null and "attendance_source_state"."cursor" >= 0 and "attendance_source_state"."endpoint" >= 0 and "attendance_source_state"."cursor" <= "attendance_source_state"."endpoint") or ("attendance_source_state"."record_kind" = 'watch' and "attendance_source_state"."generation" is null and "attendance_source_state"."cursor" is null and "attendance_source_state"."endpoint" is null and "attendance_source_state"."completed" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_source_state_scope_uq` ON `attendance_source_state` (`location_id`,`source`,`record_kind`,`key`);
--> statement-breakpoint
CREATE INDEX `attendance_source_state_watch_idx` ON `attendance_source_state` (`location_id`,`record_kind`,`next_due_at`,`id`);
--> statement-breakpoint
CREATE TABLE `availability` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`available_from_minute` integer NOT NULL,
	`available_to_minute` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "availability_weekday_ck" CHECK("availability"."weekday" between 0 and 6),
	CONSTRAINT "availability_from_minute_ck" CHECK("availability"."available_from_minute" between 0 and 1440),
	CONSTRAINT "availability_to_minute_ck" CHECK("availability"."available_to_minute" between 0 and 1440),
	CONSTRAINT "availability_window_ck" CHECK("availability"."available_to_minute" > "availability"."available_from_minute"),
	CONSTRAINT "availability_effective_ck" CHECK("availability"."effective_to" is null or "availability"."effective_to" >= "availability"."effective_from")
);
--> statement-breakpoint
CREATE INDEX `availability_person_idx` ON `availability` (`person_id`);
--> statement-breakpoint
CREATE TABLE `employments` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`contracted_minutes_per_week` integer NOT NULL,
	`contract_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`pay_rate` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "employments_contracted_minutes_ck" CHECK("employments"."contracted_minutes_per_week" >= 0),
	CONSTRAINT "employments_dates_ck" CHECK("employments"."end_date" is null or "employments"."end_date" >= "employments"."start_date")
);
--> statement-breakpoint
CREATE INDEX `employments_person_idx` ON `employments` (`person_id`);
--> statement-breakpoint
CREATE TABLE `pay_period_closures` (
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
	CONSTRAINT "pay_period_closures_period_ck" CHECK("pay_period_closures"."period_end" > "pay_period_closures"."period_start"),
	CONSTRAINT "pay_period_closures_sequence_ck" CHECK("pay_period_closures"."sequence_no" > 0),
	CONSTRAINT "pay_period_closures_predecessor_ck" CHECK(("pay_period_closures"."sequence_no" = 1 and "pay_period_closures"."prev_closure_hash" is null)
  or ("pay_period_closures"."sequence_no" > 1 and "pay_period_closures"."prev_closure_hash" is not null)),
	CONSTRAINT "pay_period_closures_hash_ck" CHECK(length("pay_period_closures"."closure_hash") = 64 and "pay_period_closures"."closure_hash" not glob '*[^0-9A-F]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_chain_position_uq` ON `pay_period_closures` (`node_id`,`sequence_no`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_period_closures_period_uq` ON `pay_period_closures` (`period_start`,`period_end`);
--> statement-breakpoint
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
CREATE TABLE `roster_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`published_at` text,
	`published_by_person_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "roster_versions_period_ck" CHECK("roster_versions"."period_end" >= "roster_versions"."period_start"),
	CONSTRAINT "roster_versions_publish_shape_ck" CHECK(("roster_versions"."status" = 'draft') = ("roster_versions"."published_at" is null)),
	CONSTRAINT "roster_versions_status_ck" CHECK("roster_versions"."status" in ('draft', 'published', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX `roster_versions_location_idx` ON `roster_versions` (`location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_versions_published_period_uq` ON `roster_versions` (`location_id`,`period_start`,`period_end`) WHERE "roster_versions"."status" = 'published';
--> statement-breakpoint
CREATE TABLE `shift_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by_person_id` text NOT NULL,
	`from_shift_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`to_shift_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`decided_by_person_id` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`requested_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shift_swaps_status_ck" CHECK("shift_swaps"."status" in ('requested', 'accepted', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `shift_swaps_from_shift_idx` ON `shift_swaps` (`from_shift_id`);
--> statement-breakpoint
CREATE INDEX `shift_swaps_requested_by_person_idx` ON `shift_swaps` (`requested_by_person_id`);
--> statement-breakpoint
CREATE INDEX `shift_swaps_to_person_idx` ON `shift_swaps` (`to_person_id`);
--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`weekday` integer NOT NULL,
	`starts_minute` integer NOT NULL,
	`ends_minute` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shift_templates_label_ck" CHECK(length("shift_templates"."label") > 0),
	CONSTRAINT "shift_templates_weekday_ck" CHECK("shift_templates"."weekday" between 0 and 6),
	CONSTRAINT "shift_templates_starts_minute_ck" CHECK("shift_templates"."starts_minute" between 0 and 1440),
	CONSTRAINT "shift_templates_ends_minute_ck" CHECK("shift_templates"."ends_minute" between 0 and 1440)
);
--> statement-breakpoint
CREATE INDEX `shift_templates_location_idx` ON `shift_templates` (`location_id`);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`starts_offset_minutes` integer NOT NULL,
	`ends_at` text NOT NULL,
	`ends_offset_minutes` integer NOT NULL,
	`roster_version_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`roster_version_id`) REFERENCES `roster_versions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shifts_starts_offset_ck" CHECK("shifts"."starts_offset_minutes" between -840 and 840),
	CONSTRAINT "shifts_ends_offset_ck" CHECK("shifts"."ends_offset_minutes" between -840 and 840),
	CONSTRAINT "shifts_interval_ck" CHECK("shifts"."ends_at" > "shifts"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `shifts_person_starts_idx` ON `shifts` (`person_id`,`starts_at`);
--> statement-breakpoint
CREATE INDEX `shifts_roster_version_idx` ON `shifts` (`roster_version_id`);
--> statement-breakpoint
CREATE TABLE `time_entries` (
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
	CONSTRAINT "time_entries_author_kind_ck" CHECK("time_entries"."author_kind" is null or "time_entries"."author_kind" in ('worker','manager','automatic')),
	CONSTRAINT "time_entries_correction_direction_ck" CHECK("time_entries"."correction_direction" is null or "time_entries"."correction_direction" in ('worker_request','manager_proposal')),
	CONSTRAINT "time_entries_missing_entry_kind_ck" CHECK("time_entries"."missing_entry_kind" is null or "time_entries"."missing_entry_kind" in ('in','out','break_start','break_end')),
	CONSTRAINT "time_entries_author_ck" CHECK(coalesce(("time_entries"."author_kind" = 'automatic' and "time_entries"."recorded_by_person_id" is null)
      or ("time_entries"."author_kind" is null and "time_entries"."recorded_by_person_id" is not null)
      or ("time_entries"."author_kind" in ('worker','manager') and "time_entries"."recorded_by_person_id" is not null), 0)),
	CONSTRAINT "time_entries_event_offset_ck" CHECK("time_entries"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "time_entries_correction_shape_ck" CHECK(("time_entries"."author_kind" is null and "time_entries"."correction_direction" is null
          and "time_entries"."missing_entry_kind" is null and "time_entries"."responds_to_entry_id" is null
          and "time_entries"."pay_period_closure_id" is null
          and "time_entries"."entry_kind" <> 'confirmation'
          and (("time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
            and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null)
            or ("time_entries"."corrects_entry_id" is not null and "time_entries"."correction_reason" is not null
            and "time_entries"."correction_status" is not null and "time_entries"."correction_actor_id" is not null)))
        or ("time_entries"."entry_kind" in ('in','out','break_start','break_end')
          and "time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
          and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null
          and "time_entries"."correction_direction" is null and "time_entries"."missing_entry_kind" is null
          and "time_entries"."responds_to_entry_id" is null and "time_entries"."pay_period_closure_id" is null)
        or ("time_entries"."entry_kind" = 'confirmation' and "time_entries"."responds_to_entry_id" is not null
          and "time_entries"."author_kind" is not null
          and (("time_entries"."author_kind" = 'worker' and "time_entries"."pay_period_closure_id" is null)
            or ("time_entries"."author_kind" = 'automatic' and "time_entries"."pay_period_closure_id" is not null))
          and "time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
          and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null
          and "time_entries"."correction_direction" is null and "time_entries"."missing_entry_kind" is null)
        or ("time_entries"."entry_kind" = 'correction' and "time_entries"."correction_reason" is not null
          and "time_entries"."correction_status" is not null and "time_entries"."correction_actor_id" is not null
          and "time_entries"."pay_period_closure_id" is null
          and (("time_entries"."corrects_entry_id" is not null and "time_entries"."missing_entry_kind" is null)
            or ("time_entries"."corrects_entry_id" is null and "time_entries"."missing_entry_kind" is not null
              and "time_entries"."correction_direction" is not null and "time_entries"."author_kind" is not null)))),
	CONSTRAINT "time_entries_entry_hash_ck" CHECK(length("time_entries"."entry_hash") = 64 and "time_entries"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "time_entries_sequence_no_ck" CHECK("time_entries"."sequence_no" > 0),
	CONSTRAINT "time_entries_chaining_ck" CHECK(("time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is null)
          or (not "time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is not null)),
	CONSTRAINT "time_entries_event_at_second_ck" CHECK("time_entries"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_recorded_at_second_ck" CHECK("time_entries"."recorded_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_entry_kind_ck" CHECK("time_entries"."entry_kind" in ('in', 'out', 'break_start', 'break_end', 'correction', 'confirmation')),
	CONSTRAINT "time_entries_captured_by_source_ck" CHECK("time_entries"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "time_entries_captured_by_source_device_ck" CHECK(("time_entries"."captured_by_source" = 'device') = ("time_entries"."captured_by_device_id" is not null)),
	CONSTRAINT "time_entries_correction_status_ck" CHECK("time_entries"."correction_status" in ('requested', 'approved', 'declined', 'disputed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_person_entry_uq` ON `time_entries` (`id`,`person_id`);
--> statement-breakpoint
CREATE INDEX `time_entries_person_event_idx` ON `time_entries` (`person_id`,`event_at`);
--> statement-breakpoint
CREATE INDEX `time_entries_person_chain_idx` ON `time_entries` (`person_id`,`node_id`,`sequence_no`);
--> statement-breakpoint
CREATE INDEX `time_entries_corrects_entry_idx` ON `time_entries` (`corrects_entry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`sequence_no`);
--> statement-breakpoint
CREATE TABLE `workforce_chains` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_id` text,
	`last_entry_hash` text,
	`last_recorded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workforce_chains_pointer_ck" CHECK(("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_entry_hash" is null)
          and ("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_recorded_at" is null))
);
--> statement-breakpoint
CREATE TABLE `person_staff_roles` (
	`person_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	PRIMARY KEY(`person_id`, `staff_role_id`),
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shift_assignments` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`station_id` text,
	`staff_role_id` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shift_assignments_one_area_ck" CHECK(("shift_assignments"."department_id" is null) <> ("shift_assignments"."station_id" is null))
);
--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'grey' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_roles_name_ck" CHECK(trim("staff_roles"."name") <> ''),
	CONSTRAINT "staff_roles_colour_ck" CHECK("staff_roles"."colour" in ('red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'purple', 'magenta', 'pink', 'brown', 'grey'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_roles_location_name_key` ON `staff_roles` (`location_id`,`name`);
--> statement-breakpoint
CREATE TABLE `staffing_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`day_id` text NOT NULL,
	`staff_role_id` text NOT NULL,
	`headcount` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `staffing_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_role_id`) REFERENCES `staff_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staffing_blocks_headcount_ck" CHECK("staffing_blocks"."headcount" between 1 and 50),
	CONSTRAINT "staffing_blocks_step_ck" CHECK(substr("staffing_blocks"."starts_at", 4, 2) in ('00', '15', '30', '45') and substr("staffing_blocks"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `staffing_blocks_day_idx` ON `staffing_blocks` (`day_id`,`starts_at`);
--> statement-breakpoint
CREATE TABLE `staffing_days` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`station_id` text,
	`season_id` text,
	`weekday` integer,
	`special_day_date_id` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`special_day_date_id`) REFERENCES `special_day_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "staffing_days_one_area_ck" CHECK(("staffing_days"."department_id" is null) <> ("staffing_days"."station_id" is null)),
	CONSTRAINT "staffing_days_one_day_ck" CHECK(("staffing_days"."season_id" is null) <> ("staffing_days"."special_day_date_id" is null) and ("staffing_days"."season_id" is null) = ("staffing_days"."weekday" is null)),
	CONSTRAINT "staffing_days_weekday_ck" CHECK("staffing_days"."weekday" is null or "staffing_days"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_department_season_key` ON `staffing_days` (`department_id`,`season_id`,`weekday`) WHERE "staffing_days"."department_id" is not null and "staffing_days"."season_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_department_date_key` ON `staffing_days` (`department_id`,`special_day_date_id`) WHERE "staffing_days"."department_id" is not null and "staffing_days"."special_day_date_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_station_season_key` ON `staffing_days` (`station_id`,`season_id`,`weekday`) WHERE "staffing_days"."station_id" is not null and "staffing_days"."season_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `staffing_days_station_date_key` ON `staffing_days` (`station_id`,`special_day_date_id`) WHERE "staffing_days"."station_id" is not null and "staffing_days"."special_day_date_id" is not null;
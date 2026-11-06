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
CREATE UNIQUE INDEX `attendance_day_work_scope_uq` ON `attendance_day_work` (`location_id`,`business_day`);--> statement-breakpoint
CREATE INDEX `attendance_day_work_due_idx` ON `attendance_day_work` (`location_id`,`next_due_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `attendance_mail_question_uq` ON `attendance_mail` (`question_id`);--> statement-breakpoint
CREATE INDEX `attendance_mail_due_idx` ON `attendance_mail` (`status`,`next_attempt_at`,`id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `attendance_operation_facts_source_uq` ON `attendance_operation_facts` (`source`,`key`);--> statement-breakpoint
CREATE INDEX `attendance_operation_facts_day_idx` ON `attendance_operation_facts` (`location_id`,`business_day`,`person_id`,`at`);--> statement-breakpoint
CREATE INDEX `attendance_operation_facts_pending_idx` ON `attendance_operation_facts` (`outcome`,`sequence`);--> statement-breakpoint
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
	FOREIGN KEY (`open_entry_id`,`person_id`,`location_id`) REFERENCES `time_entries`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`automatic_entry_id`,`person_id`,`location_id`) REFERENCES `time_entries`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by_entry_id`,`person_id`,`location_id`) REFERENCES `time_entries`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_question_id`,`person_id`,`location_id`) REFERENCES `attendance_questions`(`id`,`person_id`,`location_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_questions_kind_ck" CHECK("attendance_questions"."kind" in ('automatic-out', 'missing-times')),
	CONSTRAINT "attendance_questions_bounds_ck" CHECK("attendance_questions"."end_at" > "attendance_questions"."start_at"),
	CONSTRAINT "attendance_questions_activity_ck" CHECK(("attendance_questions"."active" = 1 and "attendance_questions"."inactive_reason" is null and "attendance_questions"."canonical_question_id" is null) or ("attendance_questions"."active" = 0 and "attendance_questions"."inactive_reason" is not null)),
	CONSTRAINT "attendance_questions_canonical_ck" CHECK("attendance_questions"."canonical_question_id" is null or "attendance_questions"."canonical_question_id" <> "attendance_questions"."id"),
	CONSTRAINT "attendance_questions_automatic_ck" CHECK(("attendance_questions"."kind" = 'automatic-out' and "attendance_questions"."open_entry_id" is not null and "attendance_questions"."automatic_entry_id" is not null and json_array_length("attendance_questions"."missing_kinds") = 0) or ("attendance_questions"."kind" = 'missing-times' and "attendance_questions"."automatic_entry_id" is null and json_array_length("attendance_questions"."missing_kinds") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_shift_uq` ON `attendance_questions` (`person_id`,`location_id`,`shift_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_questions_subject_uq` ON `attendance_questions` (`id`,`person_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `attendance_questions_own_idx` ON `attendance_questions` (`person_id`,`active`,`resolved_by_entry_id`,`business_day`,`start_at`,`id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `attendance_source_state_scope_uq` ON `attendance_source_state` (`location_id`,`source`,`record_kind`,`key`);--> statement-breakpoint
CREATE INDEX `attendance_source_state_watch_idx` ON `attendance_source_state` (`location_id`,`record_kind`,`next_due_at`,`id`);
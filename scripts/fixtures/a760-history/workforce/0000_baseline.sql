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
CREATE INDEX `absences_person_idx` ON `absences` (`person_id`,`starts_on`);--> statement-breakpoint
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
CREATE INDEX `availability_person_idx` ON `availability` (`person_id`);--> statement-breakpoint
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
CREATE INDEX `employments_person_idx` ON `employments` (`person_id`);--> statement-breakpoint
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
CREATE INDEX `roster_versions_location_idx` ON `roster_versions` (`location_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `roster_versions_published_period_uq` ON `roster_versions` (`location_id`,`period_start`,`period_end`) WHERE "roster_versions"."status" = 'published';--> statement-breakpoint
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
CREATE INDEX `shift_swaps_from_shift_idx` ON `shift_swaps` (`from_shift_id`);--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`label` text NOT NULL,
	`weekday` integer NOT NULL,
	`starts_minute` integer NOT NULL,
	`ends_minute` integer NOT NULL,
	`role` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shift_templates_label_ck" CHECK(length("shift_templates"."label") > 0),
	CONSTRAINT "shift_templates_weekday_ck" CHECK("shift_templates"."weekday" between 0 and 6),
	CONSTRAINT "shift_templates_starts_minute_ck" CHECK("shift_templates"."starts_minute" between 0 and 1440),
	CONSTRAINT "shift_templates_ends_minute_ck" CHECK("shift_templates"."ends_minute" between 0 and 1440)
);
--> statement-breakpoint
CREATE INDEX `shift_templates_location_idx` ON `shift_templates` (`location_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`starts_offset_minutes` integer NOT NULL,
	`ends_at` text NOT NULL,
	`ends_offset_minutes` integer NOT NULL,
	`role` text,
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
CREATE INDEX `shifts_person_starts_idx` ON `shifts` (`person_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `shifts_roster_version_idx` ON `shifts` (`roster_version_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
	`node_id` text NOT NULL,
	`entry_kind` text NOT NULL,
	`event_at` text NOT NULL,
	`event_offset_minutes` integer NOT NULL,
	`captured_by_till_id` text,
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
	FOREIGN KEY (`captured_by_till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`correction_actor_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "time_entries_event_offset_ck" CHECK("time_entries"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "time_entries_correction_shape_ck" CHECK(("time_entries"."corrects_entry_id" is null and "time_entries"."correction_reason" is null
             and "time_entries"."correction_status" is null and "time_entries"."correction_actor_id" is null)
          or ("time_entries"."corrects_entry_id" is not null and "time_entries"."correction_reason" is not null
             and "time_entries"."correction_status" is not null and "time_entries"."correction_actor_id" is not null)),
	CONSTRAINT "time_entries_entry_hash_ck" CHECK(length("time_entries"."entry_hash") = 64 and "time_entries"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "time_entries_sequence_no_ck" CHECK("time_entries"."sequence_no" > 0),
	CONSTRAINT "time_entries_chaining_ck" CHECK(("time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is null)
          or (not "time_entries"."is_first_entry" and "time_entries"."prev_entry_hash" is not null)),
	CONSTRAINT "time_entries_event_at_second_ck" CHECK("time_entries"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_recorded_at_second_ck" CHECK("time_entries"."recorded_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "time_entries_entry_kind_ck" CHECK("time_entries"."entry_kind" in ('in', 'out', 'break_start', 'break_end', 'correction')),
	CONSTRAINT "time_entries_correction_status_ck" CHECK("time_entries"."correction_status" in ('requested', 'approved'))
);
--> statement-breakpoint
CREATE INDEX `time_entries_person_event_idx` ON `time_entries` (`person_id`,`event_at`);--> statement-breakpoint
CREATE INDEX `time_entries_corrects_entry_idx` ON `time_entries` (`corrects_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`location_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `workforce_chains` (
	`node_id` text NOT NULL,
	`location_id` text NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_id` text,
	`last_entry_hash` text,
	`last_recorded_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `location_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workforce_chains_pointer_ck" CHECK(("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_entry_hash" is null)
          and ("workforce_chains"."last_entry_id" is null) = ("workforce_chains"."last_recorded_at" is null))
);

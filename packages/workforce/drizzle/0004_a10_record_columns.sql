ALTER TABLE `time_entries` ADD `author_kind` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `correction_direction` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `missing_entry_kind` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `responds_to_entry_id` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `pay_period_closure_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_subject_identity_uq` ON `time_entries` (`id`,`person_id`,`location_id`);
CREATE TABLE `attendance_response_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by_person_id` text NOT NULL,
	`authorized_by_person_id` text NOT NULL,
	`person_id` text NOT NULL,
	`location_id` text NOT NULL,
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
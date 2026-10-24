ALTER TABLE `departments` ADD `late_send_needs_manager` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `working_line_contexts` ADD `late_period_name` text;--> statement-breakpoint
ALTER TABLE `working_line_contexts` ADD `late_confirmed_by` text;
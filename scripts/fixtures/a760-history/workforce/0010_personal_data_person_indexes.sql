CREATE INDEX `attendance_operation_facts_person_idx` ON `attendance_operation_facts` (`person_id`,`at`,`sequence`);--> statement-breakpoint
CREATE INDEX `shift_swaps_requested_by_person_idx` ON `shift_swaps` (`requested_by_person_id`);--> statement-breakpoint
CREATE INDEX `shift_swaps_to_person_idx` ON `shift_swaps` (`to_person_id`);
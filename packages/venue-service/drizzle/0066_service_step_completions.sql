CREATE TABLE `service_step_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`step_id` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `service_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_step_completions_party_idx` ON `service_step_completions` (`party_id`,`step_id`);--> statement-breakpoint
CREATE INDEX `service_step_completions_step_idx` ON `service_step_completions` (`step_id`);
CREATE TABLE `filing_case_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`action_key` text NOT NULL,
	`kind` text NOT NULL,
	`person_id` text NOT NULL,
	`action` text NOT NULL,
	`remedy_registro_id` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remedy_registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "filing_case_events_kind_ck" CHECK("filing_case_events"."kind" in ('note', 'resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filing_case_events_action_key_uq` ON `filing_case_events` (`action_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `filing_case_events_one_resolution_uq` ON `filing_case_events` (`case_id`) WHERE "filing_case_events"."kind" = 'resolved';--> statement-breakpoint
CREATE INDEX `filing_case_events_case_idx` ON `filing_case_events` (`case_id`);--> statement-breakpoint
CREATE TABLE `filing_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`cause` text NOT NULL,
	`evidence` text NOT NULL,
	`opened_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "filing_cases_cause_ck" CHECK("filing_cases"."cause" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filing_cases_registro_uq` ON `filing_cases` (`registro_id`);
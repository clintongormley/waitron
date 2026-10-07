PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoice_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`print_job_id` text,
	`request_key` text NOT NULL,
	`medium` text NOT NULL,
	`designation` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generation` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`recipient` text,
	`consent` text,
	`person_id` text,
	`created_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`completed_at` text,
	`claim_token_hash` text,
	`claimed_by` text,
	`claimed_agent_id` text,
	`claimed_at` text,
	`expired_at` text,
	`failure_code` text,
	`reported_outcome` text,
	`reported_at` text,
	`reported_failure_code` text,
	FOREIGN KEY (`print_job_id`) REFERENCES `print_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_deliveries_medium_ck" CHECK("__new_invoice_deliveries"."medium" in ('email', 'a4', 'receipt')),
	CONSTRAINT "invoice_deliveries_designation_ck" CHECK("__new_invoice_deliveries"."designation" in ('original', 'duplicate')),
	CONSTRAINT "invoice_deliveries_status_ck" CHECK("__new_invoice_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "invoice_deliveries_generation_ck" CHECK("__new_invoice_deliveries"."generation" > 0),
	CONSTRAINT "invoice_deliveries_attempts_ck" CHECK("__new_invoice_deliveries"."attempts" >= 0),
	CONSTRAINT "invoice_deliveries_person_ck" CHECK("__new_invoice_deliveries"."person_id" is not null or "__new_invoice_deliveries"."medium" = 'receipt'),
	CONSTRAINT "invoice_deliveries_email_ck" CHECK(("__new_invoice_deliveries"."medium" = 'email') = ("__new_invoice_deliveries"."recipient" is not null and "__new_invoice_deliveries"."consent" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_deliveries`("id", "sale_id", "print_job_id", "request_key", "medium", "designation", "status", "generation", "attempts", "recipient", "consent", "person_id", "created_at", "next_attempt_at", "completed_at", "claim_token_hash", "claimed_by", "claimed_agent_id", "claimed_at", "expired_at", "failure_code", "reported_outcome", "reported_at", "reported_failure_code") SELECT "id", "sale_id", "print_job_id", "request_key", "medium", "designation", "status", "generation", "attempts", "recipient", "consent", "person_id", "created_at", "next_attempt_at", "completed_at", "claim_token_hash", "claimed_by", "claimed_agent_id", "claimed_at", "expired_at", "failure_code", "reported_outcome", "reported_at", "reported_failure_code" FROM `invoice_deliveries`;--> statement-breakpoint
DROP TABLE `invoice_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_invoice_deliveries` RENAME TO `invoice_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_print_job_uq` ON `invoice_deliveries` (`print_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_request_uq` ON `invoice_deliveries` (`sale_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_generation_uq` ON `invoice_deliveries` (`sale_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_active_uq` ON `invoice_deliveries` (`sale_id`) WHERE "invoice_deliveries"."status" in ('queued', 'sending');
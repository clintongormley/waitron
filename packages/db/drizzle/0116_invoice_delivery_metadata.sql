CREATE TABLE `invoice_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`request_key` text NOT NULL,
	`medium` text NOT NULL,
	`designation` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generation` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`recipient` text,
	`consent` text,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`completed_at` text,
	`claim_token_hash` text,
	`claimed_by` text,
	`claimed_at` text,
	`expired_at` text,
	`failure_code` text,
	`reported_outcome` text,
	`reported_at` text,
	`reported_failure_code` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_deliveries_medium_ck" CHECK("invoice_deliveries"."medium" in ('email', 'a4', 'receipt')),
	CONSTRAINT "invoice_deliveries_designation_ck" CHECK("invoice_deliveries"."designation" in ('original', 'duplicate')),
	CONSTRAINT "invoice_deliveries_status_ck" CHECK("invoice_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "invoice_deliveries_generation_ck" CHECK("invoice_deliveries"."generation" > 0),
	CONSTRAINT "invoice_deliveries_attempts_ck" CHECK("invoice_deliveries"."attempts" >= 0),
	CONSTRAINT "invoice_deliveries_email_ck" CHECK(("invoice_deliveries"."medium" = 'email') = ("invoice_deliveries"."recipient" is not null and "invoice_deliveries"."consent" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_request_uq` ON `invoice_deliveries` (`sale_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_generation_uq` ON `invoice_deliveries` (`sale_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_active_uq` ON `invoice_deliveries` (`sale_id`) WHERE "invoice_deliveries"."status" in ('queued', 'sending');
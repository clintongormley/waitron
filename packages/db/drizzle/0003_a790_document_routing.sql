CREATE TABLE `document_delivery_requests` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`request_key` text NOT NULL,
	`sale_id` text NOT NULL,
	`person_id` text NOT NULL,
	`session_id` text NOT NULL,
	`document` text NOT NULL,
	`context` text NOT NULL,
	`canonical_intent` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`accepted_result` text,
	`acceptance_order` integer,
	`refusal_code` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`, `request_key`),
	CONSTRAINT "document_delivery_requests_status_ck" CHECK("document_delivery_requests"."status" in ('prepared', 'accepted', 'refused', 'fenced')),
	CONSTRAINT "document_delivery_requests_document_ck" CHECK("document_delivery_requests"."document" in ('receipt', 'invoice')),
	CONSTRAINT "document_delivery_requests_outcome_ck" CHECK(("document_delivery_requests"."status" = 'accepted' and "document_delivery_requests"."accepted_result" is not null and "document_delivery_requests"."acceptance_order" is not null) or ("document_delivery_requests"."status" <> 'accepted' and "document_delivery_requests"."accepted_result" is null and "document_delivery_requests"."acceptance_order" is null)),
	CONSTRAINT "document_delivery_requests_order_ck" CHECK("document_delivery_requests"."acceptance_order" is null or ("document_delivery_requests"."acceptance_order" between 1 and 9007199254740991 and "document_delivery_requests"."acceptance_order" = cast("document_delivery_requests"."acceptance_order" as integer)))
);
--> statement-breakpoint
CREATE INDEX `document_delivery_requests_recovery_idx` ON `document_delivery_requests` (`node_id`,`recovery_epoch`,`sale_id`,`acknowledged`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_delivery_requests_acceptance_order_idx` ON `document_delivery_requests` (`node_id`,`recovery_epoch`,`acceptance_order`);--> statement-breakpoint
CREATE TABLE `document_delivery_sequences` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`next_acceptance_order` integer NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`),
	CONSTRAINT "document_delivery_sequences_order_ck" CHECK("document_delivery_sequences"."next_acceptance_order" between 1 and 9007199254740991 and "document_delivery_sequences"."next_acceptance_order" = cast("document_delivery_sequences"."next_acceptance_order" as integer))
);
--> statement-breakpoint
CREATE TABLE `device_invoice_save_operations` (
	`node_id` text NOT NULL,
	`recovery_epoch` text NOT NULL,
	`save_id` text NOT NULL,
	`device_id` text NOT NULL,
	`person_id` text NOT NULL,
	`session_id` text NOT NULL,
	`context` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`selection` text NOT NULL,
	`management_edit` text,
	`canonical_intent` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`saved_result` text,
	`refusal_code` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `recovery_epoch`, `save_id`),
	CONSTRAINT "device_invoice_save_operations_status_ck" CHECK("device_invoice_save_operations"."status" in ('prepared', 'saved', 'refused', 'fenced')),
	CONSTRAINT "device_invoice_save_operations_revision_ck" CHECK("device_invoice_save_operations"."expected_revision" between 0 and 9007199254740991 and "device_invoice_save_operations"."expected_revision" = cast("device_invoice_save_operations"."expected_revision" as integer))
);
--> statement-breakpoint
CREATE INDEX `device_invoice_save_operations_recovery_idx` ON `device_invoice_save_operations` (`node_id`,`recovery_epoch`,`device_id`,`acknowledged`);--> statement-breakpoint
CREATE TABLE `device_invoice_revisions` (
	`device_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "device_invoice_revisions_revision_ck" CHECK("device_invoice_revisions"."revision" between 0 and 9007199254740991 and "device_invoice_revisions"."revision" = cast("device_invoice_revisions"."revision" as integer))
);
--> statement-breakpoint
CREATE TABLE `document_page_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`page_printer_id` text NOT NULL,
	`language` text NOT NULL,
	`designation` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
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
	`printer_hold` text,
	`receipt_handover` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "document_page_jobs_status_ck" CHECK("document_page_jobs"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "document_page_jobs_designation_ck" CHECK("document_page_jobs"."designation" in ('original', 'duplicate')),
	CONSTRAINT "document_page_jobs_outcome_ck" CHECK("document_page_jobs"."reported_outcome" in ('sent', 'failed', 'unknown')),
	CONSTRAINT "document_page_jobs_generation_ck" CHECK("document_page_jobs"."generation" between 1 and 9007199254740991 and "document_page_jobs"."generation" = cast("document_page_jobs"."generation" as integer)),
	CONSTRAINT "document_page_jobs_attempts_ck" CHECK("document_page_jobs"."attempts" between 0 and 9007199254740991 and "document_page_jobs"."attempts" = cast("document_page_jobs"."attempts" as integer))
);
--> statement-breakpoint
CREATE INDEX `document_page_jobs_claim_idx` ON `document_page_jobs` (`page_printer_id`,`status`);--> statement-breakpoint
CREATE INDEX `document_page_jobs_sale_idx` ON `document_page_jobs` (`sale_id`);--> statement-breakpoint
CREATE TABLE `document_page_reprints` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`page_job_id` text NOT NULL,
	`person_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`page_job_id`) REFERENCES `document_page_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_page_reprints_job_uq` ON `document_page_reprints` (`page_job_id`);--> statement-breakpoint
CREATE INDEX `document_page_reprints_sale_idx` ON `document_page_reprints` (`sale_id`);
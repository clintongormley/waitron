CREATE TABLE `invoice_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`print_job_id` text,
	`page_printer_id` text,
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
	FOREIGN KEY (`page_printer_id`) REFERENCES `page_printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`claimed_agent_id`) REFERENCES `print_agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invoice_deliveries_medium_ck" CHECK("invoice_deliveries"."medium" in ('email', 'a4', 'receipt')),
	CONSTRAINT "invoice_deliveries_designation_ck" CHECK("invoice_deliveries"."designation" in ('original', 'duplicate')),
	CONSTRAINT "invoice_deliveries_status_ck" CHECK("invoice_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "invoice_deliveries_generation_ck" CHECK("invoice_deliveries"."generation" > 0),
	CONSTRAINT "invoice_deliveries_attempts_ck" CHECK("invoice_deliveries"."attempts" >= 0),
	CONSTRAINT "invoice_deliveries_person_ck" CHECK("invoice_deliveries"."person_id" is not null or "invoice_deliveries"."medium" = 'receipt'),
	CONSTRAINT "invoice_deliveries_email_ck" CHECK(("invoice_deliveries"."medium" = 'email') = ("invoice_deliveries"."recipient" is not null and "invoice_deliveries"."consent" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_print_job_uq` ON `invoice_deliveries` (`print_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_request_uq` ON `invoice_deliveries` (`sale_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_generation_uq` ON `invoice_deliveries` (`sale_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deliveries_active_uq` ON `invoice_deliveries` (`sale_id`) WHERE "invoice_deliveries"."status" in ('queued', 'sending');--> statement-breakpoint
CREATE TABLE `page_printers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`resource_path` text NOT NULL,
	`document_format` text NOT NULL,
	`supported_formats` text NOT NULL,
	`media` text NOT NULL,
	`resolution_dpi` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "page_printers_format_ck" CHECK("page_printers"."document_format" in ('application/pdf', 'image/pwg-raster', 'image/urf')),
	CONSTRAINT "page_printers_media_ck" CHECK("page_printers"."media" in ('iso_a4_210x297mm', 'na_letter_8.5x11in')),
	CONSTRAINT "page_printers_port_ck" CHECK("page_printers"."port" between 1 and 65535),
	CONSTRAINT "page_printers_resolution_ck" CHECK("page_printers"."resolution_dpi" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_printers_endpoint_uq` ON `page_printers` (`location_id`,`host`,`port`,`resource_path`);--> statement-breakpoint
ALTER TABLE `working_orders` ADD `invoice_delivery` text;
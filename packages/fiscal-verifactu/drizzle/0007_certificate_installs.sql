CREATE TABLE `fiscal_certificate_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`installed_at` text NOT NULL,
	`source` text NOT NULL,
	`person_id` text,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`organisation` text,
	`tax_id` text,
	`issuer` text,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`checked_endpoint` text,
	`checked_at` text,
	CONSTRAINT "fiscal_certificate_installs_source_ck" CHECK("fiscal_certificate_installs"."source" in ('setup', 'dashboard')),
	CONSTRAINT "fiscal_certificate_installs_kind_ck" CHECK("fiscal_certificate_installs"."kind" in ('sello', 'representante')),
	CONSTRAINT "fiscal_certificate_installs_dashboard_ck" CHECK("fiscal_certificate_installs"."source" = 'setup' or ("fiscal_certificate_installs"."person_id" is not null and "fiscal_certificate_installs"."checked_at" is not null and "fiscal_certificate_installs"."checked_endpoint" is not null))
);
--> statement-breakpoint
CREATE INDEX `fiscal_certificate_installs_node_idx` ON `fiscal_certificate_installs` (`node_id`,`installed_at`);--> statement-breakpoint
CREATE TABLE `fiscal_certificate_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`install_id` text NOT NULL,
	`stage` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text NOT NULL,
	`claimed_at` text NOT NULL,
	`reported_at` text,
	FOREIGN KEY (`install_id`) REFERENCES `fiscal_certificate_installs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fiscal_certificate_reminders_stage_ck" CHECK("fiscal_certificate_reminders"."stage" in ('warning', 'urgent', 'expired')),
	CONSTRAINT "fiscal_certificate_reminders_status_ck" CHECK("fiscal_certificate_reminders"."status" in ('claimed', 'sent', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_certificate_reminders_uq` ON `fiscal_certificate_reminders` (`install_id`,`stage`,`person_id`);
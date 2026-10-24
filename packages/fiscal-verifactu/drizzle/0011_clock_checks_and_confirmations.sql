CREATE TABLE `clock_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`node_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clock_checks_reason_ck" CHECK("clock_checks"."reason" in ('start', 'change', 'behind_chain', 'disagrees'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_checks_seq_uq` ON `clock_checks` (`seq`);--> statement-breakpoint
CREATE TABLE `clock_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`node_id` text NOT NULL,
	`box_clock_at` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`step_ms` integer NOT NULL,
	`source` text NOT NULL,
	`person_id` text,
	`reason` text NOT NULL,
	`proof` text NOT NULL,
	`check_id` text,
	`registro_id` text,
	`record_at` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_id`) REFERENCES `clock_checks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clock_confirmations_source_ck" CHECK("clock_confirmations"."source" in ('authority', 'devices', 'admin', 'elapsed')),
	CONSTRAINT "clock_confirmations_reason_ck" CHECK("clock_confirmations"."reason" in ('start', 'change', 'behind_chain', 'disagrees', 'unusable')),
	CONSTRAINT "clock_confirmations_person_ck" CHECK(("clock_confirmations"."source" = 'admin') = ("clock_confirmations"."person_id" is not null and length("clock_confirmations"."person_id") > 0)),
	CONSTRAINT "clock_confirmations_record_ck" CHECK(("clock_confirmations"."registro_id" is null) = ("clock_confirmations"."record_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_seq_uq` ON `clock_confirmations` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_check_uq` ON `clock_confirmations` (`check_id`);--> statement-breakpoint
CREATE INDEX `clock_confirmations_registro_idx` ON `clock_confirmations` (`registro_id`);
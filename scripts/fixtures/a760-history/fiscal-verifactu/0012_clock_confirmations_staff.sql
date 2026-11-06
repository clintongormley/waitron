PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clock_confirmations` (
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
	CONSTRAINT "clock_confirmations_source_ck" CHECK("__new_clock_confirmations"."source" in ('authority', 'devices', 'admin', 'staff', 'elapsed')),
	CONSTRAINT "clock_confirmations_reason_ck" CHECK("__new_clock_confirmations"."reason" in ('start', 'change', 'behind_chain', 'disagrees', 'unusable')),
	CONSTRAINT "clock_confirmations_person_ck" CHECK(("__new_clock_confirmations"."source" in ('admin', 'staff')) = ("__new_clock_confirmations"."person_id" is not null) and ("__new_clock_confirmations"."person_id" is null or length("__new_clock_confirmations"."person_id") > 0)),
	CONSTRAINT "clock_confirmations_record_ck" CHECK(("__new_clock_confirmations"."registro_id" is null) = ("__new_clock_confirmations"."record_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_clock_confirmations`("id", "seq", "node_id", "box_clock_at", "confirmed_at", "step_ms", "source", "person_id", "reason", "proof", "check_id", "registro_id", "record_at") SELECT "id", "seq", "node_id", "box_clock_at", "confirmed_at", "step_ms", "source", "person_id", "reason", "proof", "check_id", "registro_id", "record_at" FROM `clock_confirmations`;--> statement-breakpoint
DROP TABLE `clock_confirmations`;--> statement-breakpoint
ALTER TABLE `__new_clock_confirmations` RENAME TO `clock_confirmations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_seq_uq` ON `clock_confirmations` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `clock_confirmations_check_uq` ON `clock_confirmations` (`check_id`);--> statement-breakpoint
CREATE INDEX `clock_confirmations_registro_idx` ON `clock_confirmations` (`registro_id`);
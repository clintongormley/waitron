CREATE TABLE `fiscal_conflict_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`case_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`cause` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fiscal_conflict_evidence_attempt_ck" CHECK("fiscal_conflict_evidence"."attempt" > 0),
	CONSTRAINT "fiscal_conflict_evidence_cause_ck" CHECK("fiscal_conflict_evidence"."cause" in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_conflict_evidence_attempt_uq` ON `fiscal_conflict_evidence` (`registro_id`,`attempt`,`cause`);
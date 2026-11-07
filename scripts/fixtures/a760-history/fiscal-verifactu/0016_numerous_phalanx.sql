CREATE TABLE `fiscal_lookup_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`registro_id` text NOT NULL,
	`case_id` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`registro_id`) REFERENCES `registros_facturacion`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `filing_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_lookup_conflicts_registro_uq` ON `fiscal_lookup_conflicts` (`registro_id`);
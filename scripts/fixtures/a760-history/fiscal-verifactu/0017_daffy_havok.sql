CREATE TABLE `fiscal_series_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`sif_id` text NOT NULL,
	`series_id` text NOT NULL,
	`invoice_identity` text NOT NULL,
	`evidence` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_series_conflicts_invoice_uq` ON `fiscal_series_conflicts` (`sif_id`,`invoice_identity`);
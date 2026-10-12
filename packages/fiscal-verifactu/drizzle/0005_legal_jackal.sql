CREATE TABLE `fiscal_allocations` (
	`event_key` text PRIMARY KEY NOT NULL,
	`allocation_key` text NOT NULL,
	`node_id` text NOT NULL,
	`sif_id` text NOT NULL,
	`taxpayer_nif` text NOT NULL,
	`software_id` text NOT NULL,
	`environment` text NOT NULL,
	`installation_identity` text NOT NULL,
	`allocation` text NOT NULL,
	`approval` text NOT NULL,
	`bases` text NOT NULL,
	`result` text NOT NULL,
	`activated_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sif_id`) REFERENCES `registro_sif`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_allocation_uq` ON `fiscal_allocations` (`allocation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_allocations_identity_uq` ON `fiscal_allocations` (`taxpayer_nif`,`software_id`,`environment`,`installation_identity`);
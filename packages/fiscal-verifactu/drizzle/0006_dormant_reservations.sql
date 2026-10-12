CREATE TABLE `fiscal_reservations` (
	`event_key` text PRIMARY KEY NOT NULL,
	`allocation_key` text NOT NULL,
	`node_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`taxpayer_nif` text NOT NULL,
	`software_id` text NOT NULL,
	`environment` text NOT NULL,
	`installation_identity` text NOT NULL,
	`evidence` text NOT NULL,
	`bases` text NOT NULL,
	`established_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_reservations_allocation_uq` ON `fiscal_reservations` (`allocation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_reservations_identity_uq` ON `fiscal_reservations` (`taxpayer_nif`,`software_id`,`environment`,`installation_identity`);
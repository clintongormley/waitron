CREATE TABLE `recovery_packs` (
	`node_id` text NOT NULL,
	`number` integer NOT NULL,
	`made_at` text NOT NULL,
	`made_by` text,
	`received_at` text,
	`parts` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_packs_node_number_uq` ON `recovery_packs` (`node_id`,`number`);
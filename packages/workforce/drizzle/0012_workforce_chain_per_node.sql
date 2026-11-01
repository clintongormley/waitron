PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workforce_chains` (
	`node_id` text PRIMARY KEY NOT NULL,
	`sequence_no` integer DEFAULT 0 NOT NULL,
	`last_entry_id` text,
	`last_entry_hash` text,
	`last_recorded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workforce_chains_pointer_ck" CHECK(("__new_workforce_chains"."last_entry_id" is null) = ("__new_workforce_chains"."last_entry_hash" is null)
          and ("__new_workforce_chains"."last_entry_id" is null) = ("__new_workforce_chains"."last_recorded_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_workforce_chains`("node_id", "sequence_no", "last_entry_id", "last_entry_hash", "last_recorded_at", "updated_at") SELECT "node_id", "sequence_no", "last_entry_id", "last_entry_hash", "last_recorded_at", "updated_at" FROM `workforce_chains`;--> statement-breakpoint
DROP TABLE `workforce_chains`;--> statement-breakpoint
ALTER TABLE `__new_workforce_chains` RENAME TO `workforce_chains`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX `time_entries_person_chain_idx`;--> statement-breakpoint
DROP INDEX `time_entries_chain_position_uq`;--> statement-breakpoint
CREATE INDEX `time_entries_person_chain_idx` ON `time_entries` (`person_id`,`node_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_chain_position_uq` ON `time_entries` (`node_id`,`sequence_no`);
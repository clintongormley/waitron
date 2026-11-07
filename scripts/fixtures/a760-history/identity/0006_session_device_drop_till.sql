PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`device_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sessions_token_hash_ck" CHECK(length("__new_sessions"."token_hash") = 64)
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "token_hash", "person_id", "device_id", "opened_at", "ended_at") SELECT "id", "token_hash", "person_id", "device_id", "opened_at", "ended_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sessions_open_idx` ON `sessions` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);
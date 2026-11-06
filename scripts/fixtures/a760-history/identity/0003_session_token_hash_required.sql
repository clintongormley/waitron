PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_management_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT "management_sessions_token_hash_ck" CHECK(length("__new_management_sessions"."token_hash") = 64)
);
--> statement-breakpoint
INSERT INTO `__new_management_sessions`("id", "token_hash", "person_id", "created_at", "last_seen_at", "ended_at") SELECT "id", "token_hash", "person_id", "created_at", "last_seen_at", "ended_at" FROM `management_sessions`;--> statement-breakpoint
DROP TABLE `management_sessions`;--> statement-breakpoint
ALTER TABLE `__new_management_sessions` RENAME TO `management_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `management_sessions_open_idx` ON `management_sessions` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `management_sessions_token_hash_uq` ON `management_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`person_id` text NOT NULL,
	`till_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT "sessions_token_hash_ck" CHECK(length("__new_sessions"."token_hash") = 64)
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "token_hash", "person_id", "till_id", "opened_at", "ended_at") SELECT "id", "token_hash", "person_id", "till_id", "opened_at", "ended_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `sessions_open_idx` ON `sessions` (`till_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_parties` (
	`id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`merged_into_party_id` text,
	`bill_requested_at` text,
	`name` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`table_names` text,
	FOREIGN KEY (`merged_into_party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "parties_state_ck" CHECK("__new_parties"."state" in ('open', 'closed')),
	CONSTRAINT "parties_guest_count_ck" CHECK("__new_parties"."guest_count" is null or "__new_parties"."guest_count" >= 1),
	CONSTRAINT "parties_closed_at_ck" CHECK(("__new_parties"."state" = 'open') = ("__new_parties"."closed_at" is null)),
	CONSTRAINT "parties_merged_into_ck" CHECK("__new_parties"."merged_into_party_id" is null or ("__new_parties"."merged_into_party_id" <> "__new_parties"."id" and "__new_parties"."state" = 'closed'))
);
--> statement-breakpoint
INSERT INTO `__new_parties`("id", "guest_count", "state", "opened_at", "opened_by", "closed_at", "closed_by", "merged_into_party_id", "bill_requested_at", "name", "revision", "table_names") SELECT "id", "guest_count", "state", "opened_at", "opened_by", "closed_at", "closed_by", "merged_into_party_id", "bill_requested_at", "name", "revision", "table_names" FROM `parties`;--> statement-breakpoint
DROP TABLE `parties`;--> statement-breakpoint
ALTER TABLE `__new_parties` RENAME TO `parties`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `parties_merged_into_idx` ON `parties` (`merged_into_party_id`);
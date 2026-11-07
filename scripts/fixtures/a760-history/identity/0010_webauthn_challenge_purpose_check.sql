PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`challenge` text NOT NULL,
	`created_at` text NOT NULL,
	`purpose` text NOT NULL,
	CONSTRAINT "webauthn_challenges_purpose_ck" CHECK("__new_webauthn_challenges"."purpose" in ('registration', 'login', 'check'))
);
--> statement-breakpoint
INSERT INTO `__new_webauthn_challenges`("id", "person_id", "challenge", "created_at", "purpose") SELECT "id", "person_id", "challenge", "created_at", "purpose" FROM `webauthn_challenges`;--> statement-breakpoint
DROP TABLE `webauthn_challenges`;--> statement-breakpoint
ALTER TABLE `__new_webauthn_challenges` RENAME TO `webauthn_challenges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
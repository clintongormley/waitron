CREATE TABLE `google_oidc_states` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`mode` text NOT NULL,
	`state_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "google_oidc_states_mode_ck" CHECK("google_oidc_states"."mode" in ('login', 'link')),
	CONSTRAINT "google_oidc_states_state_hash_ck" CHECK(length("google_oidc_states"."state_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE `management_account_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`purpose` text NOT NULL,
	`target_email` text,
	`token_hash` text NOT NULL,
	`code_hash` text,
	`code_expires_at` text,
	`code_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "management_account_actions_purpose_ck" CHECK("management_account_actions"."purpose" in ('invitation', 'password_reset', 'email_change')),
	CONSTRAINT "management_account_actions_target_email_ck" CHECK(("management_account_actions"."purpose" = 'email_change') = ("management_account_actions"."target_email" is not null)),
	CONSTRAINT "management_account_actions_token_hash_ck" CHECK(length("management_account_actions"."token_hash") = 64),
	CONSTRAINT "management_account_actions_code_hash_ck" CHECK("management_account_actions"."code_hash" is null or length("management_account_actions"."code_hash") = 64),
	CONSTRAINT "management_account_actions_code_attempts_ck" CHECK("management_account_actions"."code_attempts" >= 0),
	CONSTRAINT "management_account_actions_expiry_ck" CHECK("management_account_actions"."expires_at" > "management_account_actions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_account_actions_token_hash_uq` ON `management_account_actions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `management_account_actions_person_idx` ON `management_account_actions` (`person_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `management_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `management_sessions_open_idx` ON `management_sessions` (`person_id`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`first_names` text,
	`last_names` text,
	`telephone` text,
	`pin_hash` text,
	`password_hash` text,
	`totp_secret` text,
	`locale` text,
	`passkey_offered_at` text,
	`email` text,
	`pending_email` text,
	`email_verified_at` text,
	`google_subject` text,
	`role` text DEFAULT 'staff' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "persons_display_name_ck" CHECK(length("persons"."display_name") > 0),
	CONSTRAINT "persons_first_names_ck" CHECK("persons"."first_names" is null or length("persons"."first_names") > 0),
	CONSTRAINT "persons_last_names_ck" CHECK("persons"."last_names" is null or length("persons"."last_names") > 0),
	CONSTRAINT "persons_telephone_ck" CHECK("persons"."telephone" is null or length("persons"."telephone") > 0),
	CONSTRAINT "persons_pin_hash_ck" CHECK("persons"."pin_hash" is null or length("persons"."pin_hash") > 0),
	CONSTRAINT "persons_password_hash_ck" CHECK("persons"."password_hash" is null or length("persons"."password_hash") > 0),
	CONSTRAINT "persons_totp_secret_ck" CHECK("persons"."totp_secret" is null or length("persons"."totp_secret") > 0),
	CONSTRAINT "persons_locale_ck" CHECK("persons"."locale" is null or length("persons"."locale") > 0),
	CONSTRAINT "persons_pending_email_ck" CHECK("persons"."pending_email" is null or length("persons"."pending_email") > 0),
	CONSTRAINT "persons_role_ck" CHECK("persons"."role" in ('staff', 'supervisor', 'manager', 'admin')),
	CONSTRAINT "persons_status_ck" CHECK("persons"."status" in ('pending', 'active', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_email_uq` ON `persons` (lower("email")) WHERE "persons"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_live_display_name_uq` ON `persons` (lower(trim("display_name"))) WHERE "persons"."status" <> 'suspended';--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_google_subject_uq` ON `persons` (`google_subject`) WHERE "persons"."google_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `persons_tenant_pending_email_uq` ON `persons` (lower("pending_email")) WHERE "persons"."pending_email" is not null;--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recovery_codes_hash_ck" CHECK(length("recovery_codes"."code_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_person_idx` ON `recovery_codes` (`person_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`till_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `sessions_open_idx` ON `sessions` (`till_id`);--> statement-breakpoint
CREATE TABLE `totp_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "totp_enrollments_secret_ck" CHECK(length("totp_enrollments"."encrypted_secret") > 0)
);
--> statement-breakpoint
CREATE INDEX `totp_enrollments_person_idx` ON `totp_enrollments` (`person_id`);--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`challenge` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `webauthn_credentials_person_idx` ON `webauthn_credentials` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_credential_id_uq` ON `webauthn_credentials` (`credential_id`);
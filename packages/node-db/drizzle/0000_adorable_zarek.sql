CREATE TABLE `node_mirror_link` (
	`node_id` text PRIMARY KEY NOT NULL,
	`relay_url` text NOT NULL,
	`box_hostname` text NOT NULL,
	`box_ca_pem` text NOT NULL,
	`origin_node_id` text NOT NULL,
	`adopted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_mode` (
	`node_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'primary' NOT NULL,
	`singleton_role` text DEFAULT 'primary' NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "node_mode_mode_ck" CHECK("node_mode"."mode" in ('primary', 'mirror')),
	CONSTRAINT "node_mode_singleton_role_ck" CHECK("node_mode"."singleton_role" in ('primary', 'secondary')),
	CONSTRAINT "node_mode_role_valid_ck" CHECK(not ("node_mode"."mode" = 'mirror' and "node_mode"."singleton_role" = 'primary'))
);
--> statement-breakpoint
CREATE TABLE `node_primary_key` (
	`node_id` text PRIMARY KEY NOT NULL,
	`primary_node_id` text NOT NULL,
	`public_key` text NOT NULL,
	`pinned_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_recovery_key` (
	`node_id` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`key_name` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_signing_key` (
	`node_id` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "node_signing_key_key_version_ck" CHECK("node_signing_key"."key_version" >= 1),
	CONSTRAINT "node_signing_key_iv_len_ck" CHECK(octet_length("node_signing_key"."iv") = 12),
	CONSTRAINT "node_signing_key_auth_tag_len_ck" CHECK(octet_length("node_signing_key"."auth_tag") = 16)
);

CREATE TABLE `node_handover_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`operation_id` text,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`envelope` text,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `node_handover_operations` (
	`node_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`role` text NOT NULL,
	`scenario` text NOT NULL,
	`source_node_id` text NOT NULL,
	`destination_node_id` text NOT NULL,
	`binding` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`waiting_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `operation_id`),
	CONSTRAINT "node_handover_operations_role_ck" CHECK("node_handover_operations"."role" in ('source', 'destination')),
	CONSTRAINT "node_handover_operations_scenario_ck" CHECK("node_handover_operations"."scenario" in ('controlled', 'emergency')),
	CONSTRAINT "node_handover_operations_state_ck" CHECK("node_handover_operations"."state" in ('prepared', 'source_stepped_down', 'filing_relinquished', 'source_superseded', 'copy_accepted', 'filing_assumed', 'emergency_declared', 'activated', 'return_pending', 'return_complete', 'return_abandoned', 'replaced', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_handover_one_open_uq` ON `node_handover_operations` (`node_id`) WHERE "node_handover_operations"."state" not in ('return_complete', 'return_abandoned', 'replaced', 'abandoned');--> statement-breakpoint
CREATE TABLE `node_handover_restriction` (
	`node_id` text PRIMARY KEY NOT NULL,
	`operation_id` text,
	`kind` text NOT NULL,
	`successor_node_id` text NOT NULL,
	`membership_term` integer NOT NULL,
	`recorded_at` text NOT NULL,
	CONSTRAINT "node_handover_restriction_kind_ck" CHECK("node_handover_restriction"."kind" in ('handed-over', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE `node_mirror_link` (
	`node_id` text PRIMARY KEY NOT NULL,
	`origin_url` text NOT NULL,
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
CREATE TABLE `node_pair_link` (
	`node_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`state` text NOT NULL,
	`peer_node_id` text NOT NULL,
	`peer_public_key` text NOT NULL,
	`store_url` text NOT NULL,
	`venue_id` text NOT NULL,
	`access_key_id` text NOT NULL,
	`secret_ciphertext` blob NOT NULL,
	`secret_iv` blob NOT NULL,
	`secret_auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`ring_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "node_pair_link_role_ck" CHECK("node_pair_link"."role" in ('streams', 'serves')),
	CONSTRAINT "node_pair_link_state_ck" CHECK(("node_pair_link"."role" = 'streams' and "node_pair_link"."state" in ('pending', 'streaming')) or ("node_pair_link"."role" = 'serves' and "node_pair_link"."state" in ('awaiting_copy', 'copied'))),
	CONSTRAINT "node_pair_link_key_version_ck" CHECK("node_pair_link"."key_version" >= 1),
	CONSTRAINT "node_pair_link_secret_iv_len_ck" CHECK(octet_length("node_pair_link"."secret_iv") = 12),
	CONSTRAINT "node_pair_link_secret_auth_tag_len_ck" CHECK(octet_length("node_pair_link"."secret_auth_tag") = 16)
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

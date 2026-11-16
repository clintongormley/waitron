CREATE TABLE `box` (
	`node_id` text PRIMARY KEY NOT NULL,
	`recovery_key_verifier` text,
	`recovery_key_name` text,
	`recovery_key_changed_at` text,
	`signing_key_ciphertext` blob,
	`signing_key_iv` blob,
	`signing_key_auth_tag` blob,
	`signing_key_version` integer,
	`signing_key_changed_at` text,
	`mode` text,
	`singleton_role` text,
	`role_changed_at` text,
	`mirror_origin_url` text,
	`mirror_box_hostname` text,
	`mirror_box_ca_pem` text,
	`mirror_origin_node_id` text,
	`mirror_adopted_at` text,
	`primary_node_id` text,
	`primary_public_key` text,
	`primary_pinned_at` text,
	CONSTRAINT "box_recovery_key_group_ck" CHECK(("box"."recovery_key_verifier" is null and "box"."recovery_key_name" is null and "box"."recovery_key_changed_at" is null) or ("box"."recovery_key_verifier" is not null and "box"."recovery_key_name" is not null and "box"."recovery_key_changed_at" is not null)),
	CONSTRAINT "box_signing_key_group_ck" CHECK(("box"."signing_key_ciphertext" is null and "box"."signing_key_iv" is null and "box"."signing_key_auth_tag" is null and "box"."signing_key_version" is null and "box"."signing_key_changed_at" is null) or ("box"."signing_key_ciphertext" is not null and "box"."signing_key_iv" is not null and "box"."signing_key_auth_tag" is not null and "box"."signing_key_version" is not null and "box"."signing_key_changed_at" is not null)),
	CONSTRAINT "box_signing_key_version_ck" CHECK("box"."signing_key_version" >= 1),
	CONSTRAINT "box_signing_key_iv_len_ck" CHECK(octet_length("box"."signing_key_iv") = 12),
	CONSTRAINT "box_signing_key_auth_tag_len_ck" CHECK(octet_length("box"."signing_key_auth_tag") = 16),
	CONSTRAINT "box_role_group_ck" CHECK(("box"."mode" is null and "box"."singleton_role" is null and "box"."role_changed_at" is null) or ("box"."mode" is not null and "box"."singleton_role" is not null and "box"."role_changed_at" is not null)),
	CONSTRAINT "box_mode_ck" CHECK("box"."mode" in ('primary', 'mirror')),
	CONSTRAINT "box_singleton_role_ck" CHECK("box"."singleton_role" in ('primary', 'secondary')),
	CONSTRAINT "box_role_valid_ck" CHECK(not ("box"."mode" = 'mirror' and "box"."singleton_role" = 'primary')),
	CONSTRAINT "box_mirror_group_ck" CHECK(("box"."mirror_origin_url" is null and "box"."mirror_box_hostname" is null and "box"."mirror_box_ca_pem" is null and "box"."mirror_origin_node_id" is null and "box"."mirror_adopted_at" is null) or ("box"."mirror_origin_url" is not null and "box"."mirror_box_hostname" is not null and "box"."mirror_box_ca_pem" is not null and "box"."mirror_origin_node_id" is not null and "box"."mirror_adopted_at" is not null)),
	CONSTRAINT "box_primary_key_group_ck" CHECK(("box"."primary_node_id" is null and "box"."primary_public_key" is null and "box"."primary_pinned_at" is null) or ("box"."primary_node_id" is not null and "box"."primary_public_key" is not null and "box"."primary_pinned_at" is not null))
);
--> statement-breakpoint
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
CREATE TABLE `node_take_failures` (
	`node_id` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`last_failed_at` text NOT NULL
);

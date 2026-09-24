PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mirror_config` (
	`node_id` text PRIMARY KEY NOT NULL,
	`relay_url` text NOT NULL,
	`box_hostname` text NOT NULL,
	`box_ca_pem` text NOT NULL,
	`origin_node_id` text NOT NULL,
	`adopted_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mirror_config`("node_id", "relay_url", "box_hostname", "box_ca_pem", "origin_node_id", "adopted_at") SELECT "node_id", "relay_url", "box_hostname", "box_ca_pem", "origin_node_id", "adopted_at" FROM `mirror_config`;--> statement-breakpoint
DROP TABLE `mirror_config`;--> statement-breakpoint
ALTER TABLE `__new_mirror_config` RENAME TO `mirror_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`verification_number` text NOT NULL,
	`decoy_numbers` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "join_requests_kind_ck" CHECK("__new_join_requests"."kind" in ('device', 'print_agent'))
);
--> statement-breakpoint
INSERT INTO `__new_join_requests`("id", "node_id", "location_id", "kind", "label", "token_hash", "verification_number", "decoy_numbers", "created_at") SELECT "id", "node_id", "location_id", "kind", "label", "token_hash", "verification_number", "decoy_numbers", "created_at" FROM `join_requests`;--> statement-breakpoint
DROP TABLE `join_requests`;--> statement-breakpoint
ALTER TABLE `__new_join_requests` RENAME TO `join_requests`;
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

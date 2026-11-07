CREATE TABLE `handover_activations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`scenario` text NOT NULL,
	`source_node_id` text NOT NULL,
	`destination_node_id` text NOT NULL,
	`evidence` text NOT NULL,
	`person_id` text NOT NULL,
	`activated_at` text NOT NULL,
	FOREIGN KEY (`source_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "handover_activations_scenario_ck" CHECK("handover_activations"."scenario" in ('controlled', 'emergency'))
);
--> statement-breakpoint
CREATE INDEX `handover_activations_destination_idx` ON `handover_activations` (`destination_node_id`);
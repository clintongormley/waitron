PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_kitchen_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`order_label` text NOT NULL,
	`kind` text NOT NULL,
	`line_name` text NOT NULL,
	`unit_name` text,
	`sold_in_each` integer DEFAULT false NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	`was_started` integer DEFAULT false NOT NULL,
	`moved_to` text,
	`direction` text,
	`cancelled_extra` text,
	`rerouted_to` text,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kitchen_notices_kind_ck" CHECK("__new_kitchen_notices"."kind" in ('recalled', 'void', 'changed', 'moved', 'rerouted')),
	CONSTRAINT "kitchen_notices_quantity_ck" CHECK("__new_kitchen_notices"."quantity" > 0),
	CONSTRAINT "kitchen_notices_moved_to_ck" CHECK("__new_kitchen_notices"."kind" = 'moved' or "__new_kitchen_notices"."moved_to" is null),
	CONSTRAINT "kitchen_notices_rerouted_to_ck" CHECK(("__new_kitchen_notices"."kind" = 'rerouted' and "__new_kitchen_notices"."rerouted_to" is not null) or ("__new_kitchen_notices"."kind" <> 'rerouted' and "__new_kitchen_notices"."rerouted_to" is null)),
	CONSTRAINT "kitchen_notices_direction_ck" CHECK("__new_kitchen_notices"."direction" in ('added', 'removed')),
	CONSTRAINT "kitchen_notices_direction_kind_ck" CHECK("__new_kitchen_notices"."kind" = 'changed' or "__new_kitchen_notices"."direction" is null),
	CONSTRAINT "kitchen_notices_cancelled_extra_kind_ck" CHECK("__new_kitchen_notices"."kind" = 'changed' or "__new_kitchen_notices"."cancelled_extra" is null)
);
--> statement-breakpoint
INSERT INTO `__new_kitchen_notices`("id", "station_id", "working_order_id", "order_label", "kind", "line_name", "unit_name", "sold_in_each", "quantity", "note", "was_started", "moved_to", "direction", "cancelled_extra", "rerouted_to", "created_at", "acknowledged_at") SELECT "id", "station_id", "working_order_id", "order_label", "kind", "line_name", "unit_name", "sold_in_each", "quantity", "note", "was_started", "moved_to", "direction", "cancelled_extra", "rerouted_to", "created_at", "acknowledged_at" FROM `kitchen_notices`;--> statement-breakpoint
DROP TABLE `kitchen_notices`;--> statement-breakpoint
ALTER TABLE `__new_kitchen_notices` RENAME TO `kitchen_notices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `kitchen_notices_open_idx` ON `kitchen_notices` (`station_id`,`created_at`) WHERE "kitchen_notices"."acknowledged_at" is null;
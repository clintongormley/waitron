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
	`order_note_change` text,
	`allergy_block` text,
	`rerouted_to` text,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kitchen_notices_kind_ck" CHECK("__new_kitchen_notices"."kind" in ('recalled', 'void', 'changed', 'moved', 'rerouted', 'allergy_changed', 'allergy_removed')),
	CONSTRAINT "kitchen_notices_allergy_block_ck" CHECK(case when "__new_kitchen_notices"."allergy_block" is null then 1
    when not json_valid("__new_kitchen_notices"."allergy_block") then 0
    else json_type("__new_kitchen_notices"."allergy_block") is 'object'
      and json_type("__new_kitchen_notices"."allergy_block", '$.who') is 'text'
      and length(trim(json_extract("__new_kitchen_notices"."allergy_block", '$.who'))) between 1 and 40
      and json_type("__new_kitchen_notices"."allergy_block", '$.allergens') is 'object'
      and json_extract("__new_kitchen_notices"."allergy_block", '$.allergens') <> '{}'
      and json_type("__new_kitchen_notices"."allergy_block", '$.clashes') is 'object'
      and (json_type("__new_kitchen_notices"."allergy_block", '$.note') is 'null'
        or (json_type("__new_kitchen_notices"."allergy_block", '$.note') is 'text'
          and length(json_extract("__new_kitchen_notices"."allergy_block", '$.note')) <= 2000))
      and json_type("__new_kitchen_notices"."allergy_block", '$.labels.en.avoids') is 'array'
      and json_type("__new_kitchen_notices"."allergy_block", '$.labels.en.clashes') is 'array'
      and json_type("__new_kitchen_notices"."allergy_block", '$.labels.es.avoids') is 'array'
      and json_type("__new_kitchen_notices"."allergy_block", '$.labels.es.clashes') is 'array'
    end),
	CONSTRAINT "kitchen_notices_allergy_kind_ck" CHECK(("__new_kitchen_notices"."kind" = 'allergy_changed' and "__new_kitchen_notices"."allergy_block" is not null)
        or ("__new_kitchen_notices"."kind" <> 'allergy_changed' and "__new_kitchen_notices"."allergy_block" is null)),
	CONSTRAINT "kitchen_notices_allergy_options_ck" CHECK("__new_kitchen_notices"."kind" not in ('allergy_changed', 'allergy_removed') or "__new_kitchen_notices"."order_note_change" is null),
	CONSTRAINT "kitchen_notices_quantity_ck" CHECK("__new_kitchen_notices"."quantity" > 0),
	CONSTRAINT "kitchen_notices_moved_to_ck" CHECK("__new_kitchen_notices"."kind" = 'moved' or "__new_kitchen_notices"."moved_to" is null),
	CONSTRAINT "kitchen_notices_rerouted_to_ck" CHECK(("__new_kitchen_notices"."kind" = 'rerouted' and "__new_kitchen_notices"."rerouted_to" is not null) or ("__new_kitchen_notices"."kind" <> 'rerouted' and "__new_kitchen_notices"."rerouted_to" is null)),
	CONSTRAINT "kitchen_notices_direction_ck" CHECK("__new_kitchen_notices"."direction" in ('added', 'removed')),
	CONSTRAINT "kitchen_notices_direction_kind_ck" CHECK("__new_kitchen_notices"."kind" = 'changed' or "__new_kitchen_notices"."direction" is null),
	CONSTRAINT "kitchen_notices_cancelled_extra_kind_ck" CHECK("__new_kitchen_notices"."kind" = 'changed' or "__new_kitchen_notices"."cancelled_extra" is null)
);
--> statement-breakpoint
INSERT INTO `__new_kitchen_notices`("id", "station_id", "working_order_id", "order_label", "kind", "line_name", "unit_name", "sold_in_each", "quantity", "note", "was_started", "moved_to", "direction", "cancelled_extra", "order_note_change", "allergy_block", "rerouted_to", "created_at", "acknowledged_at") SELECT "id", "station_id", "working_order_id", "order_label", "kind", "line_name", "unit_name", "sold_in_each", "quantity", "note", "was_started", "moved_to", "direction", "cancelled_extra", "order_note_change", "allergy_block", "rerouted_to", "created_at", "acknowledged_at" FROM `kitchen_notices`;--> statement-breakpoint
DROP TABLE `kitchen_notices`;--> statement-breakpoint
ALTER TABLE `__new_kitchen_notices` RENAME TO `kitchen_notices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `kitchen_notices_open_idx` ON `kitchen_notices` (`station_id`,`created_at`) WHERE "kitchen_notices"."acknowledged_at" is null;
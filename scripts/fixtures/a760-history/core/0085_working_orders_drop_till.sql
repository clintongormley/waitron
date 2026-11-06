PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_working_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`location_id` text NOT NULL,
	`node_id` text,
	`order_number` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`settled_at` text,
	`delivery_table_id` text,
	`collected_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`payment_attempt_at` text,
	`party_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delivery_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_orders_status_ck" CHECK("__new_working_orders"."status" in ('open', 'placed', 'settled', 'abandoned')),
	CONSTRAINT "working_orders_source_ck" CHECK("__new_working_orders"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test')),
	CONSTRAINT "working_orders_source_device_ck" CHECK(("__new_working_orders"."source" = 'device') = ("__new_working_orders"."device_id" is not null)),
	CONSTRAINT "working_orders_settled_at_ck" CHECK(("__new_working_orders"."status" = 'settled') = ("__new_working_orders"."settled_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_working_orders`("id", "source", "device_id", "location_id", "node_id", "order_number", "label", "status", "opened_at", "settled_at", "delivery_table_id", "collected_at", "revision", "payment_attempt_at", "party_id") SELECT "id", "source", "device_id", "location_id", "node_id", "order_number", "label", "status", "opened_at", "settled_at", "delivery_table_id", "collected_at", "revision", "payment_attempt_at", "party_id" FROM `working_orders`;--> statement-breakpoint
DROP TABLE `working_orders`;--> statement-breakpoint
ALTER TABLE `__new_working_orders` RENAME TO `working_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `working_orders_tenant_status_idx` ON `working_orders` (`status`);--> statement-breakpoint
CREATE INDEX `working_orders_opened_at_idx` ON `working_orders` (`opened_at`);--> statement-breakpoint
CREATE INDEX `working_orders_party_idx` ON `working_orders` (`party_id`);
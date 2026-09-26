CREATE TABLE `service_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`edit_sent_lines` integer DEFAULT true NOT NULL,
	CONSTRAINT "service_settings_singleton_ck" CHECK("service_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `kitchen_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`order_label` text NOT NULL,
	`kind` text NOT NULL,
	`line_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	`was_started` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kitchen_notices_kind_ck" CHECK("kitchen_notices"."kind" in ('recalled', 'void', 'changed')),
	CONSTRAINT "kitchen_notices_quantity_ck" CHECK("kitchen_notices"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `kitchen_notices_open_idx` ON `kitchen_notices` (`station_id`,`created_at`) WHERE "kitchen_notices"."acknowledged_at" is null;
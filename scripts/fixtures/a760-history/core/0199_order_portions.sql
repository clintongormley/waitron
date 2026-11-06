CREATE TABLE `order_portion_events` (
	`id` text PRIMARY KEY NOT NULL,
	`portion_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_order_id` text NOT NULL,
	`to_order_id` text,
	`actor_id` text,
	`at` text NOT NULL,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_portion_events_kind_ck" CHECK("order_portion_events"."kind" in ('moved', 'cancelled')),
	CONSTRAINT "order_portion_events_destination_ck" CHECK(("order_portion_events"."kind" = 'moved' and "order_portion_events"."to_order_id" is not null and "order_portion_events"."to_order_id" <> "order_portion_events"."from_order_id") or ("order_portion_events"."kind" = 'cancelled' and "order_portion_events"."to_order_id" is null))
);
--> statement-breakpoint
CREATE TABLE `order_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`cohort_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`measured` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "order_portions_ordinal_ck" CHECK("order_portions"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_portions_cohort_ordinal_key` ON `order_portions` (`cohort_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `sale_line_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_line_id` text NOT NULL,
	`portion_id` text NOT NULL,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_line_portions_portion_idx` ON `sale_line_portions` (`portion_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_line_portions_sale_line_portion_key` ON `sale_line_portions` (`sale_line_id`,`portion_id`);--> statement-breakpoint
CREATE TABLE `working_line_portions` (
	`working_order_line_id` text PRIMARY KEY NOT NULL,
	`portion_id` text NOT NULL,
	FOREIGN KEY (`working_order_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`portion_id`) REFERENCES `order_portions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `working_line_portions_portion_key` ON `working_line_portions` (`portion_id`);
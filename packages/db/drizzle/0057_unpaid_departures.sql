CREATE TABLE `unpaid_departures` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`recorded_by` text NOT NULL,
	`authorized_by` text NOT NULL,
	`till_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "unpaid_departures_amount_ck" CHECK("unpaid_departures"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unpaid_departures_working_order_key` ON `unpaid_departures` (`working_order_id`);
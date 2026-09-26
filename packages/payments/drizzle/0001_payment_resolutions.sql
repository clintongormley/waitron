CREATE TABLE `payment_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`person_id` text NOT NULL,
	`outcome` text NOT NULL,
	`cancelled_at_provider` integer NOT NULL,
	`provider_status` text,
	`resolved_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_resolutions_outcome_ck" CHECK("payment_resolutions"."outcome" in ('captured', 'failed')),
	CONSTRAINT "payment_resolutions_cancelled_ck" CHECK("payment_resolutions"."cancelled_at_provider" = 0 or "payment_resolutions"."outcome" = 'failed')
);
--> statement-breakpoint
CREATE INDEX `payment_resolutions_payment_idx` ON `payment_resolutions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_resolutions_working_order_idx` ON `payment_resolutions` (`working_order_id`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payment_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`person_id` text,
	`outcome` text NOT NULL,
	`cancelled_at_provider` integer NOT NULL,
	`provider_status` text,
	`resolved_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_resolutions_outcome_ck" CHECK("__new_payment_resolutions"."outcome" in ('captured', 'failed')),
	CONSTRAINT "payment_resolutions_cancelled_ck" CHECK("__new_payment_resolutions"."cancelled_at_provider" = 0 or "__new_payment_resolutions"."outcome" = 'failed')
);
--> statement-breakpoint
INSERT INTO `__new_payment_resolutions`("id", "payment_id", "working_order_id", "person_id", "outcome", "cancelled_at_provider", "provider_status", "resolved_at") SELECT "id", "payment_id", "working_order_id", "person_id", "outcome", "cancelled_at_provider", "provider_status", "resolved_at" FROM `payment_resolutions`;--> statement-breakpoint
DROP TABLE `payment_resolutions`;--> statement-breakpoint
ALTER TABLE `__new_payment_resolutions` RENAME TO `payment_resolutions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_resolutions_payment_key` ON `payment_resolutions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_resolutions_working_order_idx` ON `payment_resolutions` (`working_order_id`);
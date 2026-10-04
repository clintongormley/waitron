PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`sale_id` text,
	`node_id` text,
	`reader_id` text,
	`provider` text NOT NULL,
	`payment_ref` text NOT NULL,
	`external_ref` text,
	`card_scheme` text,
	`card_last4` text,
	`card_entry_mode` text,
	`card_auth_code` text,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`settled_at` text,
	`reconcile_remediated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`bill_payment_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_ck" CHECK("__new_payments"."amount" > 0),
	CONSTRAINT "payments_card_last4_ck" CHECK("__new_payments"."card_last4" is null or length("__new_payments"."card_last4") = 4),
	CONSTRAINT "payments_card_entry_mode_ck" CHECK("__new_payments"."card_entry_mode" is null or "__new_payments"."card_entry_mode" in ('contactless','chip','swipe','unknown')),
	CONSTRAINT "payments_state_ck" CHECK("__new_payments"."state" in ('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'accepted_offline', 'settled', 'declined', 'initiated')),
	CONSTRAINT "payments_source_ck" CHECK("__new_payments"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "payments_source_device_ck" CHECK(("__new_payments"."source" = 'device') = ("__new_payments"."device_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_payments`("id", "working_order_id", "source", "device_id", "sale_id", "node_id", "reader_id", "provider", "payment_ref", "external_ref", "card_scheme", "card_last4", "card_entry_mode", "card_auth_code", "amount", "state", "settled_at", "reconcile_remediated_at", "created_at", "updated_at", "bill_payment_id") SELECT "id", "working_order_id", "source", "device_id", "sale_id", "node_id", "reader_id", "provider", "payment_ref", "external_ref", "card_scheme", "card_last4", "card_entry_mode", "card_auth_code", "amount", "state", "settled_at", "reconcile_remediated_at", "created_at", "updated_at", "bill_payment_id" FROM `payments`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
ALTER TABLE `__new_payments` RENAME TO `payments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_external_ref_key` ON `payments` (`provider`,`external_ref`) WHERE "payments"."external_ref" is not null and "payments"."provider" <> 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX `payments_bill_payment_key` ON `payments` (`bill_payment_id`) WHERE "payments"."bill_payment_id" is not null;--> statement-breakpoint
CREATE INDEX `payments_working_order_idx` ON `payments` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `payments_reconcile_idx` ON `payments` (`provider`,`settled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_key` ON `payments` (`provider`,`payment_ref`);
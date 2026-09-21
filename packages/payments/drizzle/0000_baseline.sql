CREATE TABLE `card_readers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text,
	`unpaired_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_readers_provider_ref_key` ON `card_readers` (`provider`,`provider_ref`);--> statement-breakpoint
CREATE TABLE `device_card_readers` (
	`device_id` text PRIMARY KEY NOT NULL,
	`reader_id` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `payment_policy` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`offline_mode` text NOT NULL,
	`offline_amount_cap` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "payment_policy_singleton_ck" CHECK("payment_policy"."id" = 1),
	CONSTRAINT "payment_policy_offline_mode_ck" CHECK("payment_policy"."offline_mode" in ('accept_offline', 'cash_only')),
	CONSTRAINT "payment_policy_cap_ck" CHECK("payment_policy"."offline_amount_cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`provider` text NOT NULL,
	`payment_ref` text NOT NULL,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`authorized_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_refunds_amount_ck" CHECK("payment_refunds"."amount" > 0),
	CONSTRAINT "payment_refunds_state_ck" CHECK("payment_refunds"."state" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `payment_refunds_payment_idx` ON `payment_refunds` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
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
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_card_last4_ck" CHECK("payments"."card_last4" is null or length("payments"."card_last4") = 4),
	CONSTRAINT "payments_card_entry_mode_ck" CHECK("payments"."card_entry_mode" is null or "payments"."card_entry_mode" in ('contactless','chip','swipe','unknown')),
	CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'accepted_offline', 'settled', 'declined', 'initiated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_external_ref_key` ON `payments` (`provider`,`external_ref`) WHERE "payments"."external_ref" is not null and "payments"."provider" <> 'manual';--> statement-breakpoint
CREATE INDEX `payments_working_order_idx` ON `payments` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `payments_reconcile_idx` ON `payments` (`provider`,`settled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_key` ON `payments` (`provider`,`payment_ref`);
CREATE TABLE `card_reader_holders` (
	`reader_id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`held_at` text NOT NULL,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `card_readers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`prints_own_slip_automatically` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text,
	`unpaired_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_readers_provider_ref_key` ON `card_readers` (`provider`,`provider_ref`) WHERE "card_readers"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `device_card_readers` (
	`device_id` text PRIMARY KEY NOT NULL,
	`reader_id` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `device_profile_card_readers` (
	`device_profile_id` text NOT NULL,
	`reader_id` text NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`device_profile_id`, `reader_id`),
	FOREIGN KEY (`device_profile_id`) REFERENCES `device_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_profile_card_readers_profile_default_key` ON `device_profile_card_readers` (`device_profile_id`) WHERE "device_profile_card_readers"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `payment_hold_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`hold_id` text NOT NULL,
	`outcome` text NOT NULL,
	`note` text,
	`person_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`hold_id`) REFERENCES `payment_holds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_hold_outcomes_outcome_ck" CHECK("payment_hold_outcomes"."outcome" in ('refunded_at_provider', 'kept')),
	CONSTRAINT "payment_hold_outcomes_note_ck" CHECK("payment_hold_outcomes"."note" is null or length(trim("payment_hold_outcomes"."note")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_hold_outcomes_hold_key` ON `payment_hold_outcomes` (`hold_id`);--> statement-breakpoint
CREATE TABLE `payment_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`provider_amount` integer NOT NULL,
	`found_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_holds_provider_amount_ck" CHECK("payment_holds"."provider_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_holds_payment_key` ON `payment_holds` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`provider` text NOT NULL,
	`payment_ref` text NOT NULL,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`authorized_by` text,
	`provider_refund_ref` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_refunds_amount_ck" CHECK("payment_refunds"."amount" > 0),
	CONSTRAINT "payment_refunds_state_ck" CHECK("payment_refunds"."state" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `payment_refunds_payment_idx` ON `payment_refunds` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payment_resolutions` (
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
	CONSTRAINT "payment_resolutions_outcome_ck" CHECK("payment_resolutions"."outcome" in ('captured', 'failed')),
	CONSTRAINT "payment_resolutions_cancelled_ck" CHECK("payment_resolutions"."cancelled_at_provider" = 0 or "payment_resolutions"."outcome" = 'failed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_resolutions_payment_key` ON `payment_resolutions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_resolutions_working_order_idx` ON `payment_resolutions` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `payments` (
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
	`requested_amount` integer,
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
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_card_last4_ck" CHECK("payments"."card_last4" is null or length("payments"."card_last4") = 4),
	CONSTRAINT "payments_card_entry_mode_ck" CHECK("payments"."card_entry_mode" is null or "payments"."card_entry_mode" in ('contactless','chip','swipe','unknown')),
	CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'initiated')),
	CONSTRAINT "payments_source_ck" CHECK("payments"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "payments_source_device_ck" CHECK(("payments"."source" = 'device') = ("payments"."device_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_external_ref_key` ON `payments` (`provider`,`external_ref`) WHERE "payments"."external_ref" is not null and "payments"."provider" <> 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX `payments_bill_payment_key` ON `payments` (`bill_payment_id`) WHERE "payments"."bill_payment_id" is not null;--> statement-breakpoint
CREATE INDEX `payments_working_order_idx` ON `payments` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `payments_reader_idx` ON `payments` (`reader_id`);--> statement-breakpoint
CREATE INDEX `payments_reconcile_idx` ON `payments` (`provider`,`settled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_key` ON `payments` (`provider`,`payment_ref`);--> statement-breakpoint
CREATE TABLE `scheduled_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`duty` text NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`started_at` text,
	`finished_at` text,
	`summary` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "scheduled_runs_state_ck" CHECK("scheduled_runs"."state" in ('pending', 'running', 'succeeded', 'failed', 'parked')),
	CONSTRAINT "scheduled_runs_period_ck" CHECK("scheduled_runs"."period_from" < "scheduled_runs"."period_to"),
	CONSTRAINT "scheduled_runs_generation_ck" CHECK("scheduled_runs"."generation" >= 0),
	CONSTRAINT "scheduled_runs_attempts_ck" CHECK("scheduled_runs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_runs_key` ON `scheduled_runs` (`duty`,`period_from`,`generation`);
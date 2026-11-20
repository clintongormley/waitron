CREATE TABLE `card_readers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text NOT NULL,
	`name` text NOT NULL,
	`held_by_device_id` text,
	`prints_own_slip_automatically` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text,
	`unpaired_at` text,
	`deleted_at` text,
	FOREIGN KEY (`held_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_readers_provider_ref_key` ON `card_readers` (`provider`,`provider_ref`) WHERE "card_readers"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`state` text NOT NULL,
	`authorized_by` text,
	`provider_refund_ref` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authorized_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_refunds_amount_ck" CHECK("payment_refunds"."amount" > 0),
	CONSTRAINT "payment_refunds_state_ck" CHECK("payment_refunds"."state" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `payment_refunds_payment_idx` ON `payment_refunds` (`payment_id`);--> statement-breakpoint
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
	`external_provider` text,
	`external_machine` text,
	`card_scheme` text,
	`card_last4` text,
	`card_entry_mode` text,
	`card_auth_code` text,
	`amount` integer NOT NULL,
	`requested_amount` integer,
	`state` text NOT NULL,
	`settled_at` text,
	`provider_checkout_started_at` text,
	`reconcile_remediated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`bill_payment_id` text,
	`resolution_outcome` text,
	`resolution_cancelled_at_provider` integer,
	`resolution_provider_status` text,
	`resolved_by` text,
	`resolved_at` text,
	`hold_provider_amount` integer,
	`held_at` text,
	`hold_outcome` text,
	`hold_note` text,
	`hold_decided_by` text,
	`hold_decided_at` text,
	`requested_by` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reader_id`) REFERENCES `card_readers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`hold_decided_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payments_resolution_outcome_ck" CHECK("payments"."resolution_outcome" in ('captured', 'failed')),
	CONSTRAINT "payments_resolution_cancelled_ck" CHECK("payments"."resolution_cancelled_at_provider" is null or "payments"."resolution_cancelled_at_provider" = 0 or "payments"."resolution_outcome" = 'failed'),
	CONSTRAINT "payments_resolution_fields_ck" CHECK(("payments"."resolution_outcome" is null) = ("payments"."resolved_at" is null) and ("payments"."resolution_outcome" is null) = ("payments"."resolution_cancelled_at_provider" is null) and ("payments"."resolution_outcome" is not null or ("payments"."resolution_provider_status" is null and "payments"."resolved_by" is null))),
	CONSTRAINT "payments_hold_amount_ck" CHECK("payments"."hold_provider_amount" is null or "payments"."hold_provider_amount" > 0),
	CONSTRAINT "payments_hold_fields_ck" CHECK(("payments"."hold_provider_amount" is null) = ("payments"."held_at" is null)),
	CONSTRAINT "payments_hold_outcome_ck" CHECK("payments"."hold_outcome" in ('refunded_at_provider', 'kept')),
	CONSTRAINT "payments_hold_note_ck" CHECK("payments"."hold_note" is null or length(trim("payments"."hold_note")) > 0),
	CONSTRAINT "payments_hold_outcome_fields_ck" CHECK(("payments"."hold_outcome" is null) = ("payments"."hold_decided_by" is null) and ("payments"."hold_outcome" is null) = ("payments"."hold_decided_at" is null) and ("payments"."hold_outcome" is null or "payments"."held_at" is not null) and ("payments"."hold_outcome" is not null or "payments"."hold_note" is null)),
	CONSTRAINT "payments_hold_or_remediation_ck" CHECK("payments"."held_at" is null or "payments"."reconcile_remediated_at" is null),
	CONSTRAINT "payments_amount_ck" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_card_last4_ck" CHECK("payments"."card_last4" is null or length("payments"."card_last4") = 4),
	CONSTRAINT "payments_card_entry_mode_ck" CHECK("payments"."card_entry_mode" is null or "payments"."card_entry_mode" in ('contactless','chip','swipe','unknown')),
	CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', 'voided', 'refunded', 'partially_refunded', 'failed', 'initiated')),
	CONSTRAINT "payments_external_provider_ck" CHECK("payments"."external_provider" in ('connected_account', 'other')),
	CONSTRAINT "payments_source_ck" CHECK("payments"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script', 'business_day_close')),
	CONSTRAINT "payments_source_device_ck" CHECK(("payments"."source" = 'device') = ("payments"."device_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_external_ref_key` ON `payments` (`provider`,`external_ref`) WHERE "payments"."external_ref" is not null and "payments"."provider" <> 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX `payments_bill_payment_key` ON `payments` (`bill_payment_id`) WHERE "payments"."bill_payment_id" is not null;--> statement-breakpoint
CREATE INDEX `payments_working_order_idx` ON `payments` (`working_order_id`);--> statement-breakpoint
CREATE INDEX `payments_sale_idx` ON `payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `payments_reader_idx` ON `payments` (`reader_id`);--> statement-breakpoint
CREATE INDEX `payments_reconcile_idx` ON `payments` (`provider`,`settled_at`);--> statement-breakpoint
CREATE INDEX `payments_open_hold_idx` ON `payments` (`held_at`) WHERE "payments"."held_at" is not null and "payments"."hold_outcome" is null;--> statement-breakpoint
CREATE INDEX `payments_unfiled_resolution_idx` ON `payments` (`working_order_id`) WHERE "payments"."resolution_outcome" = 'captured' and "payments"."resolved_by" is null and "payments"."sale_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_key` ON `payments` (`provider`,`payment_ref`);--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
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
	CONSTRAINT "reconciliation_runs_state_ck" CHECK("reconciliation_runs"."state" in ('pending', 'running', 'succeeded', 'failed', 'parked')),
	CONSTRAINT "reconciliation_runs_period_ck" CHECK("reconciliation_runs"."period_from" < "reconciliation_runs"."period_to"),
	CONSTRAINT "reconciliation_runs_generation_ck" CHECK("reconciliation_runs"."generation" >= 0),
	CONSTRAINT "reconciliation_runs_attempts_ck" CHECK("reconciliation_runs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_runs_key` ON `reconciliation_runs` (`duty`,`period_from`,`generation`);
--> statement-breakpoint
CREATE TRIGGER payments_guard_update
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  -- Resolving an attempt first records requested_amount; confirmed capture may change amount.
  SELECT raise(abort, 'a payment cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.working_order_id IS old.working_order_id
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.provider IS old.provider
    AND new.payment_ref IS old.payment_ref
    AND (old.requested_amount IS NULL OR new.requested_amount IS old.requested_amount)
    AND new.created_at IS old.created_at
    AND new.requested_by IS old.requested_by
    -- Short-capture recovery first links a whole-order payment to its bill contribution.
    AND (old.bill_payment_id IS NULL OR new.bill_payment_id IS old.bill_payment_id)
    AND (old.sale_id IS NULL OR new.sale_id IS old.sale_id)
    AND (old.reader_id IS NULL OR new.reader_id IS old.reader_id)
    AND (old.reconcile_remediated_at IS NULL
      OR new.reconcile_remediated_at IS old.reconcile_remediated_at)
    AND (old.provider_checkout_started_at IS NULL
      OR new.provider_checkout_started_at IS old.provider_checkout_started_at)
    AND (old.resolution_outcome IS NULL OR (
      new.resolution_outcome IS old.resolution_outcome
      AND new.resolution_cancelled_at_provider IS old.resolution_cancelled_at_provider
      AND new.resolution_provider_status IS old.resolution_provider_status
      AND new.resolved_by IS old.resolved_by
      AND new.resolved_at IS old.resolved_at))
    AND (old.held_at IS NULL OR (
      new.held_at IS old.held_at AND new.hold_provider_amount IS old.hold_provider_amount))
    AND (old.hold_outcome IS NULL OR (
      new.hold_outcome IS old.hold_outcome AND new.hold_note IS old.hold_note
      AND new.hold_decided_by IS old.hold_decided_by
      AND new.hold_decided_at IS old.hold_decided_at))
  );
END;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete
BEFORE DELETE ON payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a payment is never deleted');
END;
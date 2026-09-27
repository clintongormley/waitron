CREATE TABLE `bill_payment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_payment_id` text NOT NULL,
	`line_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payment_lines_quantity_ck" CHECK("bill_payment_lines"."quantity" > 0),
	CONSTRAINT "bill_payment_lines_amount_ck" CHECK("bill_payment_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `bill_payment_lines_payment_idx` ON `bill_payment_lines` (`bill_payment_id`);--> statement-breakpoint
CREATE TABLE `bill_payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_payment_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`authorized_by` text NOT NULL,
	`requested_by` text NOT NULL,
	`till_id` text NOT NULL,
	`state` text NOT NULL,
	`sent_at` text,
	`send_count` integer DEFAULT 0 NOT NULL,
	`provider_refund_ref` text,
	`refs_before_send` text,
	`attested_by` text,
	`attestation_note` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`failed_at` text,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_payment_refunds_state_ck" CHECK("bill_payment_refunds"."state" in ('pending', 'completed', 'failed')),
	CONSTRAINT "bill_payment_refunds_amounts_ck" CHECK("bill_payment_refunds"."applied_amount" >= 0 and "bill_payment_refunds"."tip_amount" >= 0 and "bill_payment_refunds"."applied_amount" + "bill_payment_refunds"."tip_amount" > 0),
	CONSTRAINT "bill_payment_refunds_sent_ck" CHECK(("bill_payment_refunds"."send_count" = 0) = ("bill_payment_refunds"."sent_at" is null) and "bill_payment_refunds"."send_count" >= 0),
	CONSTRAINT "bill_payment_refunds_completed_at_ck" CHECK(("bill_payment_refunds"."state" = 'completed') = ("bill_payment_refunds"."completed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_failed_at_ck" CHECK(("bill_payment_refunds"."state" = 'failed') = ("bill_payment_refunds"."failed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_attestation_ck" CHECK(("bill_payment_refunds"."attested_by" is null) = ("bill_payment_refunds"."attestation_note" is null) and ("bill_payment_refunds"."attested_by" is null or "bill_payment_refunds"."state" <> 'pending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payment_refunds_submission_key` ON `bill_payment_refunds` (`bill_payment_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `bill_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`share_of` integer,
	`method` text NOT NULL,
	`applied` integer NOT NULL,
	`tip` integer DEFAULT 0 NOT NULL,
	`tendered` integer,
	`state` text NOT NULL,
	`requested_by` text NOT NULL,
	`till_id` text NOT NULL,
	`created_at` text NOT NULL,
	`received_at` text,
	`failed_at` text,
	`attested_by` text,
	`attestation_note` text,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_payments_kind_ck" CHECK("bill_payments"."kind" in ('items', 'contribution', 'share')),
	CONSTRAINT "bill_payments_method_ck" CHECK("bill_payments"."method" in ('cash', 'card')),
	CONSTRAINT "bill_payments_state_ck" CHECK("bill_payments"."state" in ('pending', 'received', 'failed', 'declined')),
	CONSTRAINT "bill_payments_share_of_ck" CHECK(("bill_payments"."kind" = 'share') = ("bill_payments"."share_of" is not null) and ("bill_payments"."share_of" is null or "bill_payments"."share_of" >= 1)),
	CONSTRAINT "bill_payments_amounts_ck" CHECK("bill_payments"."applied" >= 0 and "bill_payments"."tip" >= 0 and "bill_payments"."applied" + "bill_payments"."tip" > 0),
	CONSTRAINT "bill_payments_tendered_ck" CHECK(("bill_payments"."method" = 'cash') = ("bill_payments"."tendered" is not null) and ("bill_payments"."tendered" is null or "bill_payments"."tendered" >= "bill_payments"."applied" + "bill_payments"."tip")),
	CONSTRAINT "bill_payments_received_at_ck" CHECK(("bill_payments"."state" in ('received', 'declined')) = ("bill_payments"."received_at" is not null)),
	CONSTRAINT "bill_payments_failed_at_ck" CHECK(("bill_payments"."state" = 'failed') = ("bill_payments"."failed_at" is not null)),
	CONSTRAINT "bill_payments_attestation_ck" CHECK(("bill_payments"."attested_by" is null) = ("bill_payments"."attestation_note" is null) and ("bill_payments"."attested_by" is null or ("bill_payments"."state" <> 'pending' and coalesce(length(trim("bill_payments"."attestation_note")), 0) > 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payments_submission_key` ON `bill_payments` (`working_order_id`,`submission_id`);--> statement-breakpoint
ALTER TABLE `drawer_opens` ADD `bill_payment_id` text REFERENCES bill_payments(id);--> statement-breakpoint
ALTER TABLE `tenders` ADD `bill_payment_id` text REFERENCES bill_payments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `tenders_bill_payment_key` ON `tenders` (`bill_payment_id`) WHERE "tenders"."bill_payment_id" is not null;
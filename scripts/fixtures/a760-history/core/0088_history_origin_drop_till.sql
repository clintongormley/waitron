PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text,
	`captured_by_source` text NOT NULL,
	`captured_by_device_id` text,
	`captured_by_node_id` text NOT NULL,
	`event_at` text NOT NULL,
	`event_offset_minutes` integer NOT NULL,
	`entry_hash` text NOT NULL,
	`prev_entry_hash` text,
	`is_first_entry` integer NOT NULL,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`captured_by_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_amendments_sequence_no_ck" CHECK("__new_order_amendments"."sequence_no" > 0),
	CONSTRAINT "order_amendments_kind_ck" CHECK("__new_order_amendments"."kind" in ('order_placed', 'order_cancelled')),
	CONSTRAINT "order_amendments_captured_by_source_ck" CHECK("__new_order_amendments"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test')),
	CONSTRAINT "order_amendments_captured_by_source_device_ck" CHECK(("__new_order_amendments"."captured_by_source" = 'device') = ("__new_order_amendments"."captured_by_device_id" is not null)),
	CONSTRAINT "order_amendments_entry_hash_ck" CHECK(length("__new_order_amendments"."entry_hash") = 64 and "__new_order_amendments"."entry_hash" not glob '*[^0-9A-F]*'),
	CONSTRAINT "order_amendments_event_offset_ck" CHECK("__new_order_amendments"."event_offset_minutes" between -840 and 840),
	CONSTRAINT "order_amendments_event_at_second_ck" CHECK("__new_order_amendments"."event_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'),
	CONSTRAINT "order_amendments_chaining_ck" CHECK(("__new_order_amendments"."is_first_entry" and "__new_order_amendments"."prev_entry_hash" is null)
          or (not "__new_order_amendments"."is_first_entry" and "__new_order_amendments"."prev_entry_hash" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_order_amendments`("id", "working_order_id", "sequence_no", "kind", "actor_id", "reason", "captured_by_source", "captured_by_device_id", "captured_by_node_id", "event_at", "event_offset_minutes", "entry_hash", "prev_entry_hash", "is_first_entry") SELECT "id", "working_order_id", "sequence_no", "kind", "actor_id", "reason", "captured_by_source", "captured_by_device_id", "captured_by_node_id", "event_at", "event_offset_minutes", "entry_hash", "prev_entry_hash", "is_first_entry" FROM `order_amendments`;--> statement-breakpoint
DROP TABLE `order_amendments`;--> statement-breakpoint
ALTER TABLE `__new_order_amendments` RENAME TO `order_amendments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_amendments_order_idx` ON `order_amendments` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_amendments_chain_position_key` ON `order_amendments` (`working_order_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `__new_drawer_opens` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text,
	`printer_id` text,
	`person_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`sale_id` text,
	`bill_payment_id` text,
	`authorized_by` text,
	`via_override` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "drawer_opens_reason_ck" CHECK("__new_drawer_opens"."reason" in ('cash_sale', 'manual', 'calibration', 'bill_payment', 'bill_refund', 'card_slip')),
	CONSTRAINT "drawer_opens_target_ck" CHECK(("__new_drawer_opens"."reason" = 'calibration' and "__new_drawer_opens"."printer_id" is not null and "__new_drawer_opens"."device_id" is null and "__new_drawer_opens"."sale_id" is null and "__new_drawer_opens"."bill_payment_id" is null) or ("__new_drawer_opens"."reason" in ('bill_payment', 'bill_refund') and "__new_drawer_opens"."device_id" is not null and "__new_drawer_opens"."bill_payment_id" is not null and "__new_drawer_opens"."sale_id" is null) or ("__new_drawer_opens"."reason" in ('cash_sale', 'manual') and "__new_drawer_opens"."device_id" is not null and "__new_drawer_opens"."bill_payment_id" is null) or ("__new_drawer_opens"."reason" = 'card_slip' and "__new_drawer_opens"."device_id" is not null and ("__new_drawer_opens"."sale_id" is null) <> ("__new_drawer_opens"."bill_payment_id" is null)))
);
--> statement-breakpoint
INSERT INTO `__new_drawer_opens`("id", "device_id", "printer_id", "person_id", "opened_at", "reason", "sale_id", "bill_payment_id", "authorized_by", "via_override") SELECT "id", "device_id", "printer_id", "person_id", "opened_at", "reason", "sale_id", "bill_payment_id", "authorized_by", "via_override" FROM `drawer_opens`;--> statement-breakpoint
DROP TABLE `drawer_opens`;--> statement-breakpoint
ALTER TABLE `__new_drawer_opens` RENAME TO `drawer_opens`;
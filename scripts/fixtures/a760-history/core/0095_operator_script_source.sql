PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_working_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`location_id` text NOT NULL,
	`node_id` text,
	`order_number` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`settled_at` text,
	`delivery_table_id` text,
	`collected_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`payment_attempt_at` text,
	`party_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`delivery_table_id`) REFERENCES `dining_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_orders_status_ck" CHECK("__new_working_orders"."status" in ('open', 'placed', 'settled', 'abandoned')),
	CONSTRAINT "working_orders_source_ck" CHECK("__new_working_orders"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "working_orders_source_device_ck" CHECK(("__new_working_orders"."source" = 'device') = ("__new_working_orders"."device_id" is not null)),
	CONSTRAINT "working_orders_settled_at_ck" CHECK(("__new_working_orders"."status" = 'settled') = ("__new_working_orders"."settled_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_working_orders`("id", "source", "device_id", "location_id", "node_id", "order_number", "label", "status", "opened_at", "settled_at", "delivery_table_id", "collected_at", "revision", "payment_attempt_at", "party_id") SELECT "id", "source", "device_id", "location_id", "node_id", "order_number", "label", "status", "opened_at", "settled_at", "delivery_table_id", "collected_at", "revision", "payment_attempt_at", "party_id" FROM `working_orders`;--> statement-breakpoint
DROP TABLE `working_orders`;--> statement-breakpoint
ALTER TABLE `__new_working_orders` RENAME TO `working_orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `working_orders_tenant_status_idx` ON `working_orders` (`status`);--> statement-breakpoint
CREATE INDEX `working_orders_opened_at_idx` ON `working_orders` (`opened_at`);--> statement-breakpoint
CREATE INDEX `working_orders_party_idx` ON `working_orders` (`party_id`);--> statement-breakpoint
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
	CONSTRAINT "order_amendments_captured_by_source_ck" CHECK("__new_order_amendments"."captured_by_source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
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
CREATE INDEX `order_amendments_order_idx` ON `order_amendments` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_amendments_chain_position_key` ON `order_amendments` (`working_order_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `__new_bill_payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_payment_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`tip_amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`authorized_by` text NOT NULL,
	`requested_by` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
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
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payment_refunds_state_ck" CHECK("__new_bill_payment_refunds"."state" in ('pending', 'completed', 'failed')),
	CONSTRAINT "bill_payment_refunds_source_ck" CHECK("__new_bill_payment_refunds"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "bill_payment_refunds_source_device_ck" CHECK(("__new_bill_payment_refunds"."source" = 'device') = ("__new_bill_payment_refunds"."device_id" is not null)),
	CONSTRAINT "bill_payment_refunds_amounts_ck" CHECK("__new_bill_payment_refunds"."applied_amount" >= 0 and "__new_bill_payment_refunds"."tip_amount" >= 0 and "__new_bill_payment_refunds"."applied_amount" + "__new_bill_payment_refunds"."tip_amount" > 0),
	CONSTRAINT "bill_payment_refunds_sent_ck" CHECK(("__new_bill_payment_refunds"."send_count" = 0) = ("__new_bill_payment_refunds"."sent_at" is null) and "__new_bill_payment_refunds"."send_count" >= 0),
	CONSTRAINT "bill_payment_refunds_completed_at_ck" CHECK(("__new_bill_payment_refunds"."state" = 'completed') = ("__new_bill_payment_refunds"."completed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_failed_at_ck" CHECK(("__new_bill_payment_refunds"."state" = 'failed') = ("__new_bill_payment_refunds"."failed_at" is not null)),
	CONSTRAINT "bill_payment_refunds_attestation_ck" CHECK(("__new_bill_payment_refunds"."attested_by" is null) = ("__new_bill_payment_refunds"."attestation_note" is null) and ("__new_bill_payment_refunds"."attested_by" is null or ("__new_bill_payment_refunds"."state" <> 'pending' and coalesce(length(trim("__new_bill_payment_refunds"."attestation_note")), 0) > 0)))
);
--> statement-breakpoint
INSERT INTO `__new_bill_payment_refunds`("id", "bill_payment_id", "submission_id", "fingerprint", "applied_amount", "tip_amount", "reason", "authorized_by", "requested_by", "source", "device_id", "state", "sent_at", "send_count", "provider_refund_ref", "refs_before_send", "attested_by", "attestation_note", "created_at", "completed_at", "failed_at") SELECT "id", "bill_payment_id", "submission_id", "fingerprint", "applied_amount", "tip_amount", "reason", "authorized_by", "requested_by", "source", "device_id", "state", "sent_at", "send_count", "provider_refund_ref", "refs_before_send", "attested_by", "attestation_note", "created_at", "completed_at", "failed_at" FROM `bill_payment_refunds`;--> statement-breakpoint
DROP TABLE `bill_payment_refunds`;--> statement-breakpoint
ALTER TABLE `__new_bill_payment_refunds` RENAME TO `bill_payment_refunds`;--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payment_refunds_submission_key` ON `bill_payment_refunds` (`bill_payment_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `__new_bill_payments` (
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
	`source` text NOT NULL,
	`device_id` text,
	`created_at` text NOT NULL,
	`received_at` text,
	`failed_at` text,
	`attested_by` text,
	`attestation_note` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "bill_payments_kind_ck" CHECK("__new_bill_payments"."kind" in ('items', 'contribution', 'share')),
	CONSTRAINT "bill_payments_source_ck" CHECK("__new_bill_payments"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "bill_payments_source_device_ck" CHECK(("__new_bill_payments"."source" = 'device') = ("__new_bill_payments"."device_id" is not null)),
	CONSTRAINT "bill_payments_method_ck" CHECK("__new_bill_payments"."method" in ('cash', 'card')),
	CONSTRAINT "bill_payments_state_ck" CHECK("__new_bill_payments"."state" in ('pending', 'received', 'failed', 'declined')),
	CONSTRAINT "bill_payments_share_of_ck" CHECK(("__new_bill_payments"."kind" = 'share') = ("__new_bill_payments"."share_of" is not null) and ("__new_bill_payments"."share_of" is null or "__new_bill_payments"."share_of" >= 1)),
	CONSTRAINT "bill_payments_amounts_ck" CHECK("__new_bill_payments"."applied" >= 0 and "__new_bill_payments"."tip" >= 0 and "__new_bill_payments"."applied" + "__new_bill_payments"."tip" > 0),
	CONSTRAINT "bill_payments_tendered_ck" CHECK(("__new_bill_payments"."method" = 'cash') = ("__new_bill_payments"."tendered" is not null) and ("__new_bill_payments"."tendered" is null or "__new_bill_payments"."tendered" >= "__new_bill_payments"."applied" + "__new_bill_payments"."tip")),
	CONSTRAINT "bill_payments_received_at_ck" CHECK(("__new_bill_payments"."state" in ('received', 'declined')) = ("__new_bill_payments"."received_at" is not null)),
	CONSTRAINT "bill_payments_failed_at_ck" CHECK(("__new_bill_payments"."state" = 'failed') = ("__new_bill_payments"."failed_at" is not null)),
	CONSTRAINT "bill_payments_attestation_ck" CHECK(("__new_bill_payments"."attested_by" is null) = ("__new_bill_payments"."attestation_note" is null) and ("__new_bill_payments"."attested_by" is null or ("__new_bill_payments"."state" <> 'pending' and coalesce(length(trim("__new_bill_payments"."attestation_note")), 0) > 0)))
);
--> statement-breakpoint
INSERT INTO `__new_bill_payments`("id", "working_order_id", "submission_id", "fingerprint", "kind", "share_of", "method", "applied", "tip", "tendered", "state", "requested_by", "source", "device_id", "created_at", "received_at", "failed_at", "attested_by", "attestation_note") SELECT "id", "working_order_id", "submission_id", "fingerprint", "kind", "share_of", "method", "applied", "tip", "tendered", "state", "requested_by", "source", "device_id", "created_at", "received_at", "failed_at", "attested_by", "attestation_note" FROM `bill_payments`;--> statement-breakpoint
DROP TABLE `bill_payments`;--> statement-breakpoint
ALTER TABLE `__new_bill_payments` RENAME TO `bill_payments`;--> statement-breakpoint
CREATE UNIQUE INDEX `bill_payments_submission_key` ON `bill_payments` (`working_order_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `__new_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`series_id` text NOT NULL,
	`node_id` text NOT NULL,
	`invoice_number` integer NOT NULL,
	`issued_at` text NOT NULL,
	`issued_offset_minutes` integer NOT NULL,
	`total` integer NOT NULL,
	`vat_breakdown` text NOT NULL,
	`locale` text NOT NULL,
	`invoice_locales` text NOT NULL,
	`fiscal_backend` text NOT NULL,
	`fiscal_state` text NOT NULL,
	`corrects_sale_id` text,
	`counterparty_tax_id` text,
	`counterparty_legal_name` text,
	`counterparty_country_code` text,
	`authorized_by` text,
	`operator_id` text,
	`working_order_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `invoice_series`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`corrects_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sales_total_ck" CHECK("__new_sales"."total" >= 0 or "__new_sales"."corrects_sale_id" is not null),
	CONSTRAINT "sales_invoice_number_ck" CHECK("__new_sales"."invoice_number" >= 1),
	CONSTRAINT "sales_invoice_locales_ck" CHECK(json_array_length("__new_sales"."invoice_locales") between 1 and 2),
	CONSTRAINT "sales_locale_member_ck" CHECK(instr("__new_sales"."invoice_locales", '"' || "__new_sales"."locale" || '"') > 0),
	CONSTRAINT "sales_issued_offset_ck" CHECK("__new_sales"."issued_offset_minutes" between -840 and 840),
	CONSTRAINT "sales_fiscal_state_ck" CHECK("__new_sales"."fiscal_state" in ('recorded', 'not_applicable')),
	CONSTRAINT "sales_source_ck" CHECK("__new_sales"."source" in ('device', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "sales_source_device_ck" CHECK(("__new_sales"."source" = 'device') = ("__new_sales"."device_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_sales`("id", "source", "device_id", "series_id", "node_id", "invoice_number", "issued_at", "issued_offset_minutes", "total", "vat_breakdown", "locale", "invoice_locales", "fiscal_backend", "fiscal_state", "corrects_sale_id", "counterparty_tax_id", "counterparty_legal_name", "counterparty_country_code", "authorized_by", "operator_id", "working_order_id") SELECT "id", "source", "device_id", "series_id", "node_id", "invoice_number", "issued_at", "issued_offset_minutes", "total", "vat_breakdown", "locale", "invoice_locales", "fiscal_backend", "fiscal_state", "corrects_sale_id", "counterparty_tax_id", "counterparty_legal_name", "counterparty_country_code", "authorized_by", "operator_id", "working_order_id" FROM `sales`;--> statement-breakpoint
DROP TABLE `sales`;--> statement-breakpoint
ALTER TABLE `__new_sales` RENAME TO `sales`;--> statement-breakpoint
CREATE INDEX `sales_tenant_issued_idx` ON `sales` (`issued_at`);--> statement-breakpoint
CREATE INDEX `sales_fiscal_state_idx` ON `sales` (`fiscal_state`);--> statement-breakpoint
CREATE INDEX `sales_corrects_idx` ON `sales` (`corrects_sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_series_invoice_number_key` ON `sales` (`series_id`,`invoice_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_working_order_id_key` ON `sales` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `__new_unpaid_departures` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`working_order_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`recorded_by` text NOT NULL,
	`authorized_by` text NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "unpaid_departures_amount_ck" CHECK("__new_unpaid_departures"."amount" > 0),
	CONSTRAINT "unpaid_departures_source_ck" CHECK("__new_unpaid_departures"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "unpaid_departures_source_device_ck" CHECK(("__new_unpaid_departures"."source" = 'device') = ("__new_unpaid_departures"."device_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_unpaid_departures`("id", "party_id", "working_order_id", "sale_id", "amount", "reason", "recorded_by", "authorized_by", "source", "device_id", "recorded_at") SELECT "id", "party_id", "working_order_id", "sale_id", "amount", "reason", "recorded_by", "authorized_by", "source", "device_id", "recorded_at" FROM `unpaid_departures`;--> statement-breakpoint
DROP TABLE `unpaid_departures`;--> statement-breakpoint
ALTER TABLE `__new_unpaid_departures` RENAME TO `unpaid_departures`;--> statement-breakpoint
CREATE UNIQUE INDEX `unpaid_departures_working_order_key` ON `unpaid_departures` (`working_order_id`);--> statement-breakpoint
CREATE TABLE `__new_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`device_id` text,
	`sale_id` text,
	`code` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`severity` text NOT NULL,
	`detected_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "incidents_severity_ck" CHECK("__new_incidents"."severity" in ('warning', 'error')),
	CONSTRAINT "incidents_code_ck" CHECK("__new_incidents"."code" <> ''),
	CONSTRAINT "incidents_source_ck" CHECK("__new_incidents"."source" in ('device', 'dashboard', 'fiscal_filing', 'payment_check', 'kitchen_timer', 'demo_seed', 'readiness_test', 'operator_script')),
	CONSTRAINT "incidents_source_device_ck" CHECK(("__new_incidents"."source" = 'device') = ("__new_incidents"."device_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_incidents`("id", "source", "device_id", "sale_id", "code", "params", "severity", "detected_at", "acknowledged_at", "acknowledged_by") SELECT "id", "source", "device_id", "sale_id", "code", "params", "severity", "detected_at", "acknowledged_at", "acknowledged_by" FROM `incidents`;--> statement-breakpoint
DROP TABLE `incidents`;--> statement-breakpoint
ALTER TABLE `__new_incidents` RENAME TO `incidents`;--> statement-breakpoint
CREATE INDEX `incidents_origin_open_idx` ON `incidents` (`source`,`device_id`,`detected_at`);--> statement-breakpoint
CREATE INDEX `incidents_handled_idx` ON `incidents` (`acknowledged_at`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drawer_opens` (
	`id` text PRIMARY KEY NOT NULL,
	`till_id` text,
	`printer_id` text,
	`person_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`reason` text NOT NULL,
	`sale_id` text,
	`bill_payment_id` text,
	`authorized_by` text,
	`via_override` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`till_id`) REFERENCES `tills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_payment_id`) REFERENCES `bill_payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "drawer_opens_reason_ck" CHECK("__new_drawer_opens"."reason" in ('cash_sale', 'manual', 'calibration', 'bill_payment', 'bill_refund')),
	CONSTRAINT "drawer_opens_target_ck" CHECK(("__new_drawer_opens"."reason" = 'calibration' and "__new_drawer_opens"."printer_id" is not null and "__new_drawer_opens"."till_id" is null and "__new_drawer_opens"."sale_id" is null and "__new_drawer_opens"."bill_payment_id" is null) or ("__new_drawer_opens"."reason" in ('bill_payment', 'bill_refund') and "__new_drawer_opens"."till_id" is not null and "__new_drawer_opens"."bill_payment_id" is not null and "__new_drawer_opens"."sale_id" is null) or ("__new_drawer_opens"."reason" in ('cash_sale', 'manual') and "__new_drawer_opens"."till_id" is not null and "__new_drawer_opens"."bill_payment_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_drawer_opens`("id", "till_id", "printer_id", "person_id", "opened_at", "reason", "sale_id", "bill_payment_id", "authorized_by", "via_override") SELECT "id", "till_id", "printer_id", "person_id", "opened_at", "reason", "sale_id", "bill_payment_id", "authorized_by", "via_override" FROM `drawer_opens`;--> statement-breakpoint
DROP TABLE `drawer_opens`;--> statement-breakpoint
ALTER TABLE `__new_drawer_opens` RENAME TO `drawer_opens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
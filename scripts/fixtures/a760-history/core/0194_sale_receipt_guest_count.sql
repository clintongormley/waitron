-- The INSERT copy line is hand-corrected to SELECT the old `guests` column: drizzle copies the new
-- column name from the old table, so a regeneration must paste that line back.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_receipt_guests` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`guest_count` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_receipt_guests_guest_count_ck" CHECK("__new_sale_receipt_guests"."guest_count" is null or (typeof("__new_sale_receipt_guests"."guest_count") = 'integer' and "__new_sale_receipt_guests"."guest_count" between 1 and 999))
);
--> statement-breakpoint
INSERT INTO `__new_sale_receipt_guests`("sale_id", "guest_count", "created_at") SELECT "sale_id", "guests", "created_at" FROM `sale_receipt_guests`;--> statement-breakpoint
DROP TABLE `sale_receipt_guests`;--> statement-breakpoint
ALTER TABLE `__new_sale_receipt_guests` RENAME TO `sale_receipt_guests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
CREATE TABLE `sale_receipt_guests` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`guests` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sale_receipt_guests_guests_ck" CHECK("sale_receipt_guests"."guests" is null or (typeof("sale_receipt_guests"."guests") = 'integer' and "sale_receipt_guests"."guests" between 1 and 999))
);

CREATE TABLE `adjustment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`adjustment_id` text NOT NULL,
	`tender_refund_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`adjustment_id`) REFERENCES `adjustments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tender_refund_id`) REFERENCES `tender_refunds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "adjustment_refunds_amount_ck" CHECK("adjustment_refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adjustment_refunds_adjustment_refund_key` ON `adjustment_refunds` (`adjustment_id`,`tender_refund_id`);--> statement-breakpoint
CREATE INDEX `adjustment_refunds_tender_refund_idx` ON `adjustment_refunds` (`tender_refund_id`);
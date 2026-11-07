ALTER TABLE `payment_refunds` ADD `provider_refund_ref` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `bill_payment_id` text REFERENCES bill_payments(id);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_bill_payment_key` ON `payments` (`bill_payment_id`) WHERE "payments"."bill_payment_id" is not null;
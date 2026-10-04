ALTER TABLE `bill_payment_refunds` ADD `source` text;--> statement-breakpoint
ALTER TABLE `bill_payment_refunds` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `bill_payments` ADD `source` text;--> statement-breakpoint
ALTER TABLE `bill_payments` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `sales` ADD `source` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `unpaid_departures` ADD `source` text;--> statement-breakpoint
ALTER TABLE `unpaid_departures` ADD `device_id` text REFERENCES devices(id);
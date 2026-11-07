ALTER TABLE `invoice_deliveries` ADD `made_by_retry` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_deliveries` ADD `printer_hold` text;
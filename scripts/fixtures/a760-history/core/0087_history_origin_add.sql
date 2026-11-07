ALTER TABLE `order_amendments` ADD `captured_by_source` text NOT NULL;--> statement-breakpoint
ALTER TABLE `order_amendments` ADD `captured_by_device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `drawer_opens` ADD `device_id` text REFERENCES devices(id);
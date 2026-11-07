ALTER TABLE `working_orders` ADD `source` text NOT NULL;--> statement-breakpoint
ALTER TABLE `working_orders` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `working_orders` ADD `location_id` text NOT NULL REFERENCES locations(id);
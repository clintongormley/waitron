ALTER TABLE `payments` ADD `source` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `device_id` text REFERENCES devices(id);
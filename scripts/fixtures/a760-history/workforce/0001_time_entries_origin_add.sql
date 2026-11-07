ALTER TABLE `time_entries` ADD `captured_by_source` text NOT NULL;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `captured_by_device_id` text REFERENCES devices(id);
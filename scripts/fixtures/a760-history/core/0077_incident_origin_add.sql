DROP INDEX `incidents_till_open_idx`;--> statement-breakpoint
DROP INDEX `incidents_open_dedup`;--> statement-breakpoint
ALTER TABLE `incidents` ADD `source` text NOT NULL;--> statement-breakpoint
ALTER TABLE `incidents` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
CREATE INDEX `incidents_origin_open_idx` ON `incidents` (`source`,`device_id`,`detected_at`);
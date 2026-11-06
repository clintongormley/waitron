ALTER TABLE `order_group_events` ADD `actor_device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `order_groups` ADD `fired_by_device_id` text REFERENCES devices(id);
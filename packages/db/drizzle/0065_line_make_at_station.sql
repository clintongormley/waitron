ALTER TABLE `working_order_lines` ADD `make_at_station_id` text REFERENCES kitchen_stations(id);--> statement-breakpoint
ALTER TABLE `order_draft_lines` ADD `make_at_station_id` text REFERENCES kitchen_stations(id);--> statement-breakpoint
CREATE INDEX `ticket_items_waiting_idx` ON `ticket_items` (`station_id`,`state`,`fired_at`);
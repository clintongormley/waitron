CREATE INDEX `floor_reset_tables_zone_pending_idx` ON `floor_reset_tables` (`zone_id`,`pending`);--> statement-breakpoint
CREATE INDEX `floor_today_joins_zone_idx` ON `floor_today_joins` (`zone_id`);
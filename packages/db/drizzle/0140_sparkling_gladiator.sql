DROP INDEX `floor_zones_name_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `floor_zones_name_key` ON `floor_zones` (`location_id`,`name`) WHERE "floor_zones"."active" = 1;
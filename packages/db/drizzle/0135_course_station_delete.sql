DROP INDEX `kitchen_stations_name_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_stations_name_key` ON `kitchen_stations` (`location_id`,`name`) WHERE "kitchen_stations"."active" = 1;--> statement-breakpoint
DROP INDEX `kitchen_courses_name_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_courses_name_key` ON `kitchen_courses` (`location_id`,`name`) WHERE "kitchen_courses"."active" = 1;
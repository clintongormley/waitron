DROP INDEX `departments_location_name_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_location_name_key` ON `departments` (`location_id`,`name`) WHERE "departments"."active" = 1;
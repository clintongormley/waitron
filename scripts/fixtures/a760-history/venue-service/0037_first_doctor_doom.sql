CREATE TABLE `zone_closed_times` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`weekday` integer,
	`special_date_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`special_date_id`) REFERENCES `special_dates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "zone_closed_times_one_day_ck" CHECK(("zone_closed_times"."weekday" is null) <> ("zone_closed_times"."special_date_id" is null)),
	CONSTRAINT "zone_closed_times_weekday_ck" CHECK("zone_closed_times"."weekday" is null or "zone_closed_times"."weekday" between 0 and 6),
	CONSTRAINT "zone_closed_times_step_ck" CHECK(substr("zone_closed_times"."starts_at", 4, 2) in ('00', '15', '30', '45')
      and substr("zone_closed_times"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE INDEX `zone_closed_times_week_idx` ON `zone_closed_times` (`zone_id`,`weekday`);--> statement-breakpoint
CREATE INDEX `zone_closed_times_date_idx` ON `zone_closed_times` (`special_date_id`,`zone_id`);--> statement-breakpoint
ALTER TABLE `special_dates` ADD `kind` text DEFAULT 'working_day' NOT NULL;--> statement-breakpoint
ALTER TABLE `special_dates` ADD `repeat_on` text;--> statement-breakpoint
ALTER TABLE `special_dates` ADD `own_hours` integer DEFAULT false NOT NULL;
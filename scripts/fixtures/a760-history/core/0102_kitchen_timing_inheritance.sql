CREATE TABLE `kitchen_station_timing` (
	`station_id` text PRIMARY KEY NOT NULL,
	`warm_after_minutes` integer,
	`overdue_after_minutes` integer,
	`forgotten_after_minutes` integer,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kitchen_timing_defaults` (
	`location_id` text PRIMARY KEY NOT NULL,
	`warm_after_minutes` integer DEFAULT 5 NOT NULL,
	`overdue_after_minutes` integer DEFAULT 10 NOT NULL,
	`forgotten_after_minutes` integer DEFAULT 15 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kitchen_timing_defaults_ordered" CHECK("kitchen_timing_defaults"."warm_after_minutes" >= 1 and "kitchen_timing_defaults"."warm_after_minutes" < "kitchen_timing_defaults"."overdue_after_minutes" and "kitchen_timing_defaults"."overdue_after_minutes" < "kitchen_timing_defaults"."forgotten_after_minutes")
);

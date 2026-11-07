CREATE TABLE `zone_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`business_day` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zone_service_policies`(`zone_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zone_extensions_step_ck" CHECK(substr("zone_extensions"."starts_at", 4, 2) in ('00', '15', '30', '45')
      and substr("zone_extensions"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_extensions_day_key` ON `zone_extensions` (`zone_id`,`business_day`);
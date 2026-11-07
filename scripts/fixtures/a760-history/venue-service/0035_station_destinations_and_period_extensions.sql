CREATE TABLE `period_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text NOT NULL,
	`business_day` text NOT NULL,
	`period_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`,`department_id`) REFERENCES `menu_periods`(`id`,`department_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "period_extensions_step_ck" CHECK(substr("period_extensions"."starts_at", 4, 2) in ('00', '15', '30', '45')
      and substr("period_extensions"."ends_at", 4, 2) in ('00', '15', '30', '45'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `period_extensions_day_key` ON `period_extensions` (`department_id`,`business_day`);--> statement-breakpoint
ALTER TABLE `station_day_states` ADD `sends_to_station_id` text REFERENCES kitchen_stations(id);
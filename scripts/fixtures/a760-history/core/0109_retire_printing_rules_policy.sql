PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`invoice_locales` text NOT NULL,
	`operation_description` text NOT NULL,
	`fiscal_territory` text DEFAULT 'ES-common' NOT NULL,
	`address_line1` text,
	`address_line2` text,
	`postal_code` text,
	`city` text,
	`province` text,
	`time_zone` text DEFAULT 'Europe/Madrid' NOT NULL,
	`day_cutover` text DEFAULT '06:00:00' NOT NULL,
	`bump_mode` text DEFAULT 'line' NOT NULL,
	`fire_control` text DEFAULT 'waiter' NOT NULL,
	`catalogue_id` text,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "locations_invoice_locales_len" CHECK(json_array_length("__new_locations"."invoice_locales") between 1 and 2),
	CONSTRAINT "locations_bump_mode_ck" CHECK("__new_locations"."bump_mode" in ('line', 'ticket')),
	CONSTRAINT "locations_fire_control_ck" CHECK("__new_locations"."fire_control" in ('waiter', 'kitchen', 'expo'))
);
--> statement-breakpoint
INSERT INTO `__new_locations`("id", "name", "invoice_locales", "operation_description", "fiscal_territory", "address_line1", "address_line2", "postal_code", "city", "province", "time_zone", "day_cutover", "bump_mode", "fire_control", "catalogue_id") SELECT "id", "name", "invoice_locales", "operation_description", "fiscal_territory", "address_line1", "address_line2", "postal_code", "city", "province", "time_zone", "day_cutover", "bump_mode", "fire_control", "catalogue_id" FROM `locations`;--> statement-breakpoint
DROP TABLE `locations`;--> statement-breakpoint
ALTER TABLE `__new_locations` RENAME TO `locations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
CREATE TABLE `route_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`position` integer NOT NULL,
	`zone_id` text,
	`category_id` text,
	`product_id` text,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "route_exceptions_what_ck" CHECK(not ("route_exceptions"."category_id" is not null and "route_exceptions"."product_id" is not null)),
	CONSTRAINT "route_exceptions_condition_ck" CHECK("route_exceptions"."zone_id" is not null or "route_exceptions"."category_id" is not null or "route_exceptions"."product_id" is not null),
	CONSTRAINT "route_exceptions_target_ck" CHECK(("route_exceptions"."station_id" is not null) + (nullif("route_exceptions"."no_preparation", false) is not null) = 1)
);
--> statement-breakpoint
CREATE INDEX `route_exceptions_order_idx` ON `route_exceptions` (`location_id`,`position`);--> statement-breakpoint
CREATE TABLE `station_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`category_id` text NOT NULL,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "station_claims_target_ck" CHECK(("station_claims"."station_id" is not null) + (nullif("station_claims"."no_preparation", false) is not null) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `station_claims_folder_key` ON `station_claims` (`location_id`,`category_id`);
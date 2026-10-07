CREATE TABLE `routing_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`category_id` text,
	`product_id` text,
	`zone_id` text,
	`station_id` text,
	`no_preparation` integer DEFAULT false NOT NULL,
	`no_category` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zone_id`) REFERENCES `floor_zones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routing_cells_subject_ck" CHECK(not ("routing_cells"."category_id" is not null and "routing_cells"."product_id" is not null)),
	CONSTRAINT "routing_cells_coordinate_ck" CHECK(not ("routing_cells"."category_id" is null and "routing_cells"."product_id" is null and "routing_cells"."no_category" = 0 and "routing_cells"."zone_id" is null)),
	CONSTRAINT "routing_cells_target_ck" CHECK(("routing_cells"."station_id" is not null and "routing_cells"."no_preparation" = 0) or ("routing_cells"."station_id" is null and "routing_cells"."no_preparation" = 1)),
	CONSTRAINT "routing_cells_no_category_ck" CHECK("routing_cells"."no_category" = 0 or ("routing_cells"."no_category" = 1 and "routing_cells"."category_id" is null and "routing_cells"."product_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_category_every_zone_key` ON `routing_cells` (`location_id`,`category_id`) WHERE "routing_cells"."category_id" is not null and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_category_zone_key` ON `routing_cells` (`location_id`,`category_id`,`zone_id`) WHERE "routing_cells"."category_id" is not null and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_product_every_zone_key` ON `routing_cells` (`location_id`,`product_id`) WHERE "routing_cells"."product_id" is not null and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_product_zone_key` ON `routing_cells` (`location_id`,`product_id`,`zone_id`) WHERE "routing_cells"."product_id" is not null and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_all_zone_key` ON `routing_cells` (`location_id`,`zone_id`) WHERE "routing_cells"."category_id" is null and "routing_cells"."product_id" is null and "routing_cells"."no_category" = 0 and "routing_cells"."zone_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_no_category_every_zone_key` ON `routing_cells` (`location_id`,`no_category`) WHERE "routing_cells"."no_category" = 1 and "routing_cells"."zone_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `routing_cells_no_category_zone_key` ON `routing_cells` (`location_id`,`no_category`,`zone_id`) WHERE "routing_cells"."no_category" = 1 and "routing_cells"."zone_id" is not null;
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_working_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`working_order_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`product_id` text,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`descriptions` text NOT NULL,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`price_quantity` integer DEFAULT 1000 NOT NULL,
	`unit_price_gross` integer NOT NULL,
	`vat_class` text NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`served_at` text,
	`served_quantity` integer DEFAULT 0 NOT NULL,
	`course_id` text,
	`make_at_station_id` text,
	`parent_line_id` text,
	`note` text,
	`sent_at` text,
	`extra_list_id` text,
	`classification` text,
	`group_id` text,
	`credited_to` text,
	`list_unit_price_gross` integer,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `order_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`make_at_station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_order_lines_unit_precision_ck" CHECK("__new_working_order_lines"."unit_precision" is null or "__new_working_order_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK("__new_working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_price_quantity_ck" CHECK("__new_working_order_lines"."price_quantity" > 0),
	CONSTRAINT "working_order_lines_vat_class_ck" CHECK("__new_working_order_lines"."vat_class" in ('general','reduced','super_reduced','zero')),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK("__new_working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_working_order_lines`("id", "working_order_id", "line_no", "name", "product_id", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "descriptions", "option_snapshots", "unit_name", "unit_precision", "quantity", "price_quantity", "unit_price_gross", "vat_class", "line_total", "category", "served_at", "served_quantity", "course_id", "make_at_station_id", "parent_line_id", "note", "sent_at", "extra_list_id", "classification", "group_id", "credited_to", "list_unit_price_gross") SELECT "id", "working_order_id", "line_no", "name", "product_id", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "descriptions", "option_snapshots", "unit_name", "unit_precision", "quantity", "price_quantity", "unit_price_gross", "vat_class", "line_total", "category", "served_at", "served_quantity", "course_id", "make_at_station_id", "parent_line_id", "note", "sent_at", "extra_list_id", "classification", "group_id", "credited_to", "list_unit_price_gross" FROM `working_order_lines`;--> statement-breakpoint
DROP TABLE `working_order_lines`;--> statement-breakpoint
ALTER TABLE `__new_working_order_lines` RENAME TO `working_order_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `working_order_lines_group_idx` ON `working_order_lines` (`group_id`);--> statement-breakpoint
CREATE INDEX `working_order_lines_parent_idx` ON `working_order_lines` (`parent_line_id`);--> statement-breakpoint
CREATE INDEX `working_order_lines_order_idx` ON `working_order_lines` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `working_order_lines_line_no_key` ON `working_order_lines` (`working_order_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `__new_sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`name` text NOT NULL,
	`descriptions` text NOT NULL,
	`variant_name` text,
	`variant_descriptions` text,
	`variant_kitchen_name` text,
	`kitchen_name` text,
	`option_snapshots` text DEFAULT '[]' NOT NULL,
	`unit_name` text,
	`unit_precision` integer,
	`quantity` integer NOT NULL,
	`price_quantity` integer DEFAULT 1000 NOT NULL,
	`unit_price` integer NOT NULL,
	`vat_rate` integer NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`parent_line_id` text,
	`product_id` text,
	`parent_product_id` text,
	`menu_id` text,
	`menu_version_id` text,
	`line_gross` integer,
	`classification` text,
	`corrects_line_id` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrects_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sale_lines_unit_precision_ck" CHECK("__new_sale_lines"."unit_precision" is null or "__new_sale_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "sale_lines_quantity_ck" CHECK("__new_sale_lines"."quantity" <> 0),
	CONSTRAINT "sale_lines_price_quantity_ck" CHECK("__new_sale_lines"."price_quantity" > 0),
	CONSTRAINT "sale_lines_vat_rate_ck" CHECK("__new_sale_lines"."vat_rate" >= 0 and "__new_sale_lines"."vat_rate" <= 10000),
	CONSTRAINT "sale_lines_line_no_ck" CHECK("__new_sale_lines"."line_no" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_sale_lines`("id", "sale_id", "line_no", "name", "descriptions", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "option_snapshots", "unit_name", "unit_precision", "quantity", "price_quantity", "unit_price", "vat_rate", "line_total", "category", "parent_line_id", "product_id", "parent_product_id", "menu_id", "menu_version_id", "line_gross", "classification", "corrects_line_id") SELECT "id", "sale_id", "line_no", "name", "descriptions", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "option_snapshots", "unit_name", "unit_precision", "quantity", "price_quantity", "unit_price", "vat_rate", "line_total", "category", "parent_line_id", "product_id", "parent_product_id", "menu_id", "menu_version_id", "line_gross", "classification", "corrects_line_id" FROM `sale_lines`;--> statement-breakpoint
DROP TABLE `sale_lines`;--> statement-breakpoint
ALTER TABLE `__new_sale_lines` RENAME TO `sale_lines`;--> statement-breakpoint
CREATE INDEX `sale_lines_sale_idx` ON `sale_lines` (`sale_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_lines_line_no_key` ON `sale_lines` (`sale_id`,`line_no`);
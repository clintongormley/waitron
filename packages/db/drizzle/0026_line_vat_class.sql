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
	`unit_price_gross` integer NOT NULL,
	`vat_class` text NOT NULL,
	`line_total` integer NOT NULL,
	`category` text,
	`served_at` text,
	`course_id` text,
	`parent_line_id` text,
	`note` text,
	`sent_at` text,
	`extra_list_id` text,
	`classification` text,
	FOREIGN KEY (`working_order_id`) REFERENCES `working_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`) REFERENCES `kitchen_courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_line_id`) REFERENCES `working_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "working_order_lines_unit_precision_ck" CHECK("__new_working_order_lines"."unit_precision" is null or "__new_working_order_lines"."unit_precision" between 0 and 3),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK("__new_working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_vat_class_ck" CHECK("__new_working_order_lines"."vat_class" in ('general','reduced','super_reduced','zero')),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK("__new_working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_working_order_lines`("id", "working_order_id", "line_no", "name", "product_id", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "descriptions", "option_snapshots", "unit_name", "unit_precision", "quantity", "unit_price_gross", "vat_class", "line_total", "category", "served_at", "course_id", "parent_line_id", "note", "sent_at", "extra_list_id", "classification") SELECT "id", "working_order_id", "line_no", "name", "product_id", "variant_name", "variant_descriptions", "variant_kitchen_name", "kitchen_name", "descriptions", "option_snapshots", "unit_name", "unit_precision", "quantity", "unit_price_gross", "vat_class", "line_total", "category", "served_at", "course_id", "parent_line_id", "note", "sent_at", "extra_list_id", "classification" FROM `working_order_lines`;--> statement-breakpoint
DROP TABLE `working_order_lines`;--> statement-breakpoint
ALTER TABLE `__new_working_order_lines` RENAME TO `working_order_lines`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `working_order_lines_order_idx` ON `working_order_lines` (`working_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `working_order_lines_line_no_key` ON `working_order_lines` (`working_order_id`,`line_no`);
CREATE TABLE `content_languages` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`default_language` text NOT NULL,
	`languages` text NOT NULL,
	CONSTRAINT "content_languages_singleton_ck" CHECK("content_languages"."id" = 1),
	CONSTRAINT "content_languages_default_ck" CHECK(instr("content_languages"."languages", '"' || "content_languages"."default_language" || '"') > 0),
	CONSTRAINT "content_languages_list_ck" CHECK(json_array_length("content_languages"."languages") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`product_id` text NOT NULL,
	`section_id` text NOT NULL,
	`gross_price` integer NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`menu_id`,`section_id`) REFERENCES `menu_sections`(`menu_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_gross_price_ck" CHECK("menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `menu_items_menu_order_idx` ON `menu_items` (`menu_id`,`display_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_id_product_key` ON `menu_items` (`id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_menu_product_key` ON `menu_items` (`menu_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `menu_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_sections_menu_order_idx` ON `menu_sections` (`menu_id`,`display_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_sections_menu_id_key` ON `menu_sections` (`menu_id`,`id`);--> statement-breakpoint
CREATE TABLE `category_details` (
	`category_id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`image` text,
	`color` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `category_details_parent_idx` ON `category_details` (`parent_id`);--> statement-breakpoint
CREATE TABLE `product_categories` (
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `product_categories_category_idx` ON `product_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `product_units` (
	`product_id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `product_units_unit_idx` ON `product_units` (`unit_id`);--> statement-breakpoint
CREATE TABLE `unit_seed_states` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	CONSTRAINT "unit_seed_states_singleton_ck" CHECK("unit_seed_states"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`seed_key` text,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`precision` integer NOT NULL,
	`hardware_unit` text,
	CONSTRAINT "units_precision_ck" CHECK("units"."precision" between 0 and 3),
	CONSTRAINT "units_hardware_unit_ck" CHECK("units"."hardware_unit" in ('kg', 'g', 'mg'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_seed_key_key` ON `units` (`seed_key`);--> statement-breakpoint
CREATE TABLE `menu_item_variants` (
	`menu_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`unit_price` integer NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`menu_item_id`, `variant_id`),
	FOREIGN KEY (`menu_item_id`,`product_id`) REFERENCES `menu_items`(`id`,`product_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`,`variant_id`) REFERENCES `product_variants`(`product_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_variants_price_ck" CHECK("menu_item_variants"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`image` text,
	`unit_price` integer NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "product_variants_price_ck" CHECK("product_variants"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_product_id_key` ON `product_variants` (`product_id`,`id`);--> statement-breakpoint
CREATE TABLE `option_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`available` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `option_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `option_labels_list_sort_idx` ON `option_labels` (`list_id`,`sort`);--> statement-breakpoint
CREATE TABLE `option_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`default_label_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extra_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`max_quantity` integer DEFAULT 1 NOT NULL,
	`preselected` integer DEFAULT false NOT NULL,
	`price` integer,
	FOREIGN KEY (`list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extra_list_items_qty_ck" CHECK("extra_list_items"."max_quantity" >= 1),
	CONSTRAINT "extra_list_items_price_ck" CHECK("extra_list_items"."price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extra_list_items_list_product_uq` ON `extra_list_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `extra_list_items_list_sort_idx` ON `extra_list_items` (`list_id`,`sort`);--> statement-breakpoint
CREATE TABLE `extra_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`customer_name` text,
	`kitchen_name` text,
	`min_picks` integer DEFAULT 0 NOT NULL,
	`max_picks` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "extra_lists_picks_ck" CHECK("extra_lists"."min_picks" >= 0 and ("extra_lists"."max_picks" is null or "extra_lists"."max_picks" >= "extra_lists"."min_picks"))
);
--> statement-breakpoint
CREATE TABLE `menu_item_extra_items` (
	`menu_item_id` text NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price` integer,
	`available` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`menu_item_id`, `list_id`, `product_id`),
	FOREIGN KEY (`menu_item_id`,`list_id`) REFERENCES `menu_item_extra_lists`(`menu_item_id`,`list_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_extra_items_price_ck" CHECK("menu_item_extra_items"."price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `menu_item_extra_items_list_product_idx` ON `menu_item_extra_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `menu_item_extra_lists` (
	`menu_item_id` text NOT NULL,
	`list_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`menu_item_id`, `list_id`),
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_item_extra_lists_list_idx` ON `menu_item_extra_lists` (`list_id`);--> statement-breakpoint
CREATE TABLE `product_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`extra_list_id` text,
	`option_list_id` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`extra_list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_list_id`) REFERENCES `option_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_modifiers_one_reference_ck" CHECK(("product_modifiers"."extra_list_id" is null) <> ("product_modifiers"."option_list_id" is null))
);
--> statement-breakpoint
CREATE INDEX `product_modifiers_product_sort_idx` ON `product_modifiers` (`product_id`,`sort`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_modifiers_product_extra_uq` ON `product_modifiers` (`product_id`,`extra_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_modifiers_product_option_uq` ON `product_modifiers` (`product_id`,`option_list_id`);
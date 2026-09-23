CREATE TABLE `menu_item_variant_overrides` (
	`menu_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`price` integer,
	`offered` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`menu_item_id`, `variant_id`),
	FOREIGN KEY (`menu_item_id`,`product_id`) REFERENCES `menu_items`(`id`,`product_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`,`variant_id`) REFERENCES `products`(`parent_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_variant_overrides_price_ck" CHECK("menu_item_variant_overrides"."price" >= 0),
	CONSTRAINT "menu_item_variant_overrides_overrides_ck" CHECK("menu_item_variant_overrides"."price" is not null or "menu_item_variant_overrides"."offered" = 0)
);

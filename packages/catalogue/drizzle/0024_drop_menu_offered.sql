PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_menu_item_variant_overrides` (
	`menu_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`price` integer,
	PRIMARY KEY(`menu_item_id`, `variant_id`),
	FOREIGN KEY (`menu_item_id`,`product_id`) REFERENCES `menu_items`(`id`,`product_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`,`variant_id`) REFERENCES `products`(`parent_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_variant_overrides_price_ck" CHECK("__new_menu_item_variant_overrides"."price" >= 0),
	CONSTRAINT "menu_item_variant_overrides_overrides_ck" CHECK("__new_menu_item_variant_overrides"."price" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_menu_item_variant_overrides`("menu_item_id", "product_id", "variant_id", "price") SELECT "menu_item_id", "product_id", "variant_id", "price" FROM `menu_item_variant_overrides`;--> statement-breakpoint
DROP TABLE `menu_item_variant_overrides`;--> statement-breakpoint
ALTER TABLE `__new_menu_item_variant_overrides` RENAME TO `menu_item_variant_overrides`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `menu_items` DROP COLUMN `offered`;
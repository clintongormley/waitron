PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`product_id` text NOT NULL,
	`section_id` text NOT NULL,
	`gross_price` integer,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`menu_id`,`section_id`) REFERENCES `menu_sections`(`menu_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_gross_price_ck" CHECK("__new_menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_menu_items`("id", "menu_id", "product_id", "section_id", "gross_price", "display_order", "active") SELECT "id", "menu_id", "product_id", "section_id", "gross_price", "display_order", "active" FROM `menu_items`;--> statement-breakpoint
DROP TABLE `menu_items`;--> statement-breakpoint
ALTER TABLE `__new_menu_items` RENAME TO `menu_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `menu_items_menu_order_idx` ON `menu_items` (`menu_id`,`display_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_id_product_key` ON `menu_items` (`id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_menu_product_key` ON `menu_items` (`menu_id`,`product_id`);
CREATE TABLE `menu_details` (
	`menu_id` text PRIMARY KEY NOT NULL,
	`root_section_id` text NOT NULL,
	`default_home_layout_id` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_home_layout_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_details_root_uq` ON `menu_details` (`root_section_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`product_id` text NOT NULL,
	`gross_price` integer,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_gross_price_ck" CHECK("__new_menu_items"."gross_price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_menu_items`("id", "menu_id", "product_id", "gross_price", "active") SELECT "id", "menu_id", "product_id", "gross_price", "active" FROM `menu_items`;--> statement-breakpoint
DROP TABLE `menu_items`;--> statement-breakpoint
ALTER TABLE `__new_menu_items` RENAME TO `menu_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_id_product_key` ON `menu_items` (`id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_menu_product_key` ON `menu_items` (`menu_id`,`product_id`);
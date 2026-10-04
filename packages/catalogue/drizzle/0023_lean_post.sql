PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_extra_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`max_quantity` integer DEFAULT 1,
	`preselected` integer DEFAULT false NOT NULL,
	`price` integer,
	`portion` integer DEFAULT 1000 NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `extra_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extra_list_items_qty_ck" CHECK("__new_extra_list_items"."max_quantity" >= 1),
	CONSTRAINT "extra_list_items_price_ck" CHECK("__new_extra_list_items"."price" >= 0),
	CONSTRAINT "extra_list_items_portion_ck" CHECK("__new_extra_list_items"."portion" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_extra_list_items`("id", "list_id", "product_id", "sort", "max_quantity", "preselected", "price", "portion") SELECT "id", "list_id", "product_id", "sort", "max_quantity", "preselected", "price", "portion" FROM `extra_list_items`;--> statement-breakpoint
DROP TABLE `extra_list_items`;--> statement-breakpoint
ALTER TABLE `__new_extra_list_items` RENAME TO `extra_list_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `extra_list_items_list_product_uq` ON `extra_list_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `extra_list_items_list_sort_idx` ON `extra_list_items` (`list_id`,`sort`);
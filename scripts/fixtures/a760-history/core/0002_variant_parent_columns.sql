ALTER TABLE `products` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `variant_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `products_id_catalogue_key` ON `products` (`id`,`catalogue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_parent_id_key` ON `products` (`parent_id`,`id`);
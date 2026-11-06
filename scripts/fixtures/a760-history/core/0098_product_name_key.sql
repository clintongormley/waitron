ALTER TABLE `products` ADD `name_key` text;--> statement-breakpoint
CREATE INDEX `products_name_key_idx` ON `products` (`name_key`);
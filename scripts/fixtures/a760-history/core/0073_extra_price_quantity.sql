ALTER TABLE `working_order_lines` ADD `price_quantity` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_lines` ADD `price_quantity` integer DEFAULT 1000 NOT NULL;
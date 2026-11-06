CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_uq` ON `labels` (`name`);--> statement-breakpoint
CREATE TABLE `product_labels` (
	`product_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `label_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_labels_label_idx` ON `product_labels` (`label_id`);
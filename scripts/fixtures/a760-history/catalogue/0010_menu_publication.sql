CREATE TABLE `menu_publications` (
	`menu_id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`,`menu_id`) REFERENCES `menu_versions`(`id`,`menu_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `menu_version_images` (
	`version_id` text NOT NULL,
	`filename` text NOT NULL,
	PRIMARY KEY(`version_id`, `filename`),
	FOREIGN KEY (`version_id`) REFERENCES `menu_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `menu_version_images_filename_idx` ON `menu_version_images` (`filename`);--> statement-breakpoint
CREATE TABLE `menu_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`number` integer NOT NULL,
	`document` text NOT NULL,
	`content_hash` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_versions_number_ck" CHECK("menu_versions"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_versions_menu_number_uq` ON `menu_versions` (`menu_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_versions_id_menu_key` ON `menu_versions` (`id`,`menu_id`);
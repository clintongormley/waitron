CREATE TABLE `media_image_data` (
	`image_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `media_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_images` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`names` text NOT NULL,
	`alt_text` text NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "media_images_filename_ck" CHECK(substr("media_images"."filename", 1, 64) not glob '*[^0-9a-f]*' and (substr("media_images"."filename", 65) glob '.jpg' or substr("media_images"."filename", 65) glob '.png' or substr("media_images"."filename", 65) glob '.webp')),
	CONSTRAINT "media_images_names_ck" CHECK(json_type("media_images"."names") = 'object' and json_type("media_images"."alt_text") = 'object')
);
--> statement-breakpoint
CREATE INDEX `media_images_date_idx` ON `media_images` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_images_filename_key` ON `media_images` (`filename`);
CREATE TABLE `media_image_blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT "media_image_blobs_hash_ck" CHECK(length("media_image_blobs"."hash") = 64 and "media_image_blobs"."hash" not glob '*[^0-9a-f]*' and instr("media_image_blobs"."hash", char(0)) = 0)
);
--> statement-breakpoint
CREATE TABLE `media_image_edits` (
	`image_id` text PRIMARY KEY NOT NULL,
	`source_hash` text,
	`focus_x` integer DEFAULT 5000 NOT NULL,
	`focus_y` integer DEFAULT 5000 NOT NULL,
	`zoom` integer DEFAULT 100 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`original_filename` text,
	FOREIGN KEY (`image_id`) REFERENCES `media_images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_hash`) REFERENCES `media_image_blobs`(`hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_image_edits_focus_x_ck" CHECK(typeof("media_image_edits"."focus_x") = 'integer' and "media_image_edits"."focus_x" between 0 and 10000),
	CONSTRAINT "media_image_edits_focus_y_ck" CHECK(typeof("media_image_edits"."focus_y") = 'integer' and "media_image_edits"."focus_y" between 0 and 10000),
	CONSTRAINT "media_image_edits_zoom_ck" CHECK(typeof("media_image_edits"."zoom") = 'integer' and "media_image_edits"."zoom" between 100 and 400),
	CONSTRAINT "media_image_edits_revision_ck" CHECK(typeof("media_image_edits"."revision") = 'integer' and "media_image_edits"."revision" between 1 and 9007199254740991),
	CONSTRAINT "media_image_edits_filename_ck" CHECK("media_image_edits"."original_filename" is null or (length("media_image_edits"."original_filename") <= 255 and instr("media_image_edits"."original_filename", char(0)) = 0 and instr("media_image_edits"."original_filename", char(10)) = 0 and instr("media_image_edits"."original_filename", char(13)) = 0))
);

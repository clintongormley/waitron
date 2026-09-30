-- media's four triggers name category_details.image, and SQLite refuses to drop the column while
-- they exist. Catalogue migrates before media, so they go here, first. IF EXISTS: on a fresh
-- database catalogue migrates before media has created them.
DROP TRIGGER IF EXISTS category_details_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_rename;

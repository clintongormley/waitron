-- The same four triggers catalogue's `0013_drop_category_image_triggers.sql` drops. On a fresh
-- database `0001_image_references.sql` creates them after catalogue has already dropped
-- category_details.image. Remove those triggers before any later schema changes.
DROP TRIGGER IF EXISTS category_details_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_rename;

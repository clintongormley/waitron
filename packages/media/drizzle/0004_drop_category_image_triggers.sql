-- The same four triggers catalogue's `0013_drop_category_image_triggers.sql` drops. On a fresh
-- database `0001_image_references.sql` creates them after catalogue has already dropped
-- category_details.image (SQLite accepts a trigger naming a missing column), and a trigger left
-- naming a missing column makes SQLite refuse every later DROP COLUMN or RENAME COLUMN, on any table.
DROP TRIGGER IF EXISTS category_details_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_rename;

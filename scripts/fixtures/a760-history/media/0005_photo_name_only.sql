-- Drops `alt_text` and `labels` from `media_images`. SQLite cannot drop a column a CHECK names, so
-- drizzle rebuilds the table, and inside the migrator's transaction that rebuild breaks two things
-- a venue holds (`docs/developers/conventions-data.md`, the two rebuild sections):
--
--   * the rename that ends the rebuild fails while a trigger BODY reads `media_images` (the five on
--     `products`, `sections` and `menu_version_images`), and `DROP TABLE` silently drops the six
--     ON `media_images` itself, so every media trigger goes first and comes back last, as
--     `0001`–`0003` wrote them (`0001`'s header says why they are triggers);
--   * `DROP TABLE` deletes every `media_image_data` row through its `ON DELETE CASCADE` key, so the
--     bytes are copied out first and put back after.
--
-- Drizzle generated the rebuild in the middle; everything before and after it is hand-written, and
-- a regeneration must paste both parts back around the regenerated rebuild.

DROP TRIGGER products_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER products_media_image_fk_update;
--> statement-breakpoint
DROP TRIGGER products_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER products_media_image_fk_parent_rename;
--> statement-breakpoint
DROP TRIGGER sections_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER sections_media_image_fk_update;
--> statement-breakpoint
DROP TRIGGER sections_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER sections_media_image_fk_parent_rename;
--> statement-breakpoint
DROP TRIGGER menu_version_images_media_image_fk_insert;
--> statement-breakpoint
DROP TRIGGER menu_version_images_media_image_fk_parent_delete;
--> statement-breakpoint
DROP TRIGGER menu_version_images_media_image_fk_parent_rename;
--> statement-breakpoint
CREATE TABLE `__media_image_data_stash` AS SELECT `image_id`, `bytes` FROM `media_image_data`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_images` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`names` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "media_images_filename_ck" CHECK(substr("__new_media_images"."filename", 1, 64) not glob '*[^0-9a-f]*' and (substr("__new_media_images"."filename", 65) glob '.jpg' or substr("__new_media_images"."filename", 65) glob '.png' or substr("__new_media_images"."filename", 65) glob '.webp')),
	CONSTRAINT "media_images_names_ck" CHECK(json_type("__new_media_images"."names") = 'object')
);
--> statement-breakpoint
INSERT INTO `__new_media_images`("id", "filename", "names", "created_at", "updated_at") SELECT "id", "filename", "names", "created_at", "updated_at" FROM `media_images`;--> statement-breakpoint
DROP TABLE `media_images`;--> statement-breakpoint
ALTER TABLE `__new_media_images` RENAME TO `media_images`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `media_images_date_idx` ON `media_images` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_images_filename_key` ON `media_images` (`filename`);--> statement-breakpoint
INSERT INTO `media_image_data` (`image_id`, `bytes`) SELECT `image_id`, `bytes` FROM `__media_image_data_stash`;
--> statement-breakpoint
DROP TABLE `__media_image_data_stash`;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_update
BEFORE UPDATE OF image ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER products_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'products_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM products WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_insert
BEFORE INSERT ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_update
BEFORE UPDATE OF image ON sections
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER sections_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'sections_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM sections WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_insert
BEFORE INSERT ON menu_version_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE NOT exists (SELECT 1 FROM media_images WHERE filename = new.filename);
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename
  );
END;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (
      SELECT 1 FROM menu_version_images
      JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
      WHERE menu_version_images.filename = old.filename
    );
END;

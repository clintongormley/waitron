-- A photo a LIVE menu version names cannot be deleted or renamed: the version's document is
-- served as it was published, so the photo must stay. A version stops holding its photos once its
-- menu publishes another one. `0001_image_references.sql`'s header says why these are triggers.
-- Guard: `packages/media/src/image-references.test.ts`.

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

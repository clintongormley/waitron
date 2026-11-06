-- A photo stays while a live menu version or a queued edition names it.
DROP TRIGGER IF EXISTS menu_version_images_media_image_fk_parent_delete;
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
  )
  OR exists (
    SELECT 1 FROM menu_version_images
    JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
    WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
  );
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS menu_version_images_media_image_fk_parent_rename;
--> statement-breakpoint
CREATE TRIGGER menu_version_images_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'menu_version_images_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND (
      exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename
      )
      OR exists (
        SELECT 1 FROM menu_version_images
        JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id
        WHERE menu_version_images.filename = old.filename AND menu_scheduled_publications.state = 'queued'
      )
    );
END;

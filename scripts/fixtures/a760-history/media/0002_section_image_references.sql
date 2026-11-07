-- `sections.image` names a photo in `media_images`, guarded by the same four triggers
-- `0001_image_references.sql` puts on `category_details.image`. That file's header says why the
-- reference is triggers rather than a key, and what a trigger does not do that a key would.
-- Guard: `packages/media/src/image-references.test.ts`.

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

-- The photo an include's folder names (`section_members.folder_overrides`, key `image`) is held as `0002_section_image_references.sql` holds `sections.image`.
-- The lookups write `folder_overrides ->> '$.image'` because that is the expression catalogue's `section_members_folder_image_idx` indexes; SQLite uses an expression index only for the same expression.

CREATE TRIGGER section_members_media_image_fk_insert
BEFORE INSERT ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_update
BEFORE UPDATE OF folder_overrides ON section_members
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE json_extract(new.folder_overrides, '$.image') IS NOT NULL
    AND NOT exists (
      SELECT 1 FROM media_images WHERE filename = json_extract(new.folder_overrides, '$.image')
    );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE exists (
    SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
  );
END;
--> statement-breakpoint
CREATE TRIGGER section_members_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'section_members_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (
      SELECT 1 FROM section_members WHERE folder_overrides ->> '$.image' = old.filename
    );
END;

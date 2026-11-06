-- The sections rebuild cascades members and is refused by menu_details' keys. Carry those rows
-- across so an existing menu can upgrade; library sections are dropped rather than converted.
-- Media's parent triggers read sections during rename and are recreated by its next migration.
DROP TRIGGER IF EXISTS sections_media_image_fk_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_parent_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS sections_media_image_fk_parent_rename;--> statement-breakpoint
DELETE FROM sections WHERE role = 'library';--> statement-breakpoint
CREATE TABLE __keep_section_members AS SELECT id, section_id, position, product_id, child_section_id FROM section_members;--> statement-breakpoint
CREATE TABLE __keep_menu_details AS SELECT menu_id, root_section_id, default_home_layout_id FROM menu_details;--> statement-breakpoint
DELETE FROM menu_details;--> statement-breakpoint
DELETE FROM section_members;

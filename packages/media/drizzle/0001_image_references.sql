-- `products.image` and `category_details.image` name a `media_images.filename`, held as triggers
-- because neither can be a declared foreign key (below).
--
-- Guard: `packages/media/src/image-references.test.ts`.
--
-- THE TWO-FILE RULE PERMITS THEM. `CLAUDE.md` §3: a table's class chooses the database FILE, and no
-- foreign key may join a `local` table to a `ledger`/`state` one. All three tables here are `state`,
-- so all three live in `venue.db`. `scripts/two-file-foreign-keys.test.ts` reads drizzle's
-- generated snapshots, so it never sees these either way.
--
-- WHY NOT DECLARED IN TYPESCRIPT, where regeneration would carry them. A drizzle foreign key names
-- the parent COLUMN object, so the declaration has to sit in the CHILD table's definition —
-- `packages/db/src/schema/catalogue.ts` and `packages/catalogue/src/schema/categories.ts`. Both
-- packages sit BELOW `@waitron/media`, which depends on `@waitron/catalogue` and `@waitron/db`, so
-- importing `media_images` there closes a workspace dependency loop that
-- `scripts/workspace-cycles.test.ts` refuses.
--
-- WHY NOT A REAL KEY ADDED BY REBUILDING THE TABLE. SQLite has no `ALTER TABLE … ADD CONSTRAINT`;
-- the documented way to add one is to build a new table, copy, drop and rename, and that procedure
-- requires `pragma foreign_keys = off` around it. That pragma is a NO-OP inside a transaction, and
-- drizzle wraps every migration in one. Measured on Node v26.7.0 / SQLite 3.53.4 with a control in
-- the other direction: inside `begin`, `pragma foreign_keys = off` leaves `pragma foreign_keys`
-- reading 1; the identical statement outside a transaction leaves it reading 0. Beyond that, a
-- rebuild means copying `products`' whole definition, which `packages/db` owns, into this module's
-- migration, where the next core change to that table would silently leave it stale.
--
-- WHAT A TRIGGER IS NOT:
--
--   1. `pragma foreign_key_list('products')` does not list this, and nothing that enumerates keys
--      from the engine will see it.
--   2. A write naming a missing filename is refused with errcode 1811 (`SQLITE_CONSTRAINT_TRIGGER`),
--      where a declared key refuses it with 787 (`SQLITE_CONSTRAINT_FOREIGNKEY`); a refused delete
--      of an image in use is 1811 either way (measured 2026-10-02 on `node:sqlite`, Node v26.7.0,
--      SQLite 3.53.4, against a declared `on delete restrict` key).
--   3. `pragma defer_foreign_keys = on` moves a KEY's check to commit and does nothing to a
--      trigger, so a caller that empties several tables in one transaction must delete the
--      referencing rows BEFORE the images.
--
-- FOUR TRIGGERS PER KEY, because SQLite has no `BEFORE INSERT OR UPDATE` and no foreign key
-- machinery to borrow: the two that guard a written filename (insert, update of `image`), and the
-- two that guard the parent (`ON DELETE RESTRICT`, and the `ON UPDATE NO ACTION` a declared key
-- has by default — a stored filename is the hash of the bytes, and the rule is kept so that nothing
-- silently gains the ability to rename one).
-- `is not` is SQLite's null-safe inequality: `1 is not 2` and `1 is not null` are 1, `null is not
-- null` is 0 (measured 2026-10-02 on `node:sqlite`, Node v26.7.0, SQLite 3.53.4).

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
CREATE TRIGGER category_details_media_image_fk_insert
BEFORE INSERT ON category_details
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'category_details_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER category_details_media_image_fk_update
BEFORE UPDATE OF image ON category_details
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'category_details_media_image_fk')
  WHERE new.image IS NOT NULL
    AND NOT exists (SELECT 1 FROM media_images WHERE filename = new.image);
END;
--> statement-breakpoint
CREATE TRIGGER category_details_media_image_fk_parent_delete
BEFORE DELETE ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'category_details_media_image_fk')
  WHERE exists (SELECT 1 FROM category_details WHERE image = old.filename);
END;
--> statement-breakpoint
CREATE TRIGGER category_details_media_image_fk_parent_rename
BEFORE UPDATE OF filename ON media_images
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'category_details_media_image_fk')
  WHERE new.filename IS NOT old.filename
    AND exists (SELECT 1 FROM category_details WHERE image = old.filename);
END;

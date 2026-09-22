-- The two foreign keys `products.image` and `category_details.image` carried, as triggers.
--
-- Under PostgreSQL these were `products_media_image_fk` and `category_details_media_image_fk`, both
-- `FOREIGN KEY (image) REFERENCES media_images (filename) ON DELETE RESTRICT`, written by hand in
-- `--custom` SQL: `git show origin/main:packages/media/drizzle/0001_media_baseline_sql.sql`, lines
-- 106-112. Regenerating every migration set from the TypeScript schema for the storage switch
-- dropped both — a key that lives only in hand-written SQL does not survive a regeneration — and a
-- `media_image_fk` grep over this tree's `.sql` files found nothing. This file is where they come
-- back. Guard: `packages/media/src/image-references.test.ts`, which pins the eight names AND tries
-- a real offending write against each rule with an accepting control beside it.
--
-- THE TWO-FILE RULE PERMITS THEM. `CLAUDE.md` §3: a table's class chooses the database FILE, and no
-- foreign key may join a `local` table to a `ledger`/`state` one. All three tables here are `state`,
-- so all three live in `venue.db`: `products` at `packages/db/src/classification.ts:50`,
-- `category_details` at `packages/catalogue/src/classification.ts:7`, `media_images` at
-- `packages/media/src/module.ts:9`. `scripts/two-file-foreign-keys.test.ts` reads drizzle's
-- generated snapshots, so it never sees these either way (its own gap 2).
--
-- WHY NOT DECLARED IN TYPESCRIPT, where regeneration would carry them. A drizzle foreign key names
-- the parent COLUMN object, so the declaration has to sit in the CHILD table's definition —
-- `packages/db/src/schema/catalogue.ts` and `packages/catalogue/src/schema/categories.ts`. Both
-- packages sit BELOW `@waitron/media`, which depends on `@waitron/catalogue` and `@waitron/db`, so
-- importing `media_images` there closes a workspace dependency loop that
-- `scripts/workspace-cycles.test.ts` refuses. This is the same reason `9fdae934` restored 31 of the
-- 33 lost keys and left exactly these two out.
--
-- WHY NOT A REAL KEY ADDED BY REBUILDING THE TABLE. SQLite has no `ALTER TABLE … ADD CONSTRAINT`;
-- the documented way to add one is to build a new table, copy, drop and rename, and that procedure
-- requires `pragma foreign_keys = off` around it. That pragma is a NO-OP inside a transaction, and
-- drizzle wraps every migration in one (`BEGIN` at
-- `drizzle-orm@0.45.2/sqlite-core/dialect.js:657`). Measured on Node v26.7.0 / SQLite 3.53.4 with a
-- control in the other direction: inside `begin`, `pragma foreign_keys = off` leaves
-- `pragma foreign_keys` reading 1; the identical statement outside a transaction leaves it reading
-- 0. Beyond that, a rebuild means copying `products`' whole definition — 24 columns, 4 foreign keys
-- and 2 checks that `packages/db` owns — into this module's migration, where the next core change
-- to that table would silently leave it stale.
--
-- WHAT A TRIGGER IS NOT. Four things, none of them reachable from a caller in the tree today:
--
--   1. `pragma foreign_key_list('products')` does not list this, and nothing that enumerates keys
--      from the engine will see it.
--   2. The refusal arrives as errcode 1811 (`SQLITE_CONSTRAINT_TRIGGER`), not 787
--      (`SQLITE_CONSTRAINT_FOREIGNKEY`). `packages/layouts/src/canvas-store.ts` is the one place
--      that separates those two codes, and it reads them for keys of its own, never for these.
--   3. `pragma defer_foreign_keys = on` moves a KEY's check to commit and does nothing to a
--      trigger, so a caller that empties several tables in one transaction must delete the
--      referencing rows BEFORE the images. Both callers that do this are already in that order:
--      `apps/server/src/configuration-transfer.ts` deletes the declared tables in reverse of the
--      order it inserts them, and media declares `media_images` `before` `products` and
--      `category_details` (`packages/media/src/module.ts:19`); and the test reset in
--      `packages/db/src/testing/venue-db.ts` drops every trigger before its deletes and recreates
--      them after.
--   4. `raise` takes a LITERAL, so the message cannot name the row or the filename. It is the
--      constraint's own name and nothing else, which is the one part of PostgreSQL's message that
--      located the rule.
--
-- FOUR TRIGGERS PER KEY, because SQLite has no `BEFORE INSERT OR UPDATE` and no foreign key
-- machinery to borrow: the two that guard a written filename (insert, update of `image`), and the
-- two that guard the parent (`ON DELETE RESTRICT`, and the `ON UPDATE NO ACTION` that the key
-- carried by default — nothing in the tree renames a stored filename, since it is the hash of the
-- bytes, and the rule is restored rather than dropped so that nothing silently gains the ability).
-- `is not` is SQLite's null-safe inequality, PostgreSQL's `IS DISTINCT FROM`.
--
-- `product_variants.image` is deliberately NOT guarded: it carried no key on `origin/main` either
-- (the constraint list in `packages/media/src/images.pg.test.ts` names only these two and
-- `media_image_data_image_fk`), and restoring more than was there would be a new rule, not a
-- restoration. `listImageUsages` still counts a variant, so a photo a variant uses cannot be
-- deleted through the product's own path.

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

-- A variant is exactly one level deep, its parent is fixed when it is created, and a product's id
-- never changes (spec §1.2, §15.7).
--
-- A product with a `parent_id` IS a variant. The composite foreign key on `products`
-- (`packages/db/src/schema/catalogue.ts`) holds the parent in the same catalogue; what a key cannot
-- say is that the parent is not itself a variant, and these three triggers say it.
--
-- They live on `products`, so a later migration that RECREATES `products` (drizzle's rebuild for a
-- column change SQLite cannot `ALTER`) drops them without a word. The name pin in
-- `scripts/behavioural-triggers.test.ts` is what notices; that file also tries a real offending
-- write against each case, with an accepting control beside it. The words each one raises are
-- declared once, in `packages/db/src/trigger-refusals.ts`. The body form and `IS NOT` as the
-- null-safe inequality follow `0001_behavioural_triggers.sql`.

-- A new row naming a parent is refused when that parent is the row itself or is a variant, or when
-- the new row already has variants of its own. The last case exists because foreign keys can be
-- deferred, as configuration transfer defers them (`apps/server/src/configuration-transfer.ts`),
-- so a variant can be written before the parent it names.
--
-- The second statement holds the fixed parent against `INSERT OR REPLACE`, which runs this trigger
-- while the row it replaces is still in the table and never runs the update trigger below. It reads
-- the stored row, so a plain insert of a taken id naming a different parent is refused here too,
-- before the primary key sees it.
CREATE TRIGGER products_variant_one_level_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent must be a product with no parent, and a variant cannot have variants of its own')
  WHERE new.parent_id IS NOT NULL
    AND (new.parent_id = new.id
      OR (SELECT parent_id FROM products WHERE id = new.parent_id) IS NOT NULL
      OR exists (SELECT 1 FROM products WHERE parent_id = new.id));
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE exists (SELECT 1 FROM products WHERE id = new.id AND parent_id IS NOT new.parent_id);
END;
--> statement-breakpoint
-- `parent_id` never changes after insert: not set on a top-level product, not moved, not cleared.
CREATE TRIGGER products_variant_parent_fixed_update
BEFORE UPDATE OF parent_id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE new.parent_id IS NOT old.parent_id;
END;
--> statement-breakpoint
-- `id` never changes after insert. Without this an UPDATE reaches a second level without naming
-- `parent_id`: a variant renamed onto an id a waiting child already names (foreign keys deferred),
-- or `UPDATE OR REPLACE` moving a top-level row onto a variant's id, which deletes the variant and
-- leaves a top-level row in its place.
CREATE TRIGGER products_id_fixed_update
BEFORE UPDATE OF id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a product''s id never changes')
  WHERE new.id IS NOT old.id;
END;

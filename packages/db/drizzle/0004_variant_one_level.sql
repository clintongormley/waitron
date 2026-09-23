-- A variant is exactly one level deep, and its parent never changes (spec §1.2, §15.7).
--
-- A product with a `parent_id` IS a variant. The composite foreign key on `products` (declared in
-- `packages/db/src/schema/catalogue.ts`) holds the parent in the same catalogue; what a key cannot
-- say is that the parent is not itself a variant, so these two triggers say it.
--
-- TWO TRIGGERS MAKE THE WHOLE RULE. The insert trigger refuses a new row that names a parent when
-- that parent has a parent, or when the new row is ITSELF already named as a parent. The second
-- case exists because a variant can be written before its parent while foreign keys are deferred,
-- as configuration transfer defers them (`apps/server/src/configuration-transfer.ts`): measured
-- 2026-09-23 on a database migrated through `applyMigrations`, with `defer_foreign_keys = on` the
-- inserts variant → its parent (naming a third product) → that third product committed a two-level
-- chain when this trigger checked only the named parent; with keys enforced immediately the first
-- insert was refused, 787. Every later way to a second level is an UPDATE of `parent_id`, and the
-- update trigger refuses any change to it outright, which also keeps a variant's parent fixed once
-- it is created.
--
-- THEY LIVE ON `products`, so any later migration that RECREATES `products` (drizzle's rebuild for
-- a column change SQLite cannot `ALTER`) drops them without a word. The name pin in
-- `scripts/behavioural-triggers.test.ts` is what notices; that file also tries a real offending
-- write against each case, with an accepting control beside it.
--
-- The words each one raises are declared once, in `packages/db/src/trigger-refusals.ts`
-- (`VARIANT_ONE_LEVEL_REFUSAL`, `VARIANT_PARENT_FIXED_REFUSAL`), and the guard above asserts them
-- against what a migrated database actually raises. A refusal arrives as errcode 1811
-- (`SQLITE_CONSTRAINT_TRIGGER`) with `message` equal to the raise text.
--
-- The body form (`select raise(abort, '…') where <the refused case>;`) and `is not` as the
-- null-safe inequality follow `0001_behavioural_triggers.sql`.

create trigger products_variant_one_level_insert before insert on products
begin
  select raise(abort, 'a variant''s parent must be a product with no parent')
  where new.parent_id is not null
    and (new.parent_id = new.id
      or (select parent_id from products where id = new.parent_id) is not null
      or exists (select 1 from products where parent_id = new.id));
end;
--> statement-breakpoint
create trigger products_variant_parent_fixed_update before update of parent_id on products
begin
  select raise(abort, 'a variant''s parent is fixed when it is created')
  where new.parent_id is not old.parent_id;
end;

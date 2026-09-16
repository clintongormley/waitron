-- BEFORE the generated tenants change (the 0032/0034 pattern in this set).
--
-- `tenants.id` stops being a random uuid and becomes the integer 1. PostgreSQL has no cast from
-- uuid to integer, so the generated `ALTER COLUMN "id" SET DATA TYPE integer` in the next migration
-- is refused on its own — `42804 column "id" cannot be cast automatically to type integer`, measured
-- on postgres:18-alpine against an EMPTY table, so this is not about existing rows. The two
-- statements below do the change with an explicit `USING`. The generated migration then restates a
-- type the column already has, which does nothing, and sets the default to 1 — that one is real
-- work, because the first statement below drops the old uuid default and nothing else puts one back.
--
-- `USING 1` is the whole conversion. There is at most one taxpayer in any database (the unique on
-- country + tax_id, and every foreign key to this table went in 0033), and that taxpayer becomes
-- row 1. The column keeps its position, which dropping and re-adding it would not.

-- The default is dropped first: `gen_random_uuid()` cannot be cast to integer either, and
-- PostgreSQL checks the default as part of the type change.
ALTER TABLE "tenants" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "id" SET DATA TYPE integer USING 1;

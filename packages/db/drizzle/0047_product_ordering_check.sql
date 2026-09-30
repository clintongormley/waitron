-- `products.ordering` takes exactly `public`, `staff_only` or `not_sold_separately`. The column has no
-- CHECK constraint, because adding one to an existing table makes drizzle rebuild `products`, and a
-- rebuild deletes or refuses the rows of its child tables (CLAUDE.md §3). These two triggers are the
-- refusal instead. The words they raise are declared once, in `packages/db/src/trigger-refusals.ts`,
-- and `scripts/behavioural-triggers.test.ts` tries a real offending write against each. They live on
-- `products`, so a later migration that RECREATES `products` (drizzle's rebuild for a column change
-- SQLite cannot `ALTER`) drops them without a word; that file's name pin is what notices.
CREATE TRIGGER products_ordering_check_insert
BEFORE INSERT ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;
--> statement-breakpoint
CREATE TRIGGER products_ordering_check_update
BEFORE UPDATE OF ordering ON products
FOR EACH ROW
WHEN new.ordering NOT IN ('public', 'staff_only', 'not_sold_separately')
BEGIN
  SELECT raise(abort, 'a product''s ordering must be public, staff_only or not_sold_separately');
END;

-- Restore the product invariants after the table rebuild.
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
CREATE TRIGGER products_variant_parent_fixed_update
BEFORE UPDATE OF parent_id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE new.parent_id IS NOT old.parent_id;
END;
--> statement-breakpoint
CREATE TRIGGER products_id_fixed_update
BEFORE UPDATE OF id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a product''s id never changes')
  WHERE new.id IS NOT old.id;
END;
--> statement-breakpoint
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

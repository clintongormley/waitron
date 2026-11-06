-- `working_order_lines_require_open_parent_update` from `0042_placed_bill_moves.sql`, re-created
-- with `list_unit_price_gross` in both of its unchanged-column lists, so neither a served mark on a
-- settled bill nor a group change on a presented one can also change it.
DROP TRIGGER working_order_lines_require_open_parent_update;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT (
    (
      exists (SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open')
      AND exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open')
    )
    OR (
      exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id)
      AND NOT (new.served_quantity IS old.served_quantity AND new.served_at IS old.served_at)
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.course_id IS old.course_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'placed')
      AND new.id IS old.id
      AND new.working_order_id IS old.working_order_id
      AND new.line_no IS old.line_no
      AND new.name IS old.name
      AND new.product_id IS old.product_id
      AND new.variant_name IS old.variant_name
      AND new.variant_descriptions IS old.variant_descriptions
      AND new.variant_kitchen_name IS old.variant_kitchen_name
      AND new.kitchen_name IS old.kitchen_name
      AND new.descriptions IS old.descriptions
      AND new.option_snapshots IS old.option_snapshots
      AND new.unit_name IS old.unit_name
      AND new.unit_precision IS old.unit_precision
      AND new.quantity IS old.quantity
      AND new.unit_price_gross IS old.unit_price_gross
      AND new.vat_class IS old.vat_class
      AND new.line_total IS old.line_total
      AND new.category IS old.category
      AND new.served_at IS old.served_at
      AND new.course_id IS old.course_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.credited_to IS old.credited_to
      AND new.served_quantity IS old.served_quantity
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
  );
END;

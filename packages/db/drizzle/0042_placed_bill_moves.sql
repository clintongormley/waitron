-- The two triggers as a migrated database stores them, each with one exception for a presented
-- (`placed`) bill that moves whole to another party or to the counter: its fiscal content is
-- unchanged (spec §9). The bill's row may change party, lose its delivery table and move its
-- revision on, so that list names every other column of `working_orders`. Its lines may change
-- kitchen group, which is kitchen state, not invoice content, so that list names every other column
-- of `working_order_lines`. A column added to either table goes into its list too.
DROP TRIGGER working_orders_enforce_transition;
--> statement-breakpoint
CREATE TRIGGER working_orders_enforce_transition
BEFORE UPDATE ON working_orders
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'working order cannot make that transition')
  WHERE NOT (
    old.status = 'open'
    OR (old.status = 'placed' AND new.status IN ('settled', 'abandoned'))
    OR (old.status = 'placed' AND new.status = 'placed'
        AND new.id IS old.id
        AND new.till_id IS old.till_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.payment_attempt_at IS old.payment_attempt_at)
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.till_id IS old.till_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new."party_id" IS old."party_id")
  );
END;
--> statement-breakpoint
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
    )
  );
END;

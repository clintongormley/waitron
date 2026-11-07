-- `working_orders_enforce_transition` from `0001_behavioural_triggers.sql`, re-created with
-- `revision` and `payment_attempt_at` (added by `0014_order_edit_columns.sql`) in its column list.
--
-- Nothing about a settled order may change except the kitchen-handover stamp, so the list names
-- every column of `working_orders` except the two the stamp itself moves (`status`,
-- `collected_at`). A column added to `working_orders` goes into this list too.
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
        AND new.payment_attempt_at IS old.payment_attempt_at)
  );
END;

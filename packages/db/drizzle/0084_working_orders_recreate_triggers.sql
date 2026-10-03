-- The ten triggers `0081_working_orders_drop_triggers.sql` dropped. `working_orders_enforce_transition`
-- is `0056_placed_order_handover.sql`'s with the till replaced by the order's source, device and
-- location. The four locale triggers are `0027_line_vat_class_triggers.sql`'s two inserts and
-- `0064_line_locale_triggers_text_only.sql`'s two updates, reading the order's location from
-- `working_orders.location_id`. The other five are copied unchanged: the two
-- `working_orders_release_main_bill*` from `0045_recreate_triggers_after_rebuild.sql`,
-- `working_order_lines_require_open_parent_update` from `0066_line_make_at_station_trigger.sql`, and
-- its insert and delete twins from `0027_line_vat_class_triggers.sql`.
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
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.collected_at IS old.collected_at
        AND new.payment_attempt_at IS old.payment_attempt_at)
    OR (old.status = 'placed' AND new.status = 'placed'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
        AND new.node_id IS old.node_id
        AND new.order_number IS old.order_number
        AND new.label IS old.label
        AND new.opened_at IS old.opened_at
        AND new.settled_at IS old.settled_at
        AND new.delivery_table_id IS old.delivery_table_id
        AND new.revision IS old.revision
        AND new.payment_attempt_at IS old.payment_attempt_at
        AND new."party_id" IS old."party_id")
    OR (old.status = 'settled' AND new.status = 'settled'
        AND old.collected_at IS NULL AND new.collected_at IS NOT NULL
        AND new.id IS old.id
        AND new.source IS old.source
        AND new.device_id IS old.device_id
        AND new.location_id IS old.location_id
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
CREATE TRIGGER working_orders_release_main_bill
AFTER UPDATE OF status ON working_orders
FOR EACH ROW
WHEN old.status = 'open' AND new.status <> 'open'
BEGIN
  UPDATE parties SET main_bill_id = NULL WHERE main_bill_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER working_orders_release_main_bill_on_move
AFTER UPDATE OF party_id ON working_orders
FOR EACH ROW
WHEN old.party_id IS NOT new.party_id
BEGIN
  UPDATE parties SET main_bill_id = NULL WHERE id = old.party_id AND main_bill_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
  );
END;
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
      AND new.make_at_station_id IS old.make_at_station_id
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
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.sent_at IS old.sent_at
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.credited_to IS old.credited_to
      AND new.served_quantity IS old.served_quantity
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
    OR (
      exists (
        SELECT 1 FROM working_orders
        WHERE id = old.working_order_id AND status IN ('placed', 'settled')
      )
      AND old.sent_at IS NULL
      AND new.sent_at IS NOT NULL
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
      AND new.served_quantity IS old.served_quantity
      AND new.course_id IS old.course_id
      AND new.make_at_station_id IS old.make_at_station_id
      AND new.parent_line_id IS old.parent_line_id
      AND new.note IS old.note
      AND new.extra_list_id IS old.extra_list_id
      AND new.classification IS old.classification
      AND new.group_id IS old.group_id
      AND new.credited_to IS old.credited_to
      AND new.list_unit_price_gross IS old.list_unit_price_gross
    )
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_require_open_parent_delete
BEFORE DELETE ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'lines may only be written while the order is open')
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = old.working_order_id AND status = 'open'
  );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN locations l ON l.id = wo.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE OF descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.descriptions IS NOT old.descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN locations l ON l.id = wo.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN locations l ON l.id = wo.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN locations l ON l.id = wo.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_update
BEFORE UPDATE OF variant_descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.variant_descriptions IS NOT old.variant_descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'variant_descriptions must carry exactly the venue locales')
  WHERE new.variant_descriptions IS NOT NULL
    AND (
      NOT exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN locations l ON l.id = wo.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN locations l ON l.id = wo.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;

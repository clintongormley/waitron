-- `working_order_lines_check_locales_update` and `working_order_lines_check_variant_locales_update`
-- from `0027_line_vat_class_triggers.sql`, re-created to fire only when the update changes the map
-- each one checks or moves the line to another order. A served mark, a kitchen send or a group
-- change on a line written before its location's languages changed is then no longer refused.
-- The bodies are unchanged.
DROP TRIGGER working_order_lines_check_locales_update;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE OF descriptions, working_order_id ON working_order_lines
FOR EACH ROW
WHEN new.descriptions IS NOT old.descriptions OR new.working_order_id IS NOT old.working_order_id
BEGIN
  SELECT raise(abort, 'descriptions must carry exactly the venue locales')
  WHERE NOT exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
       WHERE wo.id = new.working_order_id
    )
    OR exists (
      SELECT 1 FROM json_each(new.descriptions) supplied
       WHERE supplied."key" NOT IN (
         SELECT configured.value FROM working_orders wo
           JOIN tills t ON t.id = wo.till_id
           JOIN locations l ON l.id = t.location_id
           JOIN json_each(l.invoice_locales) configured
          WHERE wo.id = new.working_order_id
       )
    )
    OR exists (
      SELECT 1 FROM working_orders wo
        JOIN tills t ON t.id = wo.till_id
        JOIN locations l ON l.id = t.location_id
        JOIN json_each(l.invoice_locales) configured
       WHERE wo.id = new.working_order_id
         AND configured.value NOT IN (SELECT supplied."key" FROM json_each(new.descriptions) supplied)
    );
END;
--> statement-breakpoint
DROP TRIGGER working_order_lines_check_variant_locales_update;
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
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
         WHERE wo.id = new.working_order_id
      )
      OR exists (
        SELECT 1 FROM json_each(new.variant_descriptions) supplied
         WHERE supplied."key" NOT IN (
           SELECT configured.value FROM working_orders wo
             JOIN tills t ON t.id = wo.till_id
             JOIN locations l ON l.id = t.location_id
             JOIN json_each(l.invoice_locales) configured
            WHERE wo.id = new.working_order_id
         )
      )
      OR exists (
        SELECT 1 FROM working_orders wo
          JOIN tills t ON t.id = wo.till_id
          JOIN locations l ON l.id = t.location_id
          JOIN json_each(l.invoice_locales) configured
         WHERE wo.id = new.working_order_id
           AND configured.value NOT IN (
             SELECT supplied."key" FROM json_each(new.variant_descriptions) supplied
           )
      )
    );
END;

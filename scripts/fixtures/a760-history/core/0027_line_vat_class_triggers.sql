-- 0026_line_vat_class.sql rebuilt working_order_lines, and a SQLite rebuild drops the triggers on
-- the table it drops. These are 0001_behavioural_triggers.sql's seven, unchanged; the reasoning for
-- each is there.
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
  WHERE NOT exists (
    SELECT 1 FROM working_orders WHERE id = new.working_order_id AND status = 'open'
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
CREATE TRIGGER working_order_lines_check_locales_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
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
CREATE TRIGGER working_order_lines_check_variant_locales_insert
BEFORE INSERT ON working_order_lines
FOR EACH ROW
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
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales_update
BEFORE UPDATE ON working_order_lines
FOR EACH ROW
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

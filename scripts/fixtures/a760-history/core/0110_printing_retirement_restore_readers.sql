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

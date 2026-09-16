-- Companion to working_order_lines_check_locales (0001): the optional variant_descriptions map, when
-- present, must carry EXACTLY the venue's configured invoice locales. Same join path and search_path
-- posture as the descriptions check; the only difference is the NULL short-circuit for the nullable
-- column. sale_lines is deliberately left uncovered — like descriptions, its snapshot is the frozen
-- copy of an already-validated working-order line.
CREATE FUNCTION working_order_lines_check_variant_locales()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  configured text[];
  supplied text[];
BEGIN
  IF NEW.variant_descriptions IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.invoice_locales INTO configured
    FROM working_orders wo
    JOIN tills t ON t.id = wo.till_id
    JOIN locations l ON l.id = t.location_id
   WHERE wo.id = NEW.working_order_id;

  IF configured IS NULL THEN
    RAISE EXCEPTION 'working order % has no resolvable location', NEW.working_order_id;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO supplied
    FROM jsonb_object_keys(NEW.variant_descriptions) AS k;

  IF supplied IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(configured) AS c) THEN
    RAISE EXCEPTION
      'variant_descriptions must carry exactly the venue locales % (got %)', configured, supplied;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER working_order_lines_check_variant_locales
  BEFORE INSERT OR UPDATE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_check_variant_locales();

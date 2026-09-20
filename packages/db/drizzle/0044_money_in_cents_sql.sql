-- The coverage check reads four money values out of the tables and adds them up. Its locals were
-- declared `numeric(12, 2)`, which held a decimal amount exactly; the same columns now hold a
-- count of whole cents, and `numeric(12, 2)` admits only ten integer digits, so a large enough
-- amount would be rejected by the local rather than by the check. `bigint` matches what the
-- columns now are and leaves the comparison exact.
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total  bigint;
  corrections bigint;
  tendered    bigint;
  tipped      bigint;
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale (signed; usually negative).
  SELECT coalesce(sum(total), 0) INTO corrections
    FROM sales WHERE corrects_sale_id = p_sale_id;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + corrections + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + corrections + tips is %',
      p_sale_id, tendered, sale_total + corrections + tipped;
  END IF;
END;
$$;

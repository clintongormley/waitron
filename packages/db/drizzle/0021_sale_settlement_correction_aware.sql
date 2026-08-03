-- 0021_sale_settlement_correction_aware.sql
-- Invoice-first headless settlement slice: settlement coverage nets rectificativas, so an
-- invoice-first sale corrected downward (a "take a fiver off") settles at the corrected amount.
-- docs/superpowers/specs/2026-08-03-invoice-first-settlement-design.md
--
-- Replaces the sales_assert_tenders_cover body from 0012. The function stays owned by
-- sales_coverage_checker and SECURITY DEFINER, so its SELECTs still see rows through the role-scoped
-- bypass policies regardless of app.tenant_id (the fail-open fix). The added SELECT is on `sales`,
-- which the checker already reads, so no new grant. Apply the body AS the owner via the same dance
-- 0012 used. The genuine non-superuser apply is exercised by
-- packages/provisioning/src/instance-apply.rls.test.ts, which applies this whole directory as
-- prov_admin (login createdb createrole; rolsuper=f, rolbypassrls=f): a wrong privilege fails there.
GRANT CREATE ON SCHEMA public TO sales_coverage_checker;
--> statement-breakpoint
GRANT sales_coverage_checker TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
SET ROLE sales_coverage_checker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  sale_total  numeric(12, 2);
  corrections numeric(12, 2);
  tendered    numeric(12, 2);
  tipped      numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  -- Net in every rectificativa that corrects this sale (signed; usually negative). corrects_sale_id
  -- is a tenant-consistent FK, so this can only sum same-tenant correctives even though the definer
  -- sees every row.
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
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE sales_coverage_checker FROM CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sales_coverage_checker;

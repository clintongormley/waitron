-- 0012_sale_settlement.sql
-- Piece 2 of the fiscal sequence: payment facts move off the immutable sale so an
-- invoice can be issued before payment settles.
-- docs/superpowers/specs/2026-07-31-sale-settlement-model-design.md

-- Step 1: tenders gains the tip; the sign check tightens from `<> 0` to `> 0`.
-- Retightening validates existing rows, so a stray negative tender in a dev DB fails
-- the migration loudly rather than being silently dropped (design §3). No prod data.
ALTER TABLE "tenders" ADD COLUMN "tip_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_amount_ck";
--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_amount_ck" CHECK ("tenders"."amount" > 0);
--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_tip_amount_ck" CHECK ("tenders"."tip_amount" >= 0 and "tenders"."tip_amount" <= "tenders"."amount");
--> statement-breakpoint

-- Step 2: sale_settlements — append-only, one row per sale, RLS forced, grants,
-- immutability + TRUNCATE triggers. Mirrors tenders' protections in 0005_sales.sql.
CREATE TABLE "sale_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sale_settlements_sale_key" UNIQUE("tenant_id","sale_id")
);
--> statement-breakpoint
ALTER TABLE "sale_settlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sale_settlements" ADD CONSTRAINT "sale_settlements_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE sale_settlements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sale_settlements_tenant_isolation ON sale_settlements
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
REVOKE ALL ON sale_settlements FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_settlements TO app_user;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sale_settlements_block_truncate
  BEFORE TRUNCATE ON sale_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- Step 3: replace the coverage function body — compare against the new shape,
--   sum(tenders.amount) = sales.total + sum(tenders.tip_amount)
-- The function stays owned by sales_coverage_checker and SECURITY DEFINER (0005),
-- so its SELECTs still see rows through the role-scoped bypass policies regardless
-- of app.tenant_id — the fail-open fix. Replace the body AS the owner: grant
-- membership + schema CREATE to CURRENT_USER's role, SET ROLE, CREATE OR REPLACE,
-- then revoke. Mirrors the ownership dance 0005 used for ALTER FUNCTION OWNER.
-- (The genuine non-superuser apply is packages/provisioning/src/instance-apply.pg.test.ts,
--  which applies this migration set — the `core` manifest, resolving to ../db/drizzle and so
--  including this file — as `prov_admin` (login createdb createrole; the suite asserts rolsuper=f,
--  rolbypassrls=f): if the privileges are wrong, this dance fails loudly there. packages/db's OWN
--  real-PG suite runs migrations as the superuser OWNER (src/testing/harness.ts) and so does NOT
--  exercise it.)
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
  sale_total numeric(12, 2);
  tendered   numeric(12, 2);
  tipped     numeric(12, 2);
BEGIN
  SELECT total INTO sale_total FROM sales WHERE id = p_sale_id;
  IF sale_total IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  SELECT coalesce(sum(amount), 0), coalesce(sum(tip_amount), 0)
    INTO tendered, tipped
    FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> sale_total + tipped THEN
    RAISE EXCEPTION 'tenders for sale % total % but sale.total + tips is %',
      p_sale_id, tendered, sale_total + tipped;
  END IF;
END;
$$;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
REVOKE sales_coverage_checker FROM CURRENT_USER;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sales_coverage_checker;
--> statement-breakpoint

-- Step 4: retire the two deferred constraint triggers and their functions; add the
-- coverage trigger on sale_settlements (checks at the moment completeness is DECLARED)
-- and the tenders post-settlement guard (rejects any tender after settlement).
DROP TRIGGER sales_check_tender_coverage ON sales;
--> statement-breakpoint
DROP TRIGGER tenders_check_tender_coverage ON tenders;
--> statement-breakpoint
DROP FUNCTION sales_check_tender_coverage();
--> statement-breakpoint
DROP FUNCTION tenders_check_tender_coverage();
--> statement-breakpoint
CREATE FUNCTION sale_settlements_check_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.sale_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_check_coverage
  BEFORE INSERT ON sale_settlements
  FOR EACH ROW EXECUTE FUNCTION sale_settlements_check_coverage();
--> statement-breakpoint
-- Invoker rights (not SECURITY DEFINER): this fires DURING a tender INSERT, when
-- app.tenant_id is necessarily set (the tender's own RLS WITH CHECK requires it), so
-- the same-tenant sale_settlements row is visible. Keeping it invoker-rights is why
-- sale_settlements needs no coverage-checker bypass policy (design §5). WT002 so
-- tests assert on the code, not the wording (WT001 is reject_mutation).
CREATE FUNCTION tenders_reject_post_settlement()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sale_settlements WHERE sale_id = NEW.sale_id) THEN
    RAISE EXCEPTION 'tender for sale % rejected: the sale is already settled', NEW.sale_id
      USING ERRCODE = 'WT002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tenders_reject_post_settlement
  BEFORE INSERT ON tenders
  FOR EACH ROW EXECUTE FUNCTION tenders_reject_post_settlement();
--> statement-breakpoint

-- Step 5: sales drops to one number. Last, so the function body above no longer
-- references amount_charged before the column is removed.
ALTER TABLE "sales" DROP CONSTRAINT "sales_amount_charged_ck";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_tip_amount_ck";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "tip_amount";
--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "amount_charged";

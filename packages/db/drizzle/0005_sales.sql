CREATE TYPE "public"."fiscal_state" AS ENUM('recorded', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."tender_method" AS ENUM('cash', 'card', 'voucher', 'transfer', 'other');--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"descriptions" jsonb NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "sale_lines_line_no_key" UNIQUE("sale_id","line_no"),
	CONSTRAINT "sale_lines_quantity_ck" CHECK ("sale_lines"."quantity" <> 0),
	CONSTRAINT "sale_lines_vat_rate_ck" CHECK ("sale_lines"."vat_rate" >= 0 and "sale_lines"."vat_rate" <= 100),
	CONSTRAINT "sale_lines_line_no_ck" CHECK ("sale_lines"."line_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"invoice_number" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_offset_minutes" integer NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"tip_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"amount_charged" numeric(12, 2) NOT NULL,
	"locale" text NOT NULL,
	"invoice_locales" text[] NOT NULL,
	"fiscal_backend" text NOT NULL,
	"fiscal_state" "fiscal_state" NOT NULL,
	CONSTRAINT "sales_series_invoice_number_key" UNIQUE("tenant_id","series_id","invoice_number"),
	CONSTRAINT "sales_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_amount_charged_ck" CHECK ("sales"."amount_charged" = "sales"."total" + "sales"."tip_amount"),
	CONSTRAINT "sales_tip_amount_ck" CHECK ("sales"."tip_amount" >= 0),
	CONSTRAINT "sales_total_ck" CHECK ("sales"."total" >= 0),
	CONSTRAINT "sales_invoice_number_ck" CHECK ("sales"."invoice_number" >= 1),
	CONSTRAINT "sales_invoice_locales_ck" CHECK (array_length("sales"."invoice_locales", 1) between 1 and 2),
	CONSTRAINT "sales_locale_member_ck" CHECK ("sales"."locale" = any("sales"."invoice_locales")),
	CONSTRAINT "sales_issued_offset_ck" CHECK ("sales"."issued_offset_minutes" between -840 and 840)
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "tender_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tenders_amount_ck" CHECK ("tenders"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "tenders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_series_id_invoice_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."invoice_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_tenant_issued_idx" ON "sales" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE INDEX "sales_fiscal_state_idx" ON "sales" USING btree ("tenant_id","fiscal_state");--> statement-breakpoint
CREATE INDEX "tenders_sale_idx" ON "tenders" USING btree ("sale_id");
--> statement-breakpoint

-- Tenant isolation, Part 4 of the recipe (packages/db/src/immutability.sql.md).
-- ENABLE already came for free above, from `.enableRLS()` on each Drizzle
-- table definition. FORCE is required on top of it: without FORCE the table
-- owner bypasses the policy, and migrations run as owner.
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sale_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- current_tenant_id() (0001_tenancy_rls.sql), not a bare
-- current_setting(...)::uuid cast: it already fails closed (a malformed
-- app.tenant_id returns NULL, filtering every row, instead of raising
-- `invalid input syntax for type uuid`) and it is the one function every
-- other tenant-isolation policy in this package already uses (tenants,
-- locations, tills, invoice_series, working_orders, working_order_lines).
CREATE POLICY sales_tenant_isolation ON sales
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

CREATE POLICY sale_lines_tenant_isolation ON sale_lines
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

CREATE POLICY tenders_tenant_isolation ON tenders
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- Privilege first, trigger second. The grants stop the application; the trigger
-- stops the owner, who can otherwise ALTER TABLE ... DISABLE TRIGGER anyway —
-- which is why the application must never BE the owner.
REVOKE ALL ON sales FROM app_user;
--> statement-breakpoint
REVOKE ALL ON sale_lines FROM app_user;
--> statement-breakpoint
REVOKE ALL ON tenders FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sales TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON sale_lines TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON tenders TO app_user;
--> statement-breakpoint

-- No UPDATE, on any column, not even fiscal_state. It is written at insert and
-- never moves: submission progress mutates for hours after the sale commits
-- and lives on envios (spec §3), which is why this table can stay frozen.
-- There is deliberately no GRANT UPDATE (fiscal_state) line here.

-- Parts 2 and 3 of Task 5's recipe, verbatim. reject_mutation() is the shared
-- function created in 0002_immutability.sql; it reports TG_TABLE_NAME and
-- TG_OP, so one definition covers all three tables and every operation, and it
-- raises SQLSTATE WT001 so tests assert on the code rather than on wording.
CREATE TRIGGER sales_enforce_immutability
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER sale_lines_enforce_immutability
  BEFORE UPDATE OR DELETE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER tenders_enforce_immutability
  BEFORE UPDATE OR DELETE ON tenders
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight through
-- every trigger above unless it is separately stopped.
CREATE TRIGGER sales_block_truncate
  BEFORE TRUNCATE ON sales
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER sale_lines_block_truncate
  BEFORE TRUNCATE ON sale_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER tenders_block_truncate
  BEFORE TRUNCATE ON tenders
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- Bootstraps the role the tender-coverage check runs as. Kept separate from
-- app_user: this role is never granted to the application, is NOLOGIN, and
-- exists solely so sales_assert_tenders_cover (below) can be reassigned to
-- it. Idempotent for the same reason app_user's creation is (see
-- 0001_tenancy_rls.sql): roles are cluster-global, and the postgres test
-- target shares one cluster across every database in the suite.
--
-- A pre-existing role with LOGIN would be a real hole — anyone who could
-- authenticate as it would read every tenant's sales/tenders unfiltered,
-- through the same policies created below — so that specific case is
-- rejected rather than silently reused, mirroring app_user's own guard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sales_coverage_checker') THEN
    CREATE ROLE sales_coverage_checker NOLOGIN NOSUPERUSER;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'sales_coverage_checker' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION
      'sales_coverage_checker already exists with LOGIN — refusing to reuse it, since anyone who can authenticate as it would read every tenant''s sales/tenders unfiltered';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO sales_coverage_checker;
--> statement-breakpoint
GRANT SELECT ON sales TO sales_coverage_checker;
--> statement-breakpoint
GRANT SELECT ON tenders TO sales_coverage_checker;
--> statement-breakpoint

-- The role-scoped bypass: visible only when the CURRENT role during query
-- execution is sales_coverage_checker, which nothing but
-- sales_assert_tenders_cover's SECURITY DEFINER context ever runs as. This
-- is additive to sales_tenant_isolation/tenders_tenant_isolation above — for
-- every other role those still apply exactly as written — because Postgres
-- ORs together every applicable permissive policy for a command.
CREATE POLICY sales_coverage_check_bypass ON sales
  FOR SELECT
  TO sales_coverage_checker
  USING (true);
--> statement-breakpoint

CREATE POLICY tenders_coverage_check_bypass ON tenders
  FOR SELECT
  TO sales_coverage_checker
  USING (true);
--> statement-breakpoint

-- The fiscal record exists when ALL tenders settle, not per payment (spec §4).
-- Checked at COMMIT, so a card declined mid-tender aborts the whole
-- transaction: the sale never exists, and the working order is untouched and
-- still open.
--
-- SECURITY DEFINER alone does NOT close the fail-open hole an invoker-rights
-- function would have. FORCE ROW LEVEL SECURITY (above) subjects the table
-- OWNER to the tenant-isolation policy too, and SECURITY DEFINER runs with
-- exactly the OWNER's privileges — so if this function is owned by an
-- ordinary non-superuser role (migrations run as owner, and a hardened
-- deployment's migration role is exactly that), the SELECT below is still
-- filtered by the policy. With app.tenant_id cleared before COMMIT, the row
-- disappears, `charged` comes back NULL, and the early RETURN two lines down
-- would let an uncovered sale commit — fail-OPEN. Verified live against a
-- genuine non-superuser, non-BYPASSRLS owner: exactly that happened.
--
-- The actual fix is `sales_coverage_checker` (created above): this function
-- is reassigned to that role below, and the SELECT always sees the row
-- through the role-scoped permissive policies created above, regardless of
-- app.tenant_id. Deliberately NOT "grant the owner BYPASSRLS" — granting
-- BYPASSRLS requires the grantor to already hold BYPASSRLS (verified: even a
-- CREATEROLE-holding non-superuser gets "permission denied to alter role" /
-- "Only roles with the BYPASSRLS attribute may create roles with the
-- BYPASSRLS attribute" on both CREATE ROLE ... BYPASSRLS and a later ALTER
-- ROLE ... BYPASSRLS), so it cannot be granted by a migration running under
-- the exact hardened non-superuser role FORCE ROW LEVEL SECURITY exists for
-- — it would need a separate superuser bootstrap step outside this migration.
-- A per-role permissive SELECT policy needs only ordinary GRANT/CREATE POLICY
-- privilege on a table this role already owns, so it deploys under that same
-- constrained role with no extra bootstrap step.
CREATE FUNCTION sales_assert_tenders_cover(p_sale_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  charged numeric(12, 2);
  tendered numeric(12, 2);
BEGIN
  SELECT amount_charged INTO charged FROM sales WHERE id = p_sale_id;
  IF charged IS NULL THEN
    RETURN;  -- the sale itself was rolled back; nothing left to reconcile
  END IF;

  SELECT coalesce(sum(amount), 0) INTO tendered FROM tenders WHERE sale_id = p_sale_id;

  IF tendered <> charged THEN
    RAISE EXCEPTION 'tenders for sale % total % but amount_charged is %',
      p_sale_id, tendered, charged;
  END IF;
END;
$$;
--> statement-breakpoint

-- Reassigns ownership to the role created above. Both grants below are
-- temporary, needed only to pass the two checks Postgres makes on an
-- ownership transfer (the acting role must be able to SET ROLE to the new
-- owner, and the new owner must hold CREATE on the function's schema) —
-- verified live that both are required even when the acting role already
-- created sales_coverage_checker via CREATEROLE. Both are revoked
-- immediately after, so no standing privilege from this bootstrap survives:
-- not CREATE on schema public for sales_coverage_checker, and not membership
-- in sales_coverage_checker for whichever role ran this migration.
GRANT CREATE ON SCHEMA public TO sales_coverage_checker;
--> statement-breakpoint
GRANT sales_coverage_checker TO CURRENT_USER WITH INHERIT FALSE;
--> statement-breakpoint
ALTER FUNCTION sales_assert_tenders_cover(uuid) OWNER TO sales_coverage_checker;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM sales_coverage_checker;
--> statement-breakpoint
REVOKE sales_coverage_checker FROM CURRENT_USER;
--> statement-breakpoint

CREATE FUNCTION sales_check_tender_coverage()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM sales_assert_tenders_cover(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION tenders_check_tender_coverage()
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

CREATE CONSTRAINT TRIGGER sales_check_tender_coverage
  AFTER INSERT ON sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sales_check_tender_coverage();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER tenders_check_tender_coverage
  AFTER INSERT ON tenders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tenders_check_tender_coverage();
CREATE TYPE "public"."working_order_status" AS ENUM('open', 'settled', 'abandoned');--> statement-breakpoint
CREATE TABLE "working_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"working_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"descriptions" jsonb NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "working_order_lines_line_no_key" UNIQUE("working_order_id","line_no"),
	CONSTRAINT "working_order_lines_quantity_ck" CHECK ("working_order_lines"."quantity" <> 0),
	CONSTRAINT "working_order_lines_vat_rate_ck" CHECK ("working_order_lines"."vat_rate" >= 0 and "working_order_lines"."vat_rate" <= 100),
	CONSTRAINT "working_order_lines_line_no_ck" CHECK ("working_order_lines"."line_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "working_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "working_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"status" "working_order_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "working_orders_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "working_orders_settled_at_ck" CHECK (("working_orders"."status" = 'settled') = ("working_orders"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "working_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD CONSTRAINT "working_order_lines_order_fk" FOREIGN KEY ("tenant_id","working_order_id") REFERENCES "public"."working_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_orders" ADD CONSTRAINT "working_orders_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "working_order_lines_order_idx" ON "working_order_lines" USING btree ("working_order_id");--> statement-breakpoint
CREATE INDEX "working_orders_tenant_status_idx" ON "working_orders" USING btree ("tenant_id","status");
--> statement-breakpoint

-- Tenant isolation, Part 4 of the recipe (packages/db/src/immutability.sql.md)
-- applied WITHOUT parts 1-3: working_orders/working_order_lines are MUTABLE
-- by design (architecture §6), not append-only, so the immutability triggers
-- do not apply here. ENABLE already came for free above, from `.enableRLS()`
-- on each Drizzle table definition. FORCE is required on top of it: without
-- FORCE the table owner bypasses the policy, and migrations run as owner.
ALTER TABLE working_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE working_order_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- current_tenant_id() (0001_tenancy_rls.sql), not a bare
-- current_setting(...)::uuid cast, for the same reason invoice_series
-- (0003_invoice_series.sql) already uses it: it fails closed on a malformed
-- app.tenant_id (returns NULL, filtering every row) instead of raising
-- `invalid input syntax for type uuid`, and it is the one function every
-- other tenant-isolation policy in this package already uses.
CREATE POLICY working_orders_tenant_isolation ON working_orders
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

CREATE POLICY working_order_lines_tenant_isolation ON working_order_lines
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

-- MUTABLE, deliberately. Unlike sales/sale_lines/tenders these keep UPDATE and
-- DELETE: an order is amended all evening and may end in nothing.
REVOKE ALL ON working_orders FROM app_user;
--> statement-breakpoint
REVOKE ALL ON working_order_lines FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON working_orders TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON working_order_lines TO app_user;
--> statement-breakpoint

-- settled and abandoned are terminal states. The guard checks OLD.status
-- itself, not merely whether NEW.status differs from it, so ANY update of a
-- non-open order is rejected — including a no-op update of a column the
-- author of a future migration did not think to special-case.
CREATE FUNCTION working_orders_enforce_transition()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'working order % is % and can no longer be modified', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER working_orders_enforce_transition
  BEFORE UPDATE ON working_orders
  FOR EACH ROW EXECUTE FUNCTION working_orders_enforce_transition();
--> statement-breakpoint

-- Lines may only be written while the parent order is open. Covers DELETE too,
-- which is the transition that would otherwise slip past.
CREATE FUNCTION working_order_lines_require_open_parent()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_id uuid := coalesce(NEW.working_order_id, OLD.working_order_id);
  parent_status working_order_status;
BEGIN
  SELECT status INTO parent_status FROM working_orders WHERE id = parent_id;
  IF parent_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'lines may only be written while the order is open (order % is %)',
      parent_id, coalesce(parent_status::text, 'missing');
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint

CREATE TRIGGER working_order_lines_require_open_parent
  BEFORE INSERT OR UPDATE OR DELETE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_require_open_parent();
--> statement-breakpoint

-- descriptions must hold EXACTLY the venue's configured locales (spec §9).
-- Runs under RLS as app_user (the caller's own connection), which is correct
-- here rather than a fail-open: the location is always in the caller's own
-- tenant, reached through the order's till, and a location the caller cannot
-- see is a location the order could not have referenced. Contrast the
-- deferred tender check in Task 8, which must be SECURITY DEFINER because a
-- row it cannot see would make it pass silently.
CREATE FUNCTION working_order_lines_check_locales()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  configured text[];
  supplied text[];
BEGIN
  SELECT l.invoice_locales INTO configured
    FROM working_orders wo
    JOIN tills t ON t.id = wo.till_id
    JOIN locations l ON l.id = t.location_id
   WHERE wo.id = NEW.working_order_id;

  IF configured IS NULL THEN
    RAISE EXCEPTION 'working order % has no resolvable location', NEW.working_order_id;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO supplied
    FROM jsonb_object_keys(NEW.descriptions) AS k;

  IF supplied IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(configured) AS c) THEN
    RAISE EXCEPTION
      'descriptions must carry exactly the venue locales % (got %)', configured, supplied;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER working_order_lines_check_locales
  BEFORE INSERT OR UPDATE ON working_order_lines
  FOR EACH ROW EXECUTE FUNCTION working_order_lines_check_locales();
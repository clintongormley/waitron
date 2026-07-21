-- Tenant isolation, Part 4 of the recipe (packages/db/src/immutability.sql.md), applied WITHOUT
-- parts 1-3: incidents is mutable (acknowledged_at/acknowledged_by advance on acknowledgement),
-- not append-only, so the immutability triggers do not apply here — the same shape as
-- invoice_series (0003_invoice_series.sql), not sales/sale_voids. ENABLE already came for free
-- above, from `.enableRLS()` on the Drizzle table definition. FORCE is required on top of it:
-- without FORCE the table owner bypasses the policy, and migrations run as owner.
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- current_tenant_id() (0001_tenancy_rls.sql), not a bare current_setting(...)::uuid cast: it
-- already fails closed (a malformed app.tenant_id returns NULL, filtering every row, instead of
-- raising `invalid input syntax for type uuid`) and it is the one function every other
-- tenant-isolation policy in this package already uses.
CREATE POLICY "incidents_tenant_isolation" ON "incidents"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint

REVOKE ALL ON "incidents" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON "incidents" TO app_user;
--> statement-breakpoint

-- Column-level UPDATE, the one relaxation of Task 5's blanket revocation this table carries — and
-- scoped to exactly two columns. An UPDATE touching code, params, severity, detected_at, tenant_id,
-- till_id or sale_id is rejected by the server, so "an incident is not rewritable" is a database
-- property, like every other guarantee in this plan, rather than a convention the application is
-- trusted to keep. Staff acknowledge an incident; they never rewrite what happened.
GRANT UPDATE ("acknowledged_at", "acknowledged_by") ON "incidents" TO app_user;

-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE app-role grant for
-- till_layouts (the owner-authored per-tenant till layout + receipt trim).
--
-- 0035 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0027_light_smiling_tiger.sql did for the catalogue tables and 0001_tenancy_rls.sql for
-- tenants/locations/tills. The `current_tenant_id()` function and the `app_user` role already exist
-- from 0001 and are NOT recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id
-- returns NULL, filtering every row.
--
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. It does nothing against a superuser, so it is not the control the app_user
-- behavioural suite (layouts.rls.test.ts) exercises — removing it leaves that suite green; the guard
-- that DOES catch a missing FORCE is fiscal-verifactu's `inmutabilidad` scan, which asserts
-- relforcerowsecurity on every tenant_id-bearing table.
--
-- FOR ALL, not FOR SELECT: USING filters what is readable and WITH CHECK filters what is writable,
-- both, so a tenant cannot INSERT/UPDATE a row it will never read back.
--
-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- till_layouts is MUTABLE config — the dashboard upserts one row per tenant (INSERT ... ON CONFLICT
-- (tenant_id) DO UPDATE) — so app_user holds SELECT, INSERT, UPDATE. No DELETE: config is replaced in
-- place, never removed, and a fresh tenant simply has no row.
ALTER TABLE "till_layouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "till_layouts_tenant_isolation" ON "till_layouts"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "till_layouts" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "till_layouts" TO app_user;

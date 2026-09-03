-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE/DELETE app-role
-- grant for layout_profiles (the reusable per-tenant layout profiles, SP-A.2 §16.3).
--
-- 0088 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0036_till_layouts_rls.sql did for till_layouts and 0001_tenancy_rls.sql for tenants/locations/tills.
-- The `current_tenant_id()` function and the `app_user` role already exist from 0001 and are NOT
-- recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id returns NULL, filtering
-- every row.
--
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. It does nothing against a superuser, so it is not the control the app_user
-- behavioural suite (layout-profiles.rls.test.ts) exercises — removing it leaves that suite green; the
-- guard that DOES catch a missing FORCE is fiscal-verifactu's `inmutabilidad` scan, which asserts
-- relforcerowsecurity on every tenant_id-bearing table.
--
-- FOR ALL, not FOR SELECT: USING filters what is readable and WITH CHECK filters what is writable,
-- both, so a tenant cannot INSERT/UPDATE a row it will never read back.
--
-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- layout_profiles is MUTABLE and DELETABLE config — the dashboard creates, edits and removes named
-- profiles — so app_user holds SELECT, INSERT, UPDATE, DELETE. This is where it differs from
-- till_layouts (0036), which grants no DELETE because that single per-tenant row is replaced in place.
ALTER TABLE "layout_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "layout_profiles_tenant_isolation" ON "layout_profiles"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "layout_profiles" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "layout_profiles" TO app_user;

-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE app-role grant for
-- tenant_themes (the owner-authored per-tenant base theme, SP-A.2 §16.3).
--
-- 0090 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0036_till_layouts_rls.sql did for till_layouts and 0001_tenancy_rls.sql for tenants/locations/tills.
-- The `current_tenant_id()` function and the `app_user` role already exist from 0001 and are NOT
-- recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id returns NULL, filtering
-- every row.
--
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. It does nothing against a superuser, so no suite that writes as app_user
-- can catch a missing FORCE; the guard that DOES is fiscal-verifactu's `inmutabilidad` scan, which
-- asserts relforcerowsecurity on every tenant_id-bearing table.
--
-- FOR ALL, not FOR SELECT: USING filters what is readable and WITH CHECK filters what is writable,
-- both, so a tenant cannot INSERT/UPDATE a row it will never read back.
--
-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- tenant_themes is MUTABLE config — the dashboard upserts one row per tenant (INSERT ... ON CONFLICT
-- (tenant_id) DO UPDATE) — so app_user holds SELECT, INSERT, UPDATE. No DELETE: the theme is replaced
-- in place, never removed, and a fresh tenant simply has no row (the till_layouts shape, 0036).
ALTER TABLE "tenant_themes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_themes_tenant_isolation" ON "tenant_themes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "tenant_themes" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_themes" TO app_user;

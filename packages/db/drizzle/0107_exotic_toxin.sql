-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE/DELETE app-role
-- grant for device_profiles (the reusable per-tenant device profiles, design 2026-09-05 §5.1), plus
-- the composite tenant-consistent canvas FK.
--
-- 0106 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0089_normal_ted_forrester.sql did for layout_profiles and 0001_tenancy_rls.sql for
-- tenants/locations/tills. The `current_tenant_id()` function and the `app_user` role already exist
-- from 0001 and are NOT recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id
-- returns NULL, filtering every row.
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
-- device_profiles is MUTABLE and DELETABLE config — the dashboard creates, edits and removes named
-- profiles — so app_user holds SELECT, INSERT, UPDATE, DELETE.
--
-- The composite (tenant_id, canvas_id) → canvases (tenant_id, id) FK is hand-written here because
-- drizzle-kit cannot model a composite FK from a BARE uuid column (the `devices.station_id` idiom,
-- 0095_parched_meteorite.sql). It references the EXISTING canvases_tenant_id_key UNIQUE (canvases.ts)
-- — no new unique is created. ON DELETE RESTRICT: a canvas is not hard-deleted while a profile
-- references it. MATCH SIMPLE (the FK default) skips the check whenever any key column is NULL, so a
-- NULL canvas_id is unconstrained — the binding is optional, and only a non-NULL value must name a
-- canvas of the SAME tenant.
ALTER TABLE "device_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "device_profiles_tenant_isolation" ON "device_profiles"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "device_profiles" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_profiles" TO app_user;--> statement-breakpoint
ALTER TABLE "device_profiles"
  ADD CONSTRAINT "device_profiles_canvas_fk"
  FOREIGN KEY ("tenant_id", "canvas_id") REFERENCES "canvases" ("tenant_id", "id") ON DELETE RESTRICT;

-- FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the SELECT/INSERT/UPDATE app-role grant for
-- tenant_receipts (the owner-authored per-tenant NON-FISCAL receipt trim, SP-B4 / design §9).
--
-- 0103 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written --custom migration adds them, exactly as
-- 0091_moaning_sharon_carter.sql did for tenant_themes and 0036_till_layouts_rls.sql for till_layouts.
-- The `current_tenant_id()` function and the `app_user` role already exist from 0001 and are NOT
-- recreated here; `current_tenant_id()` fails closed — an unset app.tenant_id returns NULL.
--
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. The guard that CATCHES a missing FORCE is fiscal-verifactu's `inmutabilidad`
-- scan, which asserts relforcerowsecurity on every tenant_id-bearing table.
--
-- FOR ALL, not FOR SELECT: USING filters what is readable and WITH CHECK filters what is writable.
--
-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- tenant_receipts is MUTABLE config — the dashboard upserts one row per tenant (INSERT ... ON CONFLICT
-- (tenant_id) DO UPDATE) — so app_user holds SELECT, INSERT, UPDATE. No DELETE.
ALTER TABLE "tenant_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_receipts_tenant_isolation" ON "tenant_receipts"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "tenant_receipts" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_receipts" TO app_user;

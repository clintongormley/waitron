-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- 0001_identity_rls.sql and 0003_sessions_rls.sql. current_tenant_id() is NOT redefined here: it is
-- created once by packages/db's 0001_tenancy_rls.sql and already lives in `public`, because core
-- migrations run before this package's (the runtime orders `core` first). It fails closed — an unset
-- app.tenant_id returns NULL, filtering every row.
--
-- FORCE applies RLS to the table OWNER too. It does nothing against a superuser (verified — see
-- packages/db/drizzle/0001_tenancy_rls.sql's own note), so it is not the control the app_user probe
-- exercises: with the owner a superuser in the test harness, removing this line leaves the
-- management_sessions RLS suite green. It is required by the house rule for every tenant_id table and
-- is here for the deployment that connects as the NON-superuser migration owner, which is the only
-- case FORCE isolates. The catalog guard that DOES cover it is fiscal-verifactu's `inmutabilidad`
-- scan: it applies IDENTITY_MIGRATIONS ([core, identity, fiscal], inmutabilidad.test.ts) and asserts
-- relforcerowsecurity on every tenant_id table, `management_sessions` included — the metadata check
-- the behavioural suite cannot make. Dropping this line makes that scan report
-- `management_sessions: relforcerowsecurity=false`.

--> statement-breakpoint
ALTER TABLE "management_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- USING filters what is readable; WITH CHECK filters what is writable. Both, or a tenant could
-- INSERT a management session it can never read back.
CREATE POLICY "management_sessions_tenant_isolation" ON "management_sessions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- management_sessions is MUTABLE — `last_seen_at` is refreshed on activity and `ended_at` is stamped
-- on sign-out — so app_user holds SELECT, INSERT, UPDATE. No DELETE and no append-only trigger: a
-- management session is ended by stamping `ended_at`, never removed.
REVOKE ALL ON "management_sessions" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "management_sessions" TO app_user;

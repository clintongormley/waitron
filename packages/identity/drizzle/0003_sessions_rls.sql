-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- 0001_identity_rls.sql. current_tenant_id() is NOT redefined here: it is created once by
-- packages/db's 0001_tenancy_rls.sql and already lives in `public`, because core migrations run
-- before this package's (the runtime orders `core` first). It fails closed — an unset app.tenant_id
-- returns NULL, filtering every row.
--
-- FORCE applies RLS to the table OWNER too. It does nothing against a superuser (verified — see
-- packages/db/drizzle/0001_tenancy_rls.sql's own note), so it is not the control the app_user probe
-- exercises: with the owner a superuser in the test harness, removing this line leaves the sessions
-- RLS suite green (checked by deletion, 2026-08-05). It is required by the house rule for every
-- tenant_id table and is here for the deployment that connects as the NON-superuser migration owner,
-- which is the only case FORCE isolates. No catalog guard covers it for identity: fiscal-verifactu's
-- `inmutabilidad` scan migrates [core, fiscal] only (inmutabilidad.test.ts:16-18), not identity.

--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- USING filters what is readable; WITH CHECK filters what is writable. Both, or a tenant could
-- INSERT a session it can never read back.
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- sessions is MUTABLE — a shift login is closed by stamping `ended_at` on logout — so app_user holds
-- SELECT, INSERT, UPDATE. No DELETE and no append-only trigger: a session is ended, never removed,
-- and the cash-up / audit trail that references it must keep its referent.
REVOKE ALL ON "sessions" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sessions" TO app_user;

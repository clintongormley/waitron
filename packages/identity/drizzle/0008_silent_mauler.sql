-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- 0001_identity_rls.sql, 0003_sessions_rls.sql and 0006_superb_mojo.sql: drizzle-kit has no concept
-- of policies, FORCE, or privileges — `.enableRLS()` emits only ENABLE (see 0007). current_tenant_id()
-- is NOT redefined here: it is created once by packages/db's 0001_tenancy_rls.sql and already lives in
-- `public`, because core migrations run before this package's (migrations.manifest.json orders `core`
-- first). It fails closed — an unset app.tenant_id returns NULL, filtering every row.
--
-- FORCE applies RLS to the table OWNER too. It does nothing against a superuser, so it is not the
-- control the app_user probe in webauthn.rls.test.ts exercises: with the owner a superuser in the test
-- harness, removing a FORCE line leaves that behavioural suite green. It is required by the house rule
-- for every tenant_id table and is here for the deployment that connects as the NON-superuser
-- migration owner, which is the only case FORCE isolates. The catalog guard that DOES cover it is
-- fiscal-verifactu's `inmutabilidad` scan (inmutabilidad.test.ts): it applies IDENTITY_MIGRATIONS and
-- asserts relforcerowsecurity on every tenant_id-bearing table, both of these included — dropping a
-- FORCE line makes that scan report `webauthn_credentials`/`webauthn_challenges: relforcerowsecurity=false`.

--> statement-breakpoint
ALTER TABLE "webauthn_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- USING filters what is readable; WITH CHECK filters what is writable. Both, or a tenant could INSERT
-- a credential it can never read back.
CREATE POLICY "webauthn_credentials_tenant_isolation" ON "webauthn_credentials"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- webauthn_credentials is MUTABLE and DELETABLE — `counter` is bumped on every successful assertion
-- (UPDATE) and a stale or revoked passkey is removed outright (DELETE) — so app_user holds SELECT,
-- INSERT, UPDATE, DELETE. DELETE is granted here, unlike management_sessions, mirroring
-- tenant_credentials: a credential row is live configuration, not an audit trail.
REVOKE ALL ON "webauthn_credentials" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webauthn_credentials" TO app_user;--> statement-breakpoint

ALTER TABLE "webauthn_challenges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "webauthn_challenges_tenant_isolation" ON "webauthn_challenges"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- webauthn_challenges is EPHEMERAL: a challenge is consumed (deleted) the moment the browser returns
-- the signed response, and expired ones are swept — so app_user holds SELECT, INSERT, UPDATE, DELETE.
-- DELETE is essential here, not merely allowed: a challenge that could not be deleted could be replayed.
REVOKE ALL ON "webauthn_challenges" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webauthn_challenges" TO app_user;

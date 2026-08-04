-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/credentials/drizzle/0001_credentials_rls.sql. current_tenant_id() is NOT redefined here:
-- it is created once by packages/db's 0001_tenancy_rls.sql and already lives in `public`, because
-- core migrations run before this package's (migrations.manifest.json orders `core` first). It
-- fails closed — an unset app.tenant_id returns NULL, filtering every row.

--> statement-breakpoint
ALTER TABLE "persons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "persons_tenant_isolation" ON "persons"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- persons is MUTABLE — a PIN is reset, a role changes, an account is suspended — so app_user holds
-- SELECT, INSERT, UPDATE. No DELETE and no append-only trigger: a person is retired by flipping
-- `status` to 'suspended', never removed.
REVOKE ALL ON "persons" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "persons" TO app_user;

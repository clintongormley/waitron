-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/credentials/drizzle/0001_credentials_rls.sql and packages/scheduler's: drizzle-kit has
-- no concept of policies, FORCE, or privileges, which is exactly why this survives every later
-- `generate` run instead of being reverted by one.
--
-- current_tenant_id() is NOT redefined here. It is a shared function created once by packages/db's
-- own migrations (0001_tenancy_rls.sql) and already lives in `public` by the time this runs, because
-- core migrations run before this package's (migrations.manifest.json orders `core` first;
-- packages/migrations/src/manifest.test.ts's "puts core first" proves it). It already fails closed —
-- a malformed or unset app.tenant_id returns NULL, filtering every row — and it is the function
-- every other tenant-isolation policy in this repo uses.

--> statement-breakpoint
ALTER TABLE "persons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "persons_tenant_isolation" ON "persons"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive the withheld privileges, then
-- the targeted grant. persons is MUTABLE — a PIN is reset, a role changes, an account is suspended —
-- so app_user holds SELECT, INSERT, UPDATE. No DELETE and no append-only trigger: unlike the fiscal
-- registros, a person is retired by flipping `status` to 'suspended', never removed, so the row (and
-- the time history that will reference it in Slice 2) stays. The immutability floor belongs to the
-- time_entries table, not to identity.
REVOKE ALL ON "persons" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "persons" TO app_user;

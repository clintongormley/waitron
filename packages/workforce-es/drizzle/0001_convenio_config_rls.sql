-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/workforce/drizzle/0001_workforce_rls.sql: drizzle-kit has no concept of policies, FORCE,
-- or privileges, which is exactly why this survives every later `generate` run instead of being
-- reverted by one.
--
-- current_tenant_id() is NOT redefined here. It is a shared function created once by packages/db's
-- own migrations (0001_tenancy_rls.sql) and already lives in `public` by the time this runs, because
-- core migrations run before this package's (migrations.manifest.json orders `core` first, and
-- `workforce-es` after it; packages/migrations/src/manifest.test.ts's "puts core first" proves it).
-- It already fails closed — a malformed or unset app.tenant_id returns NULL, filtering every row.

--> statement-breakpoint
ALTER TABLE "convenio_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "convenio_config_tenant_isolation" ON "convenio_config"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive the withheld privileges, then
-- the targeted grant. convenio_config is MUTABLE configuration an admin edits — a working week is
-- changed, the overtime model is flipped by the asesor, a guardrail is tightened — so app_user holds
-- SELECT, INSERT, UPDATE. No DELETE and no append-only trigger: unlike the fiscal registros and the
-- time_entries stream, this is configuration, not the immutable record; it carries the same mutable
-- shape as persons/employments (drizzle/0001_workforce_rls.sql).
REVOKE ALL ON "convenio_config" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "convenio_config" TO app_user;

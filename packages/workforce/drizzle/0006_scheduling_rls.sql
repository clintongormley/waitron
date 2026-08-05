-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as this
-- package's 0001_workforce_rls.sql, 0003_workforce_d1a_rls.sql and 0006_brief_vampiro.sql:
-- drizzle-kit has no concept of policies, FORCE or privileges, which is exactly why this survives
-- every later `generate` run instead of being reverted by one.
--
-- current_tenant_id() is NOT redefined here — it is the shared function packages/db's
-- 0001_tenancy_rls.sql installs, already in `public` by the time this runs (core migrations are
-- ordered first; packages/migrations/src/manifest.test.ts proves it), and it already fails closed
-- (a malformed or unset app.tenant_id returns NULL, filtering every row).
--
-- shifts and roster_versions are PLANNING data, NOT the legal record. Unlike time_entries (the
-- IMMUTABLE registro de jornada, whose 0003 REVOKEs UPDATE/DELETE and adds an append-only trigger),
-- a draft roster is edited, a shift is moved, a discarded roster is deleted. So these follow the
-- MUTABLE persons/employments shape — FORCE ROW LEVEL SECURITY + tenant-isolation policy on
-- current_tenant_id() + REVOKE ALL / GRANT — and additionally take DELETE: a draft roster is
-- discardable, and the referent-preservation reason persons/employments withhold DELETE (immutable
-- time history points at them) does not apply — no immutable record points at a shift. There is
-- deliberately NO reject_mutation trigger and NO chain: the art. 34.9 tamper-evidence duty is on the
-- record of hours WORKED, satisfied by time_entries alone, never on a schedule.

--> statement-breakpoint
ALTER TABLE "roster_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "roster_versions_tenant_isolation" ON "roster_versions"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "shifts_tenant_isolation" ON "shifts"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive the withheld privileges, then
-- the targeted grant. Full DML including DELETE — planning rows are discardable.
REVOKE ALL ON "roster_versions" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "roster_versions" TO app_user;--> statement-breakpoint
REVOKE ALL ON "shifts" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shifts" TO app_user;

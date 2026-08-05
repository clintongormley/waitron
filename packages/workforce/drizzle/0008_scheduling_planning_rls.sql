-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as this
-- package's 0001_workforce_rls.sql, 0003_workforce_d1a_rls.sql, 0006_brief_vampiro.sql and
-- 0008_scheduling_rls.sql: drizzle-kit has no concept of policies, FORCE or privileges, which is
-- exactly why this survives every later `generate` run instead of being reverted by one.
--
-- current_tenant_id() is NOT redefined here — it is the shared function packages/db's
-- 0001_tenancy_rls.sql installs, already in `public` by the time this runs (core migrations are
-- ordered first; packages/migrations/src/manifest.test.ts proves it), and it already fails closed
-- (a malformed or unset app.tenant_id returns NULL, filtering every row).
--
-- absences, availability, shift_templates and shift_swaps are PLANNING data, NOT the legal record.
-- Unlike time_entries (the IMMUTABLE registro de jornada, whose 0003 REVOKEs UPDATE/DELETE and adds
-- an append-only trigger), a planned absence is edited, an availability window changes, a template is
-- deleted, a swap request is withdrawn. So these follow the MUTABLE persons/employments shape — FORCE
-- ROW LEVEL SECURITY + tenant-isolation policy on current_tenant_id() + REVOKE ALL / GRANT — and take
-- DELETE, the same as 0008's shifts/roster_versions: planning rows are discardable and no immutable
-- record points at them. There is deliberately NO reject_mutation trigger and NO chain: the art. 34.9
-- tamper-evidence duty is on the record of hours WORKED, satisfied by time_entries alone.

--> statement-breakpoint
ALTER TABLE "absences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "availability" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_swaps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "absences_tenant_isolation" ON "absences"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "availability_tenant_isolation" ON "availability"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "shift_templates_tenant_isolation" ON "shift_templates"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
CREATE POLICY "shift_swaps_tenant_isolation" ON "shift_swaps"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive the withheld privileges, then
-- the targeted grant. Full DML including DELETE — planning rows are discardable.
REVOKE ALL ON "absences" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "absences" TO app_user;--> statement-breakpoint
REVOKE ALL ON "availability" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "availability" TO app_user;--> statement-breakpoint
REVOKE ALL ON "shift_templates" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_templates" TO app_user;--> statement-breakpoint
REVOKE ALL ON "shift_swaps" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_swaps" TO app_user;

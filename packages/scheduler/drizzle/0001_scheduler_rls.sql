-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/payments' 0001_payments_rls.sql: drizzle-kit has no concept of policies, FORCE, or
-- privileges. current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "scheduled_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "scheduled_runs_tenant_isolation" ON "scheduled_runs"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- No DELETE: a run record is never row-deleted. It is the audit trail.
REVOKE ALL ON "scheduled_runs" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scheduled_runs" TO app_user;

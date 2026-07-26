-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- packages/scheduler's 0001_scheduler_rls.sql: drizzle-kit has no concept of policies, FORCE, or
-- privileges. current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "tenant_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_credentials_tenant_isolation" ON "tenant_credentials"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
-- DELETE is granted, unlike scheduled_runs: `waitron-credentials delete` de-provisions a tenant,
-- and a credential row is live configuration rather than an audit trail.
REVOKE ALL ON "tenant_credentials" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_credentials" TO app_user;

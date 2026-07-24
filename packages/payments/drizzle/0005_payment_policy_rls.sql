-- Hand-written (a --custom migration drizzle-kit will never regenerate), same reason as
-- 0001_payments_rls.sql: drizzle-kit has no concept of policies, FORCE, or privileges.
-- current_tenant_id() already exists (packages/db 0001_tenancy_rls.sql; core runs first).

--> statement-breakpoint
ALTER TABLE "payment_policy" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "payment_policy_tenant_isolation" ON "payment_policy"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

-- Mutable config (offline_mode/cap change over time) → tenant isolation only, no append-only
-- trigger. REVOKE ALL first so a prior provisioning GRANT ALL cannot survive, then the targeted
-- grant. No DELETE: config is updated in place, never row-deleted.
REVOKE ALL ON "payment_policy" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_policy" TO app_user;

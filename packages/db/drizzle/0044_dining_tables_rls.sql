-- Hand-written (--custom; drizzle-kit has no concept of policies, FORCE, or privileges), same as
-- packages/db/drizzle/0039_recipes_rls.sql. current_tenant_id() already exists (0001_tenancy_rls.sql).
-- dining_tables: no DELETE (deactivate via `active` — the table has order history, design §2a).
--> statement-breakpoint
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "dining_tables_tenant_isolation" ON "dining_tables"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "dining_tables" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "dining_tables" TO app_user;

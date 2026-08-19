-- Hand-written (--custom; drizzle-kit models no policies, FORCE, or privileges), same as
-- packages/db/drizzle/0036_till_layouts_rls.sql. current_tenant_id() and app_user already exist
-- (0001_tenancy_rls.sql). table_service_statuses is MUTABLE config: no DELETE (deactivate via
-- `active` — a dining_tables.status_id may reference a row, design §2a).
--> statement-breakpoint
ALTER TABLE "table_service_statuses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "table_service_statuses_tenant_isolation" ON "table_service_statuses"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "table_service_statuses" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "table_service_statuses" TO app_user;

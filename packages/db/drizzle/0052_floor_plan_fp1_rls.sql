-- Hand-written (--custom; drizzle-kit models no policies, FORCE, or privileges), same as
-- packages/db/drizzle/0048_table_service_statuses_rls.sql. current_tenant_id() and app_user already
-- exist (0001_tenancy_rls.sql). floor_zones is MUTABLE config: no DELETE (deactivate via `active` — a
-- dining_tables.zone_id may reference a row, design FP-1). The inmutabilidad scan
-- (packages/fiscal-verifactu) requires FORCE ROW LEVEL SECURITY on every tenant_id-bearing table.
--> statement-breakpoint
ALTER TABLE "floor_zones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "floor_zones_tenant_isolation" ON "floor_zones"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "floor_zones" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "floor_zones" TO app_user;--> statement-breakpoint

-- dining_tables.zone_id tenant-consistent composite FK → floor_zones (bare column added by 0051):
-- a table cannot point at a zone of another tenant, independently of RLS. MATCH SIMPLE satisfies it
-- while zone_id is NULL, so the column stays nullable. floor_zones deactivates rather than deletes,
-- so this FK never dangles (no ON DELETE path is exercised).
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_zone_fk"
  FOREIGN KEY ("tenant_id", "zone_id") REFERENCES "floor_zones" ("tenant_id", "id");

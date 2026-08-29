-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0066_station_printers_rls.sql. current_tenant_id() and app_user already
-- exist (0001_tenancy_rls.sql); current_tenant_id() fails closed — an unset app.tenant_id returns NULL,
-- filtering every row. The inmutabilidad scan (packages/fiscal-verifactu) requires FORCE ROW LEVEL
-- SECURITY on every tenant_id-bearing table, so location_catalogues gets it here (0072 emitted only
-- ENABLE from .enableRLS()).
--> statement-breakpoint

-- location_catalogues — the location→catalogue accessibility map (the OTHER menus a location may sell,
-- beyond its default locations.catalogue_id). A membership row is ADDED or REMOVED, never edited, so
-- app_user holds SELECT/INSERT/DELETE and no UPDATE (the DELETE precedent is 0066's station_printers).
-- FORCE applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration
-- owner is still isolated. FOR ALL, not FOR SELECT: USING filters reads, WITH CHECK filters writes, so
-- a tenant cannot INSERT a membership it will never read back. REVOKE ALL first so a prior provisioning
-- GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "location_catalogues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "location_catalogues_tenant_isolation" ON "location_catalogues"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "location_catalogues" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "location_catalogues" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- parent row of another tenant, independently of whether RLS is in force on this connection.
-- location_catalogues.location_id → locations_tenant_id_key (tenant_id, id);
-- location_catalogues.catalogue_id → catalogues_tenant_id_key (tenant_id, id). Both columns are NOT NULL
-- (they are in the PK), so MATCH SIMPLE always checks. No ON DELETE path is exercised — a membership is
-- detached by DELETE of the row itself, and locations/catalogues deactivate rather than delete.
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_location_fk"
  FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_catalogue_fk"
  FOREIGN KEY ("tenant_id", "catalogue_id") REFERENCES "catalogues" ("tenant_id", "id");

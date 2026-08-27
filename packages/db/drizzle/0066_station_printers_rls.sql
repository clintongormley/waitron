-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0063_printing_rls.sql. current_tenant_id() and app_user already exist
-- (0001_tenancy_rls.sql); current_tenant_id() fails closed — an unset app.tenant_id returns NULL,
-- filtering every row. The inmutabilidad scan (packages/fiscal-verifactu) requires FORCE ROW LEVEL
-- SECURITY on every tenant_id-bearing table, so station_printers gets it here (0065 emitted only ENABLE
-- from .enableRLS()).
--> statement-breakpoint

-- station_printers — the KDS station↔printer mapping (KDS-4 §2a). A mapping row is ADDED or REMOVED,
-- never edited, so app_user holds SELECT/INSERT/DELETE and no UPDATE (the DELETE precedent is 0063's
-- print_agent_pairing_codes). FORCE applies RLS to the table OWNER too, so a deployment connecting as
-- the non-superuser migration owner is still isolated. FOR ALL, not FOR SELECT: USING filters reads,
-- WITH CHECK filters writes, so a tenant cannot INSERT a mapping it will never read back. REVOKE ALL
-- first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "station_printers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "station_printers_tenant_isolation" ON "station_printers"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "station_printers" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "station_printers" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- parent row of another tenant, independently of whether RLS is in force on this connection.
-- station_printers.station_id → kitchen_stations_tenant_id_key (tenant_id, id);
-- station_printers.printer_id → printers_tenant_id_key (tenant_id, id). Both columns are NOT NULL (they
-- are in the PK), so MATCH SIMPLE always checks. No ON DELETE path is exercised — kitchen_stations and
-- printers deactivate (active = false) rather than delete.
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "station_printers"
  ADD CONSTRAINT "station_printers_printer_fk"
  FOREIGN KEY ("tenant_id", "printer_id") REFERENCES "printers" ("tenant_id", "id");

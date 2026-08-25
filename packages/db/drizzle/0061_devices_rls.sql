-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0055_kds1_stations_tickets_rls.sql / 0052_floor_plan_fp1_rls.sql.
-- current_tenant_id() and app_user already exist (0001_tenancy_rls.sql); current_tenant_id() fails
-- closed — an unset app.tenant_id returns NULL, filtering every row. The inmutabilidad scan
-- (packages/fiscal-verifactu) requires FORCE ROW LEVEL SECURITY on every tenant_id-bearing table, so
-- both new tables get it here (0060 emitted only ENABLE from .enableRLS()).
--> statement-breakpoint

-- devices — a durable device IDENTITY, MUTABLE, no DELETE (revoke via `active = false`; a later table
-- may reference a device row, mirroring kitchen_stations' deactivate-never-delete). FORCE applies RLS
-- to the table OWNER too, so a deployment connecting as the non-superuser migration owner is still
-- isolated. FOR ALL, not FOR SELECT: USING filters reads, WITH CHECK filters writes, so a tenant
-- cannot INSERT/UPDATE a row it will never read back. REVOKE ALL first so a prior provisioning
-- GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "devices_tenant_isolation" ON "devices"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "devices" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "devices" TO app_user;--> statement-breakpoint

-- device_pairing_codes — a single-use, short-lived code. DELETE IS granted here (novel for this
-- repo's tenant tables; the DELETE precedent is 0039/0042): redemption consumes the row via a
-- locking DELETE … RETURNING, the WebAuthn-challenge pattern. No UPDATE — a code is consumed, never
-- edited.
ALTER TABLE "device_pairing_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "device_pairing_codes_tenant_isolation" ON "device_pairing_codes"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "device_pairing_codes" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "device_pairing_codes" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- kitchen_stations row of another tenant, independently of whether RLS is in force on this
-- connection. Both reference the kitchen_stations_tenant_id_key (tenant_id, id) UNIQUE (0054). MATCH
-- SIMPLE (the default) means a NULL station_id skips the check, so the nullable binding stays
-- optional. kitchen_stations deactivates rather than deletes, so no ON DELETE path is exercised.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");

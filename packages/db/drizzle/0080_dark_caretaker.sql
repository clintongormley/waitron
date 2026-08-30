-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0074_location_catalogues_rls.sql. current_tenant_id() and app_user
-- already exist (0001_tenancy_rls.sql); current_tenant_id() fails closed — an unset app.tenant_id
-- returns NULL, filtering every row. The inmutabilidad scan (packages/fiscal-verifactu) requires FORCE
-- ROW LEVEL SECURITY on every tenant_id-bearing table, so bookings gets it here (0079 emitted only
-- ENABLE from .enableRLS()).
--> statement-breakpoint

-- bookings — staff-entered table reservations (design §2a). A booking is CREATED, EDITED and moved
-- through its lifecycle (booked → seated → completed/no_show/cancelled) but NEVER hard-deleted — a
-- cancellation is a status change — so app_user holds SELECT/INSERT/UPDATE and NO DELETE. FORCE applies
-- RLS to the table OWNER too, so a deployment connecting as the non-superuser migration owner is still
-- isolated. FOR ALL, not FOR SELECT: USING filters reads, WITH CHECK filters writes, so a tenant cannot
-- INSERT a booking it will never read back. REVOKE ALL first so a prior provisioning GRANT ALL cannot
-- survive, then the targeted grant.
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "bookings_tenant_isolation" ON "bookings"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "bookings" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- parent row of another tenant, independently of whether RLS is in force on this connection. Both
-- targets are TS-1 tables that carry the (tenant_id, id) UNIQUE these reference —
-- dining_tables_tenant_id_key and working_orders_tenant_id_key. Both source columns are NULLABLE
-- (optional table assignment / set-on-seat tab), so MATCH SIMPLE skips the check while the column is
-- NULL. No ON DELETE path is exercised — dining_tables deactivate rather than delete, and a working
-- order the booking seated is not deleted out from under it.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_table_fk"
  FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_tables" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id") REFERENCES "working_orders" ("tenant_id", "id");

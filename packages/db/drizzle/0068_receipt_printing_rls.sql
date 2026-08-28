-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0066_station_printers_rls.sql / 0063_printing_rls.sql.
-- current_tenant_id() and app_user already exist (0001_tenancy_rls.sql); current_tenant_id() fails
-- closed — an unset app.tenant_id returns NULL, filtering every row. The inmutabilidad scan
-- (packages/fiscal-verifactu) requires FORCE ROW LEVEL SECURITY on every tenant_id-bearing table, so
-- drawer_opens gets it here (0067 emitted only ENABLE from .enableRLS()).
--> statement-breakpoint

-- tills.receipt_printer_id → printers (counter-receipt/drawer §2): the per-till receipt printer, which
-- is also the drawer kick (deli-hardware §6 — no separate device). A bare column carries no FK; the
-- tenant-consistent (tenant_id, receipt_printer_id) → printers(tenant_id, id) composite FK is
-- hand-written here, exactly as printers.agent_id → print_agents is. NULLABLE (a till may have no
-- printer) → MATCH SIMPLE skips the check on a NULL. No ON DELETE path is exercised — a printer is
-- deactivated (active = false), never deleted.
ALTER TABLE "tills"
  ADD CONSTRAINT "tills_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id");--> statement-breakpoint

-- drawer_opens — the cash-drawer AUDIT log (counter-receipt/drawer §2). Append-only-ish: a row is
-- ADDED, never edited or removed, so app_user holds SELECT/INSERT and no UPDATE/DELETE. It carries no
-- hash chain (unlike sale_voids/daily_closes), so the design (spec §2) scopes it to the withheld-grant
-- guard alone, not the four-part immutability recipe — no reject_mutation/TRUNCATE triggers. FORCE
-- applies RLS to the table OWNER too, so a deployment connecting as the non-superuser migration owner
-- is still isolated. FOR ALL, not FOR SELECT: USING filters reads, WITH CHECK filters writes, so a
-- tenant cannot INSERT a row it will never read back. REVOKE ALL first so a prior provisioning
-- GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "drawer_opens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "drawer_opens_tenant_isolation" ON "drawer_opens"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "drawer_opens" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON "drawer_opens" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs for drawer_opens, hand-written (a bare column carries no FK): each
-- cannot point at a parent row of another tenant, independently of whether RLS is in force on this
-- connection. drawer_opens.till_id → tills_tenant_id_key (tenant_id, id) [NOT NULL — MATCH SIMPLE
-- always checks]; drawer_opens.sale_id → sales_tenant_id_key (tenant_id, id) [NULLABLE — MATCH SIMPLE
-- skips on a NULL, a manual open with no sale]. No ON DELETE path is exercised — a till is never
-- deleted and a sale is immutable. person_id carries no FK (the identity/person schema is a separate
-- slice; this audit row records a raw operator id, the daily_closes.closed_by / sale_voids.voided_by
-- house seam).
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "drawer_opens"
  ADD CONSTRAINT "drawer_opens_sale_fk"
  FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sales" ("tenant_id", "id");

-- Hand-written (--custom; drizzle-kit has no concept of policies, FORCE, or privileges), same as
-- packages/db/drizzle/0039_recipes_rls.sql. current_tenant_id() already exists (0001_tenancy_rls.sql).
-- Both purchase-invoice tables are MUTABLE accounting records (a factura recibida can be corrected or
-- removed), the opposite of the immutable sales/registros lane, so DELETE is granted on both — spec §2.
--> statement-breakpoint
ALTER TABLE "purchase_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "purchase_invoices_tenant_isolation" ON "purchase_invoices"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "purchase_invoices" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoices" TO app_user;--> statement-breakpoint

ALTER TABLE "purchase_invoice_vat" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "purchase_invoice_vat_tenant_isolation" ON "purchase_invoice_vat"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint

REVOKE ALL ON "purchase_invoice_vat" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_invoice_vat" TO app_user;

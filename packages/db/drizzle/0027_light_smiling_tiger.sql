-- FORCE ROW LEVEL SECURITY + tenant-isolation policies + SELECT/INSERT/UPDATE app-role grants for
-- the three catalogue tables (`catalogues`, `categories`, `products`).
--
-- 0026 emitted `ENABLE ROW LEVEL SECURITY` from `.enableRLS()` and nothing more — Drizzle does not
-- emit FORCE, CREATE POLICY or GRANT. This hand-written custom migration adds them, exactly as
-- 0017_nodes_rls.sql did for `nodes` and 0001_tenancy_rls.sql for `tenants`/`locations`/`tills`.
-- The `current_tenant_id()` function and the `app_user` role already exist from 0001 and are NOT
-- recreated here.
--
-- FORCE and the FOR ALL policy mirror the `tills` lines of 0001: FORCE (so a deployment that
-- connects as the migration owner is still isolated — inert against a superuser, which is why it is
-- not the control that matters), and a FOR ALL policy whose USING filters reads and WITH CHECK
-- filters writes. FOR ALL, not FOR SELECT: a WITH CHECK is then already in place for the INSERT and
-- UPDATE the grant below permits, so a tenant cannot write a row it will never read back.
--
-- The GRANT is SELECT, INSERT, UPDATE — the running POS maintains its own menu — but NO DELETE:
-- a product may sit behind historical sale-line snapshots and is deactivated via `active`, never
-- removed (the same rule 0001 states for `locations`/`tills`, catalogue.ts documents on `products`).
ALTER TABLE "catalogues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalogues_tenant_isolation" ON "catalogues"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "catalogues" TO app_user;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "categories" TO app_user;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "products" TO app_user;

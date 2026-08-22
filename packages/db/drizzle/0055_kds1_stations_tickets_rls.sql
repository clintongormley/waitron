-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, partial-unique indexes,
-- or the tenant-consistent composite FKs), same shape as 0052_floor_plan_fp1_rls.sql /
-- 0036_till_layouts_rls.sql. current_tenant_id() and app_user already exist (0001_tenancy_rls.sql);
-- current_tenant_id() fails closed — an unset app.tenant_id returns NULL, filtering every row. The
-- inmutabilidad scan (packages/fiscal-verifactu) requires FORCE ROW LEVEL SECURITY on every
-- tenant_id-bearing table, so both new tables get it here (0054 emitted only ENABLE from .enableRLS()).
--> statement-breakpoint

-- kitchen_stations — MUTABLE config, no DELETE (deactivate via `active`; a ticket_items.station_id
-- snapshot may reference a row). FORCE applies RLS to the table OWNER too, so a deployment connecting
-- as the non-superuser migration owner is still isolated. FOR ALL, not FOR SELECT: USING filters reads,
-- WITH CHECK filters writes, so a tenant cannot INSERT/UPDATE a row it will never read back. REVOKE ALL
-- first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "kitchen_stations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kitchen_stations_tenant_isolation" ON "kitchen_stations"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "kitchen_stations" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "kitchen_stations" TO app_user;--> statement-breakpoint

-- Exactly one DEFAULT station per location — a PARTIAL unique drizzle-kit does not model. Named so the
-- deletion-proof in kitchen-stations.rls.test.ts can DROP it by name. Only is_default rows are indexed,
-- so any number of non-default stations, and one default per (tenant, location), coexist.
CREATE UNIQUE INDEX "kitchen_stations_default_key"
  ON "kitchen_stations" ("tenant_id", "location_id")
  WHERE "is_default";--> statement-breakpoint

-- ticket_items — MUTABLE, node-scoped, no DELETE (a cancelled/abandoned line's item is cascaded via the
-- working_order_line FK below, exactly as order_prep relied on its order FK — never deleted directly).
ALTER TABLE "ticket_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ticket_items_tenant_isolation" ON "ticket_items"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "ticket_items" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ticket_items" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- row of another tenant, independently of whether RLS is in force on this connection. All reference the
-- kitchen_stations_tenant_id_key / nodes_tenant_id_key / working_order_lines_tenant_id_key (tenant_id,
-- id) UNIQUEs. MATCH SIMPLE (the default) means a NULL station_id skips the check, so the nullable
-- routing columns stay optional.

-- categories.station_id / products.station_id — the category default + per-product override (routing,
-- §2b). NULLABLE: a NULL means "no route at this level"; the fire-time resolver falls through to the
-- location's default station. kitchen_stations deactivates rather than deletes, so no ON DELETE path.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");--> statement-breakpoint

-- ticket_items.node_id → nodes (node-scoped, as order_prep_node_fk was).
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_node_fk"
  FOREIGN KEY ("tenant_id", "node_id") REFERENCES "nodes" ("tenant_id", "id");--> statement-breakpoint

-- ticket_items.working_order_line_id → working_order_lines, ON DELETE CASCADE: a cancelled/abandoned
-- line's item is removed with the line (the analogue of order_prep_order_fk's cascade). This is why
-- app_user needs no DELETE on ticket_items above.
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_line_fk"
  FOREIGN KEY ("tenant_id", "working_order_line_id") REFERENCES "working_order_lines" ("tenant_id", "id")
  ON DELETE CASCADE;--> statement-breakpoint

-- ticket_items.station_id → kitchen_stations — the station the line was ROUTED to, snapshotted at fire
-- time. kitchen_stations deactivates rather than deletes, so no ON DELETE path is exercised.
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_stations" ("tenant_id", "id");

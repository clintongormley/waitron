-- Hand-written (--custom; drizzle-kit models no policies, FORCE, privileges, or the tenant-consistent
-- composite FKs), same shape as 0055_kds1_stations_tickets_rls.sql / 0052_floor_plan_fp1_rls.sql.
-- current_tenant_id() and app_user already exist (0001_tenancy_rls.sql); current_tenant_id() fails
-- closed — an unset app.tenant_id returns NULL, filtering every row. The inmutabilidad scan
-- (packages/fiscal-verifactu) requires FORCE ROW LEVEL SECURITY on every tenant_id-bearing table, so
-- kitchen_courses gets it here (0057 emitted only ENABLE from .enableRLS()). Registered in
-- meta/_journal.json by hand the way 0055 / 0056 were; snapshot-less for the same reason (drizzle-kit
-- models none of these statements, so `generate` reports "No schema changes" against this tree).
--> statement-breakpoint

-- kitchen_courses — MUTABLE config, no DELETE (deactivate via `active`; a ticket_items.course_id
-- snapshot may reference a row). FORCE applies RLS to the table OWNER too, so a deployment connecting
-- as the non-superuser migration owner is still isolated. FOR ALL, not FOR SELECT: USING filters reads,
-- WITH CHECK filters writes, so a tenant cannot INSERT/UPDATE a row it will never read back. REVOKE ALL
-- first so a prior provisioning GRANT ALL cannot survive, then the targeted grant.
ALTER TABLE "kitchen_courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kitchen_courses_tenant_isolation" ON "kitchen_courses"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "kitchen_courses" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "kitchen_courses" TO app_user;--> statement-breakpoint

-- Tenant-consistent composite FKs, hand-written (a bare column carries no FK): each cannot point at a
-- course of another tenant, independently of whether RLS is in force on this connection. All reference
-- the kitchen_courses_tenant_id_key (tenant_id, id) UNIQUE. MATCH SIMPLE (the default) means a NULL
-- course_id skips the check, so the nullable course columns stay optional (a null course fires
-- earliest, spec §2b). kitchen_courses deactivates rather than deletes, so no ON DELETE path.

-- products.course_id — the product-default course (§2b), the mirror of products_station_fk (0055).
ALTER TABLE "products"
  ADD CONSTRAINT "products_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");--> statement-breakpoint

-- working_order_lines.course_id — the course resolved onto the line at ring time (§2b).
ALTER TABLE "working_order_lines"
  ADD CONSTRAINT "working_order_lines_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");--> statement-breakpoint

-- ticket_items.course_id — the course snapshotted at fire time (§2b), the analogue of ticket_items_station_fk.
ALTER TABLE "ticket_items"
  ADD CONSTRAINT "ticket_items_course_fk"
  FOREIGN KEY ("tenant_id", "course_id") REFERENCES "kitchen_courses" ("tenant_id", "id");

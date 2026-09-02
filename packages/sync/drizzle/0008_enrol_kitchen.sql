-- Hand-written custom migration for @waitron/sync (this package has NO drizzle.config.ts — its
-- journal + snapshots are hand-maintained and drizzle-kit never diffs it). Runs LAST in
-- migrations.manifest.json's `sync` set, AFTER the `db` set created these tables (kitchen_stations +
-- ticket_items in 0055_kds1_stations_tickets_rls.sql, kitchen_courses in 0058_kds2_courses_fire_rls.sql),
-- so each CREATE TRIGGER targets an existing table.
--
-- WHAT THIS BUILDS. Kitchen-sync enrolment (spec
-- docs/superpowers/specs/2026-09-02-sync-kitchen-enrolment-design.md §3/§6): three capture triggers
-- enrolling the kitchen-display (KDS) FK closure into the commercial ORDERED outbox, reusing the
-- existing generic sync_capture() function (0000_sync_outbox.sql:126). This is the whole DB change —
-- the registry entry + SYNC_SCHEMA_TABLES row derive the apply SQL generically (apply-sql.ts).
--
-- WHY these three. categories.station_id/products.station_id → kitchen_stations
-- (categories_station_fk/products_station_fk, 0055_kds1_stations_tickets_rls.sql:49,52) and
-- products.course_id/working_order_lines.course_id → kitchen_courses
-- (products_course_fk/working_order_lines_course_fk, 0058_kds2_courses_fire_rls.sql:34,39) are FKs from
-- ALREADY-ENROLLED tables INTO the kitchen config. Without kitchen_stations/kitchen_courses enrolled, a
-- subscriber applying a routed products/categories/working_order_lines row finds no parent → 23503 →
-- the row parks and the whole ordered lane stalls (spec §1). ticket_items is the KDS operational row the
-- mirror exists to show; enrolling it forces only parents already enrolled here.
--
-- NO grants. app_user already holds INSERT on sync_log (0000_sync_outbox.sql:62) and exactly
-- SELECT/INSERT/UPDATE on all three tables (0055_kds1_stations_tickets_rls.sql:20,37,
-- 0058_kds2_courses_fire_rls.sql:24) — no DELETE. The trigger runs as the WRITING app role (not
-- SECURITY DEFINER), so the sync_log WITH CHECK (tenant_id = current_tenant_id()) is satisfied by
-- construction.
--
-- AFTER INSERT OR UPDATE, no DELETE (spec §5). kitchen_stations/kitchen_courses deactivate via `active`
-- and hold no DELETE grant. ticket_items holds no DELETE grant either: a ticket is removed ONLY by the
-- ticket_items_line_fk … ON DELETE CASCADE (0055_kds1_stations_tickets_rls.sql:64-66) when its
-- working_order_lines parent is deleted. working_order_lines IS enrolled and DOES capture its deletes
-- (registry.ts Group C), and the same CASCADE constraint is present on the subscriber's schema by the
-- same migration, so applying the parent's DELETE removes the child ticket_items locally — reproducing
-- the primary's cascade without a captured ticket_items DELETE.
--
-- The WHEN clause reads app.sync_apply so a replicated write is NOT re-captured (no A->B->A echo loop;
-- 0000_sync_outbox.sql:149-156). `IS DISTINCT FROM` so an unset GUC still fires the capture.

CREATE TRIGGER kitchen_stations_capture AFTER INSERT OR UPDATE ON kitchen_stations
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER kitchen_courses_capture AFTER INSERT OR UPDATE ON kitchen_courses
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER ticket_items_capture AFTER INSERT OR UPDATE ON ticket_items
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();

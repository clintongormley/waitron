-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no triggers and
-- sync_capture/sync_log are not Drizzle tables, so nothing here survives a later `generate`. Runs LAST
-- in migrations.manifest.json (the `sync` set), after core/db created dining_tables, floor_zones and
-- table_service_statuses (0044/0048/0052), so each CREATE TRIGGER targets an existing table.
--
-- WHAT THIS BUILDS. Sub-project C1
-- (docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md): enrol the dining_tables
-- FK closure into the commercial ORDERED lane so a real ordered-lane subscriber can apply a
-- counter-delivery working_order (delivery_table_id → dining_tables) without 23503-parking and stalling
-- the whole lane. Three capture triggers, echo-gated on app.sync_apply (so a replicated write is not
-- re-captured), AFTER INSERT OR UPDATE — these tables deactivate via `active`, never DELETE, so there
-- is no delete to capture. NO grants: the app role already holds INSERT on sync_log (0000) and
-- SELECT/INSERT/UPDATE on all three (0044/0048/0052).

CREATE TRIGGER floor_zones_capture AFTER INSERT OR UPDATE ON floor_zones
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER table_service_statuses_capture AFTER INSERT OR UPDATE ON table_service_statuses
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();
--> statement-breakpoint
CREATE TRIGGER dining_tables_capture AFTER INSERT OR UPDATE ON dining_tables
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();

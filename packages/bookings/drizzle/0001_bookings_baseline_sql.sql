-- Custom SQL migration file, put your code below! --
-- app_user holds SELECT, INSERT, UPDATE — never DELETE (a booking is CANCELLED, never removed;
-- see schema/bookings.ts) and never TRUNCATE. Verbatim from core's former 0001_db_baseline_sql.sql.
REVOKE ALL ON "bookings" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;
--> statement-breakpoint
-- The two tenant-consistent COMPOSITE FKs drizzle-kit cannot model, hand-written (schema/bookings.ts
-- documents why the columns are bare): (tenant_id, table_id) → dining_tables and
-- (tenant_id, tab_id) → working_orders. Verbatim from core's former 0001_db_baseline_sql.sql.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_table_fk"
  FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_tables" ("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tab_fk"
  FOREIGN KEY ("tenant_id", "tab_id") REFERENCES "working_orders" ("tenant_id", "id");
--> statement-breakpoint
-- Sync enrolment (state class): capture INSERT/UPDATE into sync_log via sync's SPI. No DELETE — a
-- booking is CANCELLED, never removed, so app_user holds no DELETE. The WHEN echo-guard suppresses
-- capture on the apply path (app.sync_apply = 'on'), or an applied row would re-enqueue itself.
-- sync_capture() is owned by the sync module, so bookings requires it (composition requires.modules.sync).
CREATE TRIGGER bookings_capture AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW WHEN (current_setting('app.sync_apply', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION sync_capture();

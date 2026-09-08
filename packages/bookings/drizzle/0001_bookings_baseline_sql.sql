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

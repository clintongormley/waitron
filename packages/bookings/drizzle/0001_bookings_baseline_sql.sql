-- Custom SQL migration file, put your code below! --
-- app_user holds SELECT, INSERT, UPDATE — never DELETE (a booking is CANCELLED, never removed;
-- see schema/bookings.ts) and never TRUNCATE.
REVOKE ALL ON "bookings" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bookings" TO app_user;
--> statement-breakpoint
-- The two foreign keys schema/bookings.ts leaves undeclared (its columns are bare), each on the
-- parent's primary key.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_table_fk"
  FOREIGN KEY ("table_id") REFERENCES "dining_tables" ("id");
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tab_fk"
  FOREIGN KEY ("tab_id") REFERENCES "working_orders" ("id");

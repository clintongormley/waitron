-- Custom SQL migration file, put your code below! --
-- Dropping bookings.tenant_id in 0002 also dropped the two composite foreign keys that included it
-- (bookings_table_fk and bookings_tab_fk). They come back on the one column each, pointing at the
-- parent's primary key. drizzle-kit does not declare them (schema/bookings.ts keeps the columns bare).
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_table_fk"
  FOREIGN KEY ("table_id") REFERENCES "dining_tables" ("id");
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_tab_fk"
  FOREIGN KEY ("tab_id") REFERENCES "working_orders" ("id");

-- BEFORE the generated tenant_id drop: the same before/after pair every module set used for its own
-- drop (a hand-written migration each side of the generated one).
--
-- Every object below is HAND-WRITTEN in an earlier custom migration, so it is absent from
-- drizzle/meta/*.json and `drizzle-kit generate` emits no DROP for it. Each one names `tenant_id`,
-- and each composite foreign key below depends on a `<table>_tenant_id_key` UNIQUE that the NEXT
-- migration drops — PostgreSQL refuses that drop while a foreign key depends on it (2BP01), so the
-- keys come off here first. The single-column replacements are added back in the migration after the
-- generated one.
--
-- Relying on `DROP COLUMN tenant_id` to remove them implicitly would work but is silent (the lesson
-- the bookings set paid for): a constraint that vanishes without a statement naming it is a
-- constraint nobody re-adds. IF EXISTS keeps each statement idempotent.

--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_station_fk";
--> statement-breakpoint
ALTER TABLE "device_profiles" DROP CONSTRAINT IF EXISTS "device_profiles_canvas_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_device_profile_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_receipt_printer_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_station_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_till_fk";
--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT IF EXISTS "dining_tables_tab_fk";
--> statement-breakpoint
ALTER TABLE "dining_tables" DROP CONSTRAINT IF EXISTS "dining_tables_zone_fk";
--> statement-breakpoint
ALTER TABLE "drawer_opens" DROP CONSTRAINT IF EXISTS "drawer_opens_sale_fk";
--> statement-breakpoint
ALTER TABLE "drawer_opens" DROP CONSTRAINT IF EXISTS "drawer_opens_till_fk";
--> statement-breakpoint
ALTER TABLE "location_catalogues" DROP CONSTRAINT IF EXISTS "location_catalogues_catalogue_fk";
--> statement-breakpoint
ALTER TABLE "location_catalogues" DROP CONSTRAINT IF EXISTS "location_catalogues_location_fk";
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_catalogue_fk";
--> statement-breakpoint
ALTER TABLE "print_jobs" DROP CONSTRAINT IF EXISTS "print_jobs_claimed_by_fk";
--> statement-breakpoint
ALTER TABLE "print_jobs" DROP CONSTRAINT IF EXISTS "print_jobs_printer_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_course_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_station_fk";
--> statement-breakpoint
ALTER TABLE "sale_lines" DROP CONSTRAINT IF EXISTS "sale_lines_parent_fk";
--> statement-breakpoint
ALTER TABLE "station_printers" DROP CONSTRAINT IF EXISTS "station_printers_printer_fk";
--> statement-breakpoint
ALTER TABLE "station_printers" DROP CONSTRAINT IF EXISTS "station_printers_station_fk";
--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT IF EXISTS "ticket_items_course_fk";
--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT IF EXISTS "ticket_items_line_fk";
--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT IF EXISTS "ticket_items_node_fk";
--> statement-breakpoint
ALTER TABLE "ticket_items" DROP CONSTRAINT IF EXISTS "ticket_items_station_fk";
--> statement-breakpoint
ALTER TABLE "tills" DROP CONSTRAINT IF EXISTS "tills_receipt_printer_fk";
--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT IF EXISTS "working_order_lines_course_fk";
--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT IF EXISTS "working_order_lines_option_item_fk";
--> statement-breakpoint
ALTER TABLE "working_order_lines" DROP CONSTRAINT IF EXISTS "working_order_lines_parent_fk";
--> statement-breakpoint
ALTER TABLE "working_orders" DROP CONSTRAINT IF EXISTS "working_orders_delivery_table_fk";
--> statement-breakpoint
-- The four hand-written indexes whose leading column is `tenant_id`. Each is recreated on its
-- remaining columns after the generated migration; `sale_voids_tenant_idx` is not — it indexed the
-- tenant alone and has nothing left to index.
DROP INDEX IF EXISTS "incidents_open_dedup";
--> statement-breakpoint
DROP INDEX IF EXISTS "kitchen_stations_default_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "printers_local_key_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "tills_tenant_location_name_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "sale_voids_tenant_idx";

ALTER TABLE "bookings" DROP CONSTRAINT "bookings_tenant_id_key";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_tenant_fk";
--> statement-breakpoint
DROP INDEX "bookings_tenant_location_date_idx";--> statement-breakpoint
DROP INDEX "bookings_tenant_table_status_date_time_idx";--> statement-breakpoint
CREATE INDEX "bookings_location_date_idx" ON "bookings" USING btree ("location_id","booking_date");--> statement-breakpoint
CREATE INDEX "bookings_table_status_date_time_idx" ON "bookings" USING btree ("table_id","status","booking_date","booking_time");--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "tenant_id";
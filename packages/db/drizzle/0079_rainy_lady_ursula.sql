CREATE TYPE "public"."booking_status" AS ENUM('booked', 'seated', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"booking_time" time NOT NULL,
	"party_size" integer NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"notes" text,
	"table_id" uuid,
	"tab_id" uuid,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "bookings_party_size_ck" CHECK ("bookings"."party_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_tenant_location_date_idx" ON "bookings" USING btree ("tenant_id","location_id","booking_date");--> statement-breakpoint
CREATE INDEX "bookings_tenant_table_status_date_time_idx" ON "bookings" USING btree ("tenant_id","table_id","status","booking_date","booking_time");
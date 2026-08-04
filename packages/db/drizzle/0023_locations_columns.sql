ALTER TABLE "locations" ADD COLUMN "fiscal_territory" text DEFAULT 'ES-common' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "time_zone" text DEFAULT 'Europe/Madrid' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "day_cutover" time DEFAULT '06:00:00' NOT NULL;
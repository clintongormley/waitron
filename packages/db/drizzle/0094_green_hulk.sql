ALTER TABLE "device_pairing_codes" ADD COLUMN "till_id" uuid;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD COLUMN "layout_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD COLUMN "receipt_printer_id" uuid;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD COLUMN "has_cash_drawer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD COLUMN "card_provider" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD COLUMN "card_reader_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "till_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "layout_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "receipt_printer_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "has_cash_drawer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "card_provider" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "card_reader_id" text;
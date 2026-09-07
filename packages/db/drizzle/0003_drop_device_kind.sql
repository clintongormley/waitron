ALTER TABLE "devices" ALTER COLUMN "device_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "device_kind";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "station_id";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "till_id";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "device_profile_id";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "receipt_printer_id";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "has_cash_drawer";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "card_provider";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "card_reader_id";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "device_kind";--> statement-breakpoint
DROP TYPE "public"."device_kind";
ALTER TABLE "device_pairing_codes" ADD COLUMN "device_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "device_profile_id" uuid;
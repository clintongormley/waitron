ALTER TYPE "public"."print_transport" ADD VALUE 'bluetooth' BEFORE 'cloud_poll';--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "local_key" text;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "claimed_by" uuid;--> statement-breakpoint
ALTER TABLE "printers" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "printers" DROP COLUMN "usb_path";

CREATE TYPE "public"."drawer_open_policy" AS ENUM('gated', 'open');--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "drawer_open_policy" "drawer_open_policy" DEFAULT 'gated' NOT NULL;--> statement-breakpoint
ALTER TABLE "drawer_opens" ADD COLUMN "authorized_by" uuid;--> statement-breakpoint
ALTER TABLE "drawer_opens" ADD COLUMN "via_override" boolean DEFAULT false NOT NULL;
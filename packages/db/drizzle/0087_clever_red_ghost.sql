CREATE TYPE "public"."doneness" AS ENUM('rare', 'medium_rare', 'medium', 'medium_well', 'well_done');--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "doneness" "doneness";--> statement-breakpoint
ALTER TABLE "ticket_items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD COLUMN "doneness" "doneness";
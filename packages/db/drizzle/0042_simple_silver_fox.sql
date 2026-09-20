ALTER TABLE "working_order_lines" DROP COLUMN "doneness";--> statement-breakpoint
ALTER TABLE "ticket_items" DROP COLUMN "doneness";--> statement-breakpoint
DROP TYPE "public"."doneness";
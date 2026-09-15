ALTER TABLE "option_group_items" ADD COLUMN "dietary_suitability" jsonb;--> statement-breakpoint
ALTER TABLE "option_group_items" DROP COLUMN "dietary_effect";
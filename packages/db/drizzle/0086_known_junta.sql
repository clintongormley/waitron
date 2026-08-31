CREATE TYPE "public"."dietary_origin" AS ENUM('plant', 'meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey', 'other_animal');--> statement-breakpoint
ALTER TABLE "option_group_items" ADD COLUMN "add_origins" jsonb;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD COLUMN "remove_origins" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "diet_derivation" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "diet_override" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "diet" jsonb;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "dietary_origin" "dietary_origin";
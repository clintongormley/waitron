ALTER TABLE "product_variants" ALTER COLUMN "name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "customer_name" jsonb;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "kitchen_name" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "image" text;
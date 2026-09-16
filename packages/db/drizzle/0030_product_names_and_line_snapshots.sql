ALTER TABLE "working_order_lines" ALTER COLUMN "variant_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "variant_name" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "variant_descriptions" jsonb;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "variant_kitchen_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "customer_name" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "variant_descriptions" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "variant_kitchen_name" text;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "descriptions";
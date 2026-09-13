ALTER TABLE "working_order_lines" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "variant_name" jsonb;--> statement-breakpoint
ALTER TABLE "working_order_lines" ADD COLUMN "kitchen_name" text;--> statement-breakpoint
ALTER TABLE "option_group_items" ADD COLUMN "dietary_effect" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kitchen_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "dietary_declarations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "variant_name" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "kitchen_name" text;
ALTER TABLE "menu_item_options" ALTER COLUMN "price_delta" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_items" ALTER COLUMN "gross_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "extra_list_items" ALTER COLUMN "price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ALTER COLUMN "price" SET DATA TYPE bigint;
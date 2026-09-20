ALTER TABLE "menu_item_options" ALTER COLUMN "price_delta" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_items" ALTER COLUMN "gross_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_item_variants" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "unit_price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "extra_list_items" ALTER COLUMN "price" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ALTER COLUMN "price" SET DATA TYPE bigint;
--> statement-breakpoint
-- `ALTER COLUMN ... SET DATA TYPE` keeps the objects defined over the old type rather than
-- re-deriving them, so every check and default that names one of the columns above still describes
-- a decimal: a check reads back as `(price)::numeric >= (0)::numeric`, and a default as
-- `'0'::numeric`. Both still behave correctly, and both leave a migrated database describing a
-- column type the schema no longer declares. Re-stated here over the new type. The core set has
-- the same repair in packages/db/drizzle/0044_money_in_cents_sql.sql, where
-- packages/db/src/schema/schema-conformance.test.ts is what says the list is complete; this set
-- has no such guard, so the list here was taken by applying the migrations and reading
-- pg_get_constraintdef back.
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_price_ck";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_ck" CHECK ("product_variants"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "menu_item_variants" DROP CONSTRAINT "menu_item_variants_price_ck";--> statement-breakpoint
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_price_ck" CHECK ("menu_item_variants"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "menu_items" DROP CONSTRAINT "menu_items_gross_price_ck";--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_gross_price_ck" CHECK ("menu_items"."gross_price" >= 0);--> statement-breakpoint
ALTER TABLE "extra_list_items" DROP CONSTRAINT "extra_list_items_price_ck";--> statement-breakpoint
ALTER TABLE "extra_list_items" ADD CONSTRAINT "extra_list_items_price_ck" CHECK ("extra_list_items"."price" >= 0);--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" DROP CONSTRAINT "menu_item_extra_items_price_ck";--> statement-breakpoint
ALTER TABLE "menu_item_extra_items" ADD CONSTRAINT "menu_item_extra_items_price_ck" CHECK ("menu_item_extra_items"."price" >= 0);--> statement-breakpoint
ALTER TABLE "menu_item_options" ALTER COLUMN "price_delta" SET DEFAULT 0;

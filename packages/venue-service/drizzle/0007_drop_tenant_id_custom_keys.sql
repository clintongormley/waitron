-- Custom SQL migration file, put your code below! --
-- The hand-written foreign key and partial unique indexes below include tenant_id, and the foreign
-- key depends on zone_menus_pk, which the next migration rebuilds without it. They are dropped first
-- and recreated without the tenant in 0009.
ALTER TABLE "zone_service_policies" DROP CONSTRAINT "zone_service_policies_default_allowed_fk";
--> statement-breakpoint
DROP INDEX "preparation_routes_zone_product_key";
--> statement-breakpoint
DROP INDEX "preparation_routes_zone_category_key";
--> statement-breakpoint
DROP INDEX "preparation_routes_venue_product_key";
--> statement-breakpoint
DROP INDEX "preparation_routes_venue_category_key";
--> statement-breakpoint
DROP INDEX "departments_one_default_per_location_key";
--> statement-breakpoint
DROP INDEX "zone_service_policies_one_counter_default_key";

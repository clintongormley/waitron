-- Custom SQL migration file, put your code below! --
-- A default menu must also be an allowed menu for that zone. MATCH SIMPLE permits an incomplete
-- draft policy with no default while a manager configures it.
ALTER TABLE "zone_service_policies"
  ADD CONSTRAINT "zone_service_policies_default_allowed_fk"
  FOREIGN KEY ("zone_id", "default_menu_id")
  REFERENCES "zone_menus" ("zone_id", "menu_id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- NULLS represent venue-wide routing. Separate partial uniques make every specificity unambiguous.
CREATE UNIQUE INDEX "preparation_routes_zone_product_key"
  ON "preparation_routes" ("location_id", "zone_id", "product_id")
  WHERE "zone_id" IS NOT NULL AND "product_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_zone_category_key"
  ON "preparation_routes" ("location_id", "zone_id", "category_id")
  WHERE "zone_id" IS NOT NULL AND "category_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_venue_product_key"
  ON "preparation_routes" ("location_id", "product_id")
  WHERE "zone_id" IS NULL AND "product_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_venue_category_key"
  ON "preparation_routes" ("location_id", "category_id")
  WHERE "zone_id" IS NULL AND "category_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_one_default_per_location_key"
  ON "departments" ("location_id")
  WHERE "is_default";
--> statement-breakpoint
CREATE UNIQUE INDEX "zone_service_policies_one_counter_default_key"
  ON "zone_service_policies" ("location_id")
  WHERE "is_counter_default";

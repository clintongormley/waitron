REVOKE ALL ON
  "departments", "zone_service_policies", "zone_menus", "device_zone_defaults",
  "preparation_routes", "department_hours", "order_service_contexts", "working_line_contexts"
FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "departments", "zone_service_policies" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "zone_menus", "device_zone_defaults", "preparation_routes", "department_hours",
  "order_service_contexts", "working_line_contexts"
TO app_user;
--> statement-breakpoint
-- A default menu must also be an allowed menu for that zone. MATCH SIMPLE permits an incomplete
-- draft policy with no default while a manager configures it.
ALTER TABLE "zone_service_policies"
  ADD CONSTRAINT "zone_service_policies_default_allowed_fk"
  FOREIGN KEY ("tenant_id", "zone_id", "default_menu_id")
  REFERENCES "zone_menus" ("tenant_id", "zone_id", "menu_id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- NULLS represent venue-wide routing. Separate partial uniques make every specificity unambiguous.
CREATE UNIQUE INDEX "preparation_routes_zone_product_key"
  ON "preparation_routes" ("tenant_id", "location_id", "zone_id", "product_id")
  WHERE "zone_id" IS NOT NULL AND "product_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_zone_category_key"
  ON "preparation_routes" ("tenant_id", "location_id", "zone_id", "category_id")
  WHERE "zone_id" IS NOT NULL AND "category_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_venue_product_key"
  ON "preparation_routes" ("tenant_id", "location_id", "product_id")
  WHERE "zone_id" IS NULL AND "product_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "preparation_routes_venue_category_key"
  ON "preparation_routes" ("tenant_id", "location_id", "category_id")
  WHERE "zone_id" IS NULL AND "category_id" IS NOT NULL;

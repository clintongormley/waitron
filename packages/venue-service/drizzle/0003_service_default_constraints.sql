CREATE UNIQUE INDEX "departments_one_default_per_location_key"
  ON "departments" ("tenant_id", "location_id")
  WHERE "is_default";
--> statement-breakpoint
CREATE UNIQUE INDEX "zone_service_policies_one_counter_default_key"
  ON "zone_service_policies" ("tenant_id", "location_id")
  WHERE "is_counter_default";

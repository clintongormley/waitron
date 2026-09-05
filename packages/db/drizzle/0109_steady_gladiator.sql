-- Custom (device-profile design 2026-09-05 §5.1): the tenant-consistent composite FKs for the
-- `device_profile_id` binding columns 0108 added to `devices` and `device_pairing_codes`. drizzle-kit
-- cannot model a composite FK from a BARE uuid column (the `devices.station_id` idiom,
-- 0095_parched_meteorite.sql), so each is hand-written here, one statement per breakpoint, exactly as
-- 0095 adds the other device-binding FKs and 0107 adds device_profiles_canvas_fk. Each references the
-- EXISTING device_profiles_tenant_id_key UNIQUE (device-profiles.ts, added by 0106) — so NO new unique
-- is created here. ON DELETE RESTRICT: a device_profiles row is not hard-deleted while a device or a
-- pairing code references it (the store's deleteDeviceProfile lets that raw restrict_violation
-- propagate). MATCH SIMPLE (the FK default) skips the check whenever any key column is NULL, so a NULL
-- device_profile_id is unconstrained — the binding is optional, and only a non-NULL value must name a
-- profile of the SAME tenant.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_device_profile_fk"
  FOREIGN KEY ("tenant_id", "device_profile_id") REFERENCES "device_profiles" ("tenant_id", "id") ON DELETE RESTRICT;

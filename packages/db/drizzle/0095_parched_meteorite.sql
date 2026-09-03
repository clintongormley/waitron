-- Custom (SP-A.2 §16): the tenant-consistent composite FKs for the device binding columns 0094 added.
-- drizzle-kit cannot model a composite FK from a BARE uuid column (the `devices.station_id` idiom), so
-- each is hand-written here, one statement per breakpoint, exactly as 0061_devices_rls.sql adds the
-- (tenant_id, station_id) → kitchen_stations FK. Each references an EXISTING (tenant_id, id) UNIQUE —
-- tills_tenant_id_key (tenants.ts), layout_profiles_tenant_id_key (0088), printers_tenant_id_key
-- (printers.ts) — so NO new unique is created here. ON DELETE RESTRICT: none of tills, layout_profiles
-- or printers is hard-deleted while a device references it. MATCH SIMPLE (the FK default) skips the
-- check whenever any column of the key is NULL, so a NULL till_id / layout_profile_id /
-- receipt_printer_id is unconstrained — the binding is optional, and only a non-NULL value must name a
-- row of the SAME tenant.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_layout_profile_fk"
  FOREIGN KEY ("tenant_id", "layout_profile_id") REFERENCES "layout_profiles" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_till_fk"
  FOREIGN KEY ("tenant_id", "till_id") REFERENCES "tills" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_layout_profile_fk"
  FOREIGN KEY ("tenant_id", "layout_profile_id") REFERENCES "layout_profiles" ("tenant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_receipt_printer_fk"
  FOREIGN KEY ("tenant_id", "receipt_printer_id") REFERENCES "printers" ("tenant_id", "id") ON DELETE RESTRICT;

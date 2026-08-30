-- Custom: a device's station presence is tied to its kind. Only kds_station binds a station;
-- handheld (a roving, location-wide waiter device) carries none. drizzle-kit does not model raw
-- CHECK constraints, so this is hand-written in the --custom style (one statement per breakpoint),
-- the way 0061_devices_rls.sql adds the composite FKs. A future device_kind must add its own clause
-- here — the CHECK enumerates the kinds, so an unlisted kind fails BOTH branches and is rejected
-- until it does.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_kind_ck"
  CHECK ((device_kind = 'kds_station' AND station_id IS NOT NULL)
      OR (device_kind = 'handheld' AND station_id IS NULL));--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_kind_ck"
  CHECK ((device_kind = 'kds_station' AND station_id IS NOT NULL)
      OR (device_kind = 'handheld' AND station_id IS NULL));

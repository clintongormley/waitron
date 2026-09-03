-- Custom (SP-A.2 §16): the `till` device kind (added in 0092) binds NO station, exactly like a
-- `handheld`. The per-kind station CHECK from 0076 named `handheld` explicitly, so a `till` row would
-- fail BOTH of its branches and be rejected. Rewrite it in the form
-- `(device_kind = 'kds_station') = (station_id IS NOT NULL)`: kds_station ⇒ a station, EVERY other
-- kind (handheld AND till) ⇒ none. Two things this buys us:
--  1. It names ONLY the `kds_station` literal, never `'till'`, so it sidesteps Postgres's restriction
--     against using a newly-added enum value in the same transaction that added it (0092's ADD VALUE
--     is its own migration anyway, so they never share a transaction — but the form keeps that true
--     regardless of how the migrator batches files).
--  2. A future station-binding kind extends this by OR-ing its own `(device_kind = '…')` equality;
--     a future station-LESS kind needs no change at all (it is already covered by the `= FALSE` side).
-- drizzle-kit models no raw CHECKs, so this is hand-written --custom, one statement per breakpoint,
-- the way 0076 added the original and 0061 adds the composite FKs. DROP then ADD (a CHECK cannot be
-- ALTERed in place); the constraint name is unchanged.
ALTER TABLE "devices"
  DROP CONSTRAINT "devices_station_kind_ck";--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_station_kind_ck"
  CHECK ((device_kind = 'kds_station') = (station_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  DROP CONSTRAINT "device_pairing_codes_station_kind_ck";--> statement-breakpoint
ALTER TABLE "device_pairing_codes"
  ADD CONSTRAINT "device_pairing_codes_station_kind_ck"
  CHECK ((device_kind = 'kds_station') = (station_id IS NOT NULL));

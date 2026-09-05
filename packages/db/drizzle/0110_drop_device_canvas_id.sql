-- Device-profile cutover (design 2026-09-05 §10): drop the now-dead direct DEVICE→canvas binding.
-- After Task 9 a device resolves its canvas + capabilities SOLELY through its `device_profile_id`
-- (device_profiles.canvas_id), so `devices.canvas_id` / `device_pairing_codes.canvas_id` — and the
-- hand-written composite FKs on them (`devices_canvas_fk` / `device_pairing_codes_canvas_fk`, 0095
-- renamed by 0102, 0107 for the device_profiles twin) — are dead. Pre-production: no backfill.
--
-- The FK is DROPPED FIRST, EXPLICITLY: those composite `(tenant_id, canvas_id)` FKs are hand-written
-- (a bare-uuid column, the `station_id` idiom), so drizzle-kit never modelled them and its generated
-- diff emits only `DROP COLUMN` — which relies on PostgreSQL's implicit auto-drop of a constraint that
-- depends on the dropped column. Naming the DROP CONSTRAINT makes the intent explicit and reviewable
-- (the repo idiom for hand-written FKs) rather than leaving it to that implicit cascade. `device_profiles`
-- keeps ITS `canvas_id` + `device_profiles_canvas_fk` — the profile is now the only device→canvas link.
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_canvas_fk";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP CONSTRAINT IF EXISTS "device_pairing_codes_canvas_fk";--> statement-breakpoint
ALTER TABLE "device_pairing_codes" DROP COLUMN "canvas_id";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "canvas_id";

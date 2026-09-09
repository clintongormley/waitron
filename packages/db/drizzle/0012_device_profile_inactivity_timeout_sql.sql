-- A per-profile auto-logout idle timeout in seconds; NULL = never. Nullable, no default (most
-- profiles opt out; the seed sets phone-portrait to 300, KDS/till stay NULL). Hand-written as a
-- --custom migration (snapshot-less): `db:generate` proposes DROP TABLE "bookings" CASCADE because
-- that module table left the core schema barrel but stays in the core snapshot chain, so the column
-- is added by hand rather than through the auto-diff. The column inherits `device_profiles`'
-- table-level grants — no GRANT needed (the deployment-role grant assertions stay green).
ALTER TABLE "device_profiles" ADD COLUMN "inactivity_timeout_seconds" integer;

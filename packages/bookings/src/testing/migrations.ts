import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * The bookings capture trigger (0001_bookings_baseline_sql.sql) EXECUTEs `sync_capture()`, which the
 * `sync` module owns, so bookings cannot migrate on top of `core` alone — the fixtures apply the whole
 * manifest in order (core … identity … payments … sync … bookings). Same reason and shape as
 * `@waitron/fiscal-verifactu`'s `test/migrations.ts`.
 */
export const BOOKINGS_TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

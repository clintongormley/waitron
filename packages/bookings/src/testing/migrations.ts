import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Bookings FKs into `core`, so the fixtures apply the whole manifest in order (so bookings lands on
 * top of its dependency). Same shape as `@waitron/fiscal-verifactu`'s `test/migrations.ts`.
 */
export const BOOKINGS_TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

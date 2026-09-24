import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/** Bookings has keys into `core`, so fixtures apply the whole manifest in order. */
export const BOOKINGS_TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

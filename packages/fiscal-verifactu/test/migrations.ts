import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/** Fiscal capture triggers need sync_capture(), so fixtures apply the whole manifest in order. */
export const TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

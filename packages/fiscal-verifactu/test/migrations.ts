import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/** Fixtures apply the whole manifest in order so fiscal lands on top of its `core` dependency. */
export const TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

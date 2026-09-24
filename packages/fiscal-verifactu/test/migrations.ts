import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

export const TEST_MIGRATIONS = migrationOptionsFor(manifestSets(), null);

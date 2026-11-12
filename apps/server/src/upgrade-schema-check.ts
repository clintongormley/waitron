import { openVenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
import { assertNotAhead as assertDatabaseNotAhead } from "@waitron/provisioning";

export async function assertNotAhead(venueDir: string, migrationsRoot: string): Promise<void> {
  const store = await openVenueDatabase(venueDir);
  try {
    await assertDatabaseNotAhead(store, manifestSets(), migrationsRoot);
  } finally {
    await store.close();
  }
}

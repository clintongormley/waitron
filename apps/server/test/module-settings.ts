import { openVenueDatabase, readSettings, saveSettings, withTransaction } from "@waitron/db";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { ALL_MODULES, MODULES_SETTINGS } from "../src/modules.js";

export async function seedModuleSettings(
  venueDir: string,
  overrides: Record<string, boolean>,
): Promise<void> {
  await applyMigrations(
    venueDir,
    migrationOptionsFor(orderedMigrationSets(ALL_MODULES.filter((m) => m.name === "core")), null),
  );
  const store = await openVenueDatabase(venueDir);
  try {
    await withTransaction(store.venue, async (tx) => {
      const current = await readSettings(tx, MODULES_SETTINGS);
      await saveSettings(tx, MODULES_SETTINGS, {
        doc: { modules: overrides },
        expectedRevision: current.revision,
        personId: null,
      });
    });
  } finally {
    await store.close();
  }
}

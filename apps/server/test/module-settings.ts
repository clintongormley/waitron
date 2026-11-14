import {
  openVenueDatabase,
  readSettings,
  saveSettings,
  withTransaction,
  type Database,
} from "@waitron/db";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { sql } from "drizzle-orm";
import { writeModuleConfig } from "../src/module-config.js";
import { ALL_MODULES, MODULES_SETTINGS } from "../src/modules.js";

export async function seedModuleSettings(
  venueDir: string | Database,
  overrides: Record<string, boolean>,
): Promise<void> {
  if (typeof venueDir !== "string") {
    await writeModuleConfig(venueDir, { overrides: new Map(Object.entries(overrides)) }, null);
    return;
  }
  let store = await openVenueDatabase(venueDir);
  try {
    const present = await store.venue.execute(
      sql`select 1 from sqlite_master where type = 'table' and name = 'settings'`,
    );
    if (present.rows.length === 0) {
      await store.close();
      await applyMigrations(
        venueDir,
        migrationOptionsFor(
          orderedMigrationSets(ALL_MODULES.filter((m) => m.name === "core")),
          null,
        ),
      );
      store = await openVenueDatabase(venueDir);
    }
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

export async function seedModuleDocument(
  db: Database,
  doc: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`insert into settings (module, version, revision, doc, updated_at)
    values ('modules', 1, 1, ${JSON.stringify(doc)}, ${new Date().toISOString()})
    on conflict (module) do update set doc = excluded.doc, version = 1`);
}

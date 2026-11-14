import { journalHashes } from "@waitron/migrations";
import {
  readSettings,
  saveSettings,
  withTransaction,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import {
  parseModuleConfig,
  serializeModuleConfig,
  type ModuleConfig,
  type WaitronModule,
} from "@waitron/module";
import { ALL_MODULES, MODULES_SETTINGS } from "./modules.js";

export async function readModuleConfig(db: Database): Promise<ModuleConfig> {
  return parseModuleConfig((await readSettings(db, MODULES_SETTINGS)).doc, ALL_MODULES);
}

export async function writeModuleConfig(
  db: Database,
  config: ModuleConfig,
  actor: string | null,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const saved = await readSettings(tx, MODULES_SETTINGS);
    await saveSettings(tx, MODULES_SETTINGS, {
      doc: { modules: serializeModuleConfig(config) },
      expectedRevision: saved.revision,
      personId: actor,
    });
  });
}

export async function modulesForMigration(
  store: Pick<VenueDatabase, "venue" | "node">,
  available: readonly WaitronModule[],
  enabled: readonly WaitronModule[],
): Promise<readonly WaitronModule[]> {
  const selected: WaitronModule[] = [];
  for (const module of available) {
    if (
      enabled.includes(module) ||
      (module.tier === "toggleable" &&
        module.migrations &&
        (await journalHashes(store, module.migrations)) !== null)
    )
      selected.push(module);
  }
  return selected;
}

import { readSettings, saveSettings, withTransaction, type Database } from "@waitron/db";
import { parseModuleConfig, serializeModuleConfig, type ModuleConfig } from "@waitron/module";
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

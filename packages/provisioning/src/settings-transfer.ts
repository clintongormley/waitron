import {
  readSettings,
  replaceTransferredSettings,
  type Database,
  type Transaction,
  type SettingsDocument,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface TransferredSettings {
  readonly version: number;
  readonly doc: object;
}
export function transferredDocuments(
  modules: readonly WaitronModule[],
): SettingsDocument<object>[] {
  return modules
    .flatMap((module) => module.settings ?? [])
    .filter((definition) => definition.transfers);
}
export async function exportSettingsDocuments(
  db: Database | Transaction,
  modules: readonly WaitronModule[],
): Promise<Record<string, TransferredSettings>> {
  const entries: Record<string, TransferredSettings> = {};
  for (const definition of transferredDocuments(modules)) {
    const { doc, revision } = await readSettings(db, definition);
    if (revision > 0) entries[definition.module] = { version: definition.version, doc };
  }
  return entries;
}
export function checkImportedSettings(
  entries: Readonly<Record<string, TransferredSettings>>,
  modules: readonly WaitronModule[],
): Map<string, object> {
  const definitions = new Map(
    transferredDocuments(modules).map((definition) => [definition.module, definition]),
  );
  const docs = new Map<string, object>();
  for (const [key, entry] of Object.entries(entries)) {
    const definition = definitions.get(key);
    if (definition === undefined)
      throw new AppError("setup.request_invalid", { field: "settings" });
    if (entry.version > definition.version) throw new AppError("setup.configuration_newer", {});
    if (entry.version < definition.version) throw new AppError("setup.configuration_outdated", {});
    const parsed = definition.parse(entry.doc);
    if (!parsed.ok)
      throw new AppError("setup.request_invalid", { field: `settings.${key}.${parsed.field}` });
    docs.set(key, parsed.doc);
  }
  return docs;
}
export async function importSettingsDocuments(
  tx: Transaction,
  entries: Readonly<Record<string, TransferredSettings>>,
  modules: readonly WaitronModule[],
): Promise<void> {
  const docs = checkImportedSettings(entries, modules);
  await replaceTransferredSettings(tx, transferredDocuments(modules), docs);
}

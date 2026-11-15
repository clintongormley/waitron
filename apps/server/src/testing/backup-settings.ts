import { readSettings, saveSettings, type Transaction } from "@waitron/db";
import { BACKUP_SETTINGS, type StoredArchive } from "../backup-settings-document.js";

export async function storeArchivePart(tx: Transaction, archive: unknown): Promise<void> {
  const saved = await readSettings(tx, BACKUP_SETTINGS);
  await saveSettings(tx, BACKUP_SETTINGS, {
    doc: { ...saved.doc, archive: archive as StoredArchive | null },
    expectedRevision: saved.revision,
    personId: null,
  });
}

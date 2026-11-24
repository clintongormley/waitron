import { insertMasterKey, withTransaction, type Database } from "@waitron/db";
import type { MadeMasterKey, NewMasterKey } from "@waitron/provisioning";

/**
 * Writes the key's public facts, never the key, in a venue.db transaction of its own.
 * `beforeCommit` runs inside that transaction after the row, so its failure takes the row with it.
 */
export async function saveNewMasterKey(
  db: Database,
  key: NewMasterKey,
  madeAt: Date,
  madeBy: string | null,
  beforeCommit?: () => Promise<void>,
): Promise<MadeMasterKey> {
  await withTransaction(db, async (tx) => {
    await insertMasterKey(tx, {
      name: key.made.masterKeyName,
      checkValue: key.checkValue,
      publicKey: key.publicKey,
      madeAt,
      madeBy,
    });
    await beforeCommit?.();
  });
  return key.made;
}

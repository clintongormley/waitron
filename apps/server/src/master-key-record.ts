import { insertMasterKey, withTransaction, type Database } from "@waitron/db";
import type { MadeMasterKey, NewMasterKey } from "@waitron/provisioning";

/** Writes the key's public facts, never the key, in a venue.db transaction of its own. */
export async function saveNewMasterKey(
  db: Database,
  key: NewMasterKey,
  madeAt: Date,
  madeBy: string | null,
): Promise<MadeMasterKey> {
  await withTransaction(db, (tx) =>
    insertMasterKey(tx, {
      name: key.made.masterKeyName,
      checkValue: key.checkValue,
      publicKey: key.publicKey,
      madeAt,
      madeBy,
    }),
  );
  return key.made;
}

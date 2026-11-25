import { insertMasterKey, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { MadeMasterKey, NewMasterKey } from "@waitron/provisioning";

/** Writes the key's public facts, never the key. */
export async function insertNewMasterKey(
  tx: Transaction,
  key: NewMasterKey,
  madeAt: Date,
  madeBy: string | null,
): Promise<void> {
  await insertMasterKey(tx, {
    name: key.made.masterKeyName,
    checkValue: key.checkValue,
    publicKey: key.publicKey,
    madeAt,
    madeBy,
  });
}

/** {@link insertNewMasterKey} in a venue.db transaction of its own. */
export async function saveNewMasterKey(
  db: Database,
  key: NewMasterKey,
  madeAt: Date,
  madeBy: string | null,
): Promise<MadeMasterKey> {
  await withTransaction(db, (tx) => insertNewMasterKey(tx, key, madeAt, madeBy));
  return key.made;
}

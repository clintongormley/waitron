import { masterKeyMatches } from "@waitron/credentials";
import {
  insertMasterKey,
  readCurrentMasterKey,
  withTransaction,
  type Database,
  type MasterKeyRecord,
  type Transaction,
} from "@waitron/db";
import type { MadeMasterKey, NewMasterKey } from "@waitron/provisioning";
import { AppError, decodeMasterKeyCode, isAppError } from "@waitron/shared";
import "./errors.js";

/**
 * The typed key's bytes and the venue's current master key's row; `master_key.wrong`, naming that
 * key when there is one, for a wrong or malformed key or when the venue has none.
 */
export async function checkTypedMasterKey(
  db: Database | Transaction,
  typed: string,
): Promise<{ bytes: Uint8Array; current: MasterKeyRecord }> {
  const current = await readCurrentMasterKey(db);
  let bytes: Uint8Array | null = null;
  try {
    bytes = decodeMasterKeyCode(typed);
  } catch (error) {
    if (!isAppError(error)) throw error;
  }
  if (current === null || bytes === null || !masterKeyMatches(bytes, current.checkValue)) {
    throw new AppError("master_key.wrong", current === null ? {} : { keyName: current.name });
  }
  return { bytes, current };
}

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

import {
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyName,
  sealingPublicKey,
} from "@waitron/credentials";
import { insertMasterKey, withTransaction, type Database } from "@waitron/db";
import type { MadeMasterKey } from "@waitron/provisioning";
import { encodeMasterKeyCode } from "@waitron/shared";

/** A master key made in memory: what is shown once, and what its `master_keys` row keeps. */
export interface NewMasterKey {
  readonly made: MadeMasterKey;
  readonly checkValue: string;
  readonly publicKey: Buffer;
}

export function makeNewMasterKey(day: string): NewMasterKey {
  const masterKey = makeMasterKey();
  const publicKey = sealingPublicKey(masterKey);
  const name = masterKeyName(publicKey, day);
  return {
    made: { masterKey: encodeMasterKeyCode(masterKey), masterKeyName: name },
    checkValue: masterKeyCheckValue(masterKey),
    publicKey,
  };
}

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

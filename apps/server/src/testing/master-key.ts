import {
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyName,
  sealingPublicKey,
} from "@waitron/credentials";
import { insertMasterKey, withTransaction, type Database } from "@waitron/db";
import { encodeMasterKeyCode } from "@waitron/shared";

/** Writes a venue master key row and answers its printed form as `secret`. */
export async function mintMasterKey(
  venue: Database,
  options: { bytes?: Uint8Array; madeAt?: Date } = {},
): Promise<{ secret: string; name: string; number: number }> {
  const bytes = options.bytes ?? makeMasterKey();
  const madeAt = options.madeAt ?? new Date();
  const publicKey = sealingPublicKey(bytes);
  const name = masterKeyName(publicKey, madeAt.toISOString().slice(0, 10));
  const number = await withTransaction(venue, (tx) =>
    insertMasterKey(tx, {
      name,
      checkValue: masterKeyCheckValue(bytes),
      publicKey,
      madeAt,
      madeBy: null,
    }),
  );
  return { secret: encodeMasterKeyCode(bytes), name, number };
}

/** A master key that decodes but is not the venue's. */
export const WRONG_MASTER_KEY = encodeMasterKeyCode(makeMasterKey());

import { generatePassword, newBreakGlassKeyName } from "@waitron/provisioning";
import { hashSecret, verifySecretAsync } from "@waitron/identity";
import {
  readBreakGlassVerifier,
  readBreakGlassKeyName,
  readRecoveryPacks,
  setBreakGlassVerifierTx,
  withTransaction,
  type Database,
  type RecoveryPackRecord,
} from "@waitron/db";

/**
 * Stores only the secret's verifier and returns the RAW secret, which is never stored or logged.
 * Re-minting overwrites the verifier, so an earlier secret stops verifying.
 */
export async function mintBreakGlassSecret(ownerDb: Database, nodeId: string): Promise<string> {
  return (await mintBreakGlassKey(ownerDb, nodeId)).secret;
}

/** Every server key name this node's packs recorded, and the key in force. */
export function takenKeyNames(
  name: string | null,
  records: readonly RecoveryPackRecord[],
): Set<string> {
  const taken = new Set<string>(name === null ? [] : [name]);
  for (const record of records) {
    for (const part of record.parts) {
      if (part.part === "server-key" && part.keyName !== undefined) taken.add(part.keyName);
    }
  }
  return taken;
}

export async function mintBreakGlassKey(
  ownerDb: Database,
  nodeId: string,
): Promise<{ secret: string; name: string }> {
  const secret = generatePassword();
  const verifier = hashSecret(secret);
  const name = await withTransaction(ownerDb, async (tx) => {
    const previous = await readBreakGlassKeyName(tx, nodeId);
    const next = newBreakGlassKeyName(
      new Date().toISOString().slice(0, 10),
      takenKeyNames(previous, await readRecoveryPacks(tx, nodeId)),
    );
    await setBreakGlassVerifierTx(tx, nodeId, verifier, next);
    return next;
  });
  return { secret, name };
}

/** `false`, never a throw, for a node with no verifier. */
export async function verifyBreakGlass(
  appDb: Database,
  nodeId: string,
  secret: string,
): Promise<boolean> {
  const verifier = await readBreakGlassVerifier(appDb, nodeId);
  return verifier !== null && (await verifySecretAsync(secret, verifier));
}

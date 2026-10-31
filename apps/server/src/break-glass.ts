import { generatePassword, newBreakGlassKeyName } from "@waitron/provisioning";
import { hashSecret, verifySecretAsync } from "@waitron/identity";
import {
  readRecoveryPacks,
  requireStamp,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
  type RecoveryPackRecord,
  type Transaction,
} from "@waitron/db";
import { readRecoveryKeyName, readRecoveryKeyVerifier, setRecoveryKeyTx } from "@waitron/node-db";

/** The two files a recovery key touches: the venue's packs name keys, node.db holds the check. */
export interface RecoveryKeyHandles {
  readonly venue: Database;
  readonly node: NodeDatabase;
}

/**
 * Stores only the secret's verifier and returns the RAW secret, which is never stored or logged.
 * Re-minting overwrites the verifier, so an earlier secret stops verifying.
 */
export async function mintBreakGlassSecret(
  handles: RecoveryKeyHandles,
  nodeId: string,
): Promise<string> {
  return (await mintBreakGlassKey(handles, nodeId)).secret;
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

/**
 * A fresh secret, its verifier and a name no key in force or earlier pack has used. Writes
 * nothing, so a caller can save it inside its own node transaction.
 */
export async function chooseBreakGlassKey(
  venue: Database | Transaction,
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ secret: string; verifier: string; name: string }> {
  const secret = generatePassword();
  const name = newBreakGlassKeyName(
    new Date().toISOString().slice(0, 10),
    takenKeyNames(await readRecoveryKeyName(node, nodeId), await readRecoveryPacks(venue, nodeId)),
  );
  return { secret, verifier: hashSecret(secret), name };
}

/** Refuses `deployment.not_stamped` on a venue.db no environment has claimed. */
export async function mintBreakGlassKey(
  handles: RecoveryKeyHandles,
  nodeId: string,
): Promise<{ secret: string; name: string }> {
  await requireStamp(handles.venue);
  return withNodeTransaction(handles.node, async (tx) => {
    const key = await chooseBreakGlassKey(handles.venue, tx, nodeId);
    await setRecoveryKeyTx(tx, nodeId, key.verifier, key.name);
    return { secret: key.secret, name: key.name };
  });
}

/** `false`, never a throw, for a node with no verifier. */
export async function verifyBreakGlass(
  node: NodeDatabase,
  nodeId: string,
  secret: string,
): Promise<boolean> {
  const verifier = await readRecoveryKeyVerifier(node, nodeId);
  return verifier !== null && (await verifySecretAsync(secret, verifier));
}

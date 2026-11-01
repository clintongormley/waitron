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
import {
  readRecoveryKeyName,
  readRecoveryKeyVerifier,
  setRecoveryKeyTx,
  type VenueAndNodeHandles,
} from "@waitron/node-db";

/**
 * Stores only the secret's verifier and returns the RAW secret, which is never stored or logged.
 * Re-minting overwrites the verifier, so an earlier secret stops verifying.
 */
export async function mintBreakGlassSecret(
  handles: VenueAndNodeHandles,
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
 * A name no key in force or earlier pack has used. Writes nothing, so a caller can choose it and
 * save the key inside its own node transaction.
 */
export async function chooseBreakGlassKeyName(
  venue: Database | Transaction,
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<string> {
  return newBreakGlassKeyName(
    new Date().toISOString().slice(0, 10),
    takenKeyNames(await readRecoveryKeyName(node, nodeId), await readRecoveryPacks(venue, nodeId)),
  );
}

/** A fresh break-glass secret and its verifier, derived outside any transaction. */
export interface BreakGlassSecret {
  secret: string;
  verifier: string;
}

export function makeBreakGlassSecret(): BreakGlassSecret {
  const secret = generatePassword();
  return { secret, verifier: hashSecret(secret) };
}

/** Saves `made`'s verifier under a fresh key name inside the caller's node transaction. */
export async function mintBreakGlassKeyTx(
  venue: Database | Transaction,
  tx: NodeTransaction,
  nodeId: string,
  made: BreakGlassSecret,
): Promise<{ secret: string; name: string }> {
  const name = await chooseBreakGlassKeyName(venue, tx, nodeId);
  await setRecoveryKeyTx(tx, nodeId, made.verifier, name);
  return { secret: made.secret, name };
}

/** Refuses `deployment.not_stamped` on a venue.db no environment has claimed. */
export async function mintBreakGlassKey(
  handles: VenueAndNodeHandles,
  nodeId: string,
): Promise<{ secret: string; name: string }> {
  await requireStamp(handles.venue);
  const made = makeBreakGlassSecret();
  return withNodeTransaction(handles.node, (tx) =>
    mintBreakGlassKeyTx(handles.venue, tx, nodeId, made),
  );
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

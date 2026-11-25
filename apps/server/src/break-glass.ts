import { generatePassword, newBreakGlassKeyName } from "@waitron/provisioning";
import { hashSecretAsync } from "@waitron/identity";
import {
  requireStamp,
  withNodeTransaction,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { readRecoveryKeyName, setRecoveryKeyTx, type VenueAndNodeHandles } from "@waitron/node-db";

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

/** The name of the key in force, if any. */
export function takenKeyNames(name: string | null): Set<string> {
  return new Set<string>(name === null ? [] : [name]);
}

/**
 * A name the key in force does not use. Writes nothing, so a caller can choose it and save the key
 * inside its own node transaction.
 */
export async function chooseBreakGlassKeyName(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<string> {
  return newBreakGlassKeyName(
    new Date().toISOString().slice(0, 10),
    takenKeyNames(await readRecoveryKeyName(node, nodeId)),
  );
}

/** A fresh break-glass secret and its verifier, derived outside any transaction. */
export interface BreakGlassSecret {
  secret: string;
  verifier: string;
}

export async function makeBreakGlassSecret(): Promise<BreakGlassSecret> {
  const secret = generatePassword();
  return { secret, verifier: await hashSecretAsync(secret) };
}

/** Saves `made`'s verifier under a fresh key name inside the caller's node transaction. */
async function mintBreakGlassKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  made: BreakGlassSecret,
): Promise<{ secret: string; name: string }> {
  const name = await chooseBreakGlassKeyName(tx, nodeId);
  await setRecoveryKeyTx(tx, nodeId, made.verifier, name, null);
  return { secret: made.secret, name };
}

/** Refuses `deployment.not_stamped` on a venue.db no environment has claimed. */
export async function mintBreakGlassKey(
  handles: VenueAndNodeHandles,
  nodeId: string,
): Promise<{ secret: string; name: string }> {
  await requireStamp(handles.venue);
  const made = await makeBreakGlassSecret();
  return withNodeTransaction(handles.node, (tx) => mintBreakGlassKeyTx(tx, nodeId, made));
}

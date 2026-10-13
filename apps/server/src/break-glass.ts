import { randomBytes } from "node:crypto";
import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecretAsync } from "@waitron/identity";
import {
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  withTransaction,
  type Database,
} from "@waitron/db";

/**
 * Stores only the secret's verifier and returns the RAW secret, which is never stored or logged.
 * Re-minting overwrites the verifier, so an earlier secret stops verifying.
 */
export async function mintBreakGlassSecret(ownerDb: Database, nodeId: string): Promise<string> {
  return (await mintBreakGlassKey(ownerDb, nodeId)).secret;
}

export async function mintBreakGlassKey(
  ownerDb: Database,
  nodeId: string,
): Promise<{ secret: string; name: string }> {
  const secret = generatePassword();
  const name = `Recovery key ${randomBytes(12).toString("base64url")}`;
  const verifier = hashSecret(secret);
  await withTransaction(ownerDb, (tx) => setBreakGlassVerifierTx(tx, nodeId, verifier, name));
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

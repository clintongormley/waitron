import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecret } from "@waitron/identity";
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
  const secret = generatePassword();
  const verifier = hashSecret(secret);
  await withTransaction(ownerDb, (tx) => setBreakGlassVerifierTx(tx, nodeId, verifier));
  return secret;
}

/** `false`, never a throw, for a node with no verifier. */
export async function verifyBreakGlass(
  appDb: Database,
  nodeId: string,
  secret: string,
): Promise<boolean> {
  const verifier = await readBreakGlassVerifier(appDb, nodeId);
  return verifier !== null && verifySecret(secret, verifier);
}

import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecret } from "@waitron/identity";
import {
  readBreakGlassVerifier,
  setBreakGlassVerifierTx,
  withTransaction,
  type Database,
} from "@waitron/db";

// The offline break-glass secret: minted once at adopt, verified later by the promote endpoint.
// Only the scrypt verifier is ever persisted (this node's `node_roles` row); the raw secret is returned
// exactly once and never stored or logged.

/**
 * Generates a high-entropy break-glass secret, stores only its scrypt verifier, and returns the RAW
 * secret exactly once. Re-minting overwrites the verifier, so any previously issued secret stops
 * verifying. The caller surfaces the return value to the operator once; it is never logged.
 */
export async function mintBreakGlassSecret(ownerDb: Database, nodeId: string): Promise<string> {
  const secret = generatePassword();
  const verifier = hashSecret(secret);
  await withTransaction(ownerDb, (tx) => setBreakGlassVerifierTx(tx, nodeId, verifier));
  return secret;
}

/**
 * Reads the stored verifier and checks `secret` against it. Returns `false` when no verifier is set
 * (an unminted node), never throwing on the missing-value path.
 */
export async function verifyBreakGlass(
  appDb: Database,
  nodeId: string,
  secret: string,
): Promise<boolean> {
  const verifier = await readBreakGlassVerifier(appDb, nodeId);
  return verifier !== null && verifySecret(secret, verifier);
}

import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecret } from "@waitron/identity";
import { readBreakGlassVerifier, setBreakGlassVerifierTx, type Database } from "@waitron/db";

// The offline break-glass secret: minted once at adopt on the owner connection, verified later by the
// promote endpoint on the app pool. Only the scrypt verifier is ever persisted (deployment
// singleton); the raw secret is returned exactly once and never stored or logged.

/**
 * Generates a high-entropy break-glass secret, stores only its scrypt verifier via the OWNER pool
 * (`app_user` holds no UPDATE on `deployment`), and returns the RAW secret exactly once. Re-minting
 * overwrites the verifier, so any previously issued secret stops verifying. The caller surfaces the
 * return value to the operator once; it is never logged.
 */
export async function mintBreakGlassSecret(ownerDb: Database): Promise<string> {
  const secret = generatePassword();
  const verifier = hashSecret(secret);
  await ownerDb.transaction((tx) => setBreakGlassVerifierTx(tx, verifier));
  return secret;
}

/**
 * Reads the stored verifier via the APP pool and checks `secret` against it. Returns `false` when no
 * verifier is set (an unminted node), never throwing on the missing-value path.
 */
export async function verifyBreakGlass(appDb: Database, secret: string): Promise<boolean> {
  const verifier = await readBreakGlassVerifier(appDb);
  return verifier !== null && verifySecret(secret, verifier);
}

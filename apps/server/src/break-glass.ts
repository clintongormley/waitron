import { randomInt } from "node:crypto";
import { generatePassword } from "@waitron/provisioning";
import { hashSecret, verifySecretAsync } from "@waitron/identity";
import {
  readBreakGlassVerifier,
  readBreakGlassKeyName,
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
  const verifier = hashSecret(secret);
  const name = await withTransaction(ownerDb, async (tx) => {
    const previous = await readBreakGlassKeyName(tx, nodeId);
    const day = new Date().toISOString().slice(0, 10);
    const alphabet = "34679ACDEFHJKMNPQRTUVWXY";
    let next: string;
    do {
      const code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
      next = `${day} · ${code}`;
    } while (next === previous);
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

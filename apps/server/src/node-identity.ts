import { generateNodeKeyPair } from "@waitron/membership";
import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { setNodePublicKeyTx, withTransaction, type Database } from "@waitron/db";
import "./errors.js";

/** The credentials-vault purpose for the node's Ed25519 membership private key. */
export const NODE_KEY_PURPOSE = "membership.node_key";

/**
 * Seal the node's Ed25519 private key in the box vault and stamp the public half on
 * `nodes.public_key`, the trust anchor `readMembershipTrustSet` reads, in one transaction: the two
 * halves must land together or not at all. The handle is named `ownerDb` because `nodes` is
 * one of the tables `scripts/write-path-tables.json` lists, which request code may read and never
 * write; nothing in the engine enforces that.
 */
export interface EstablishIdentityDeps {
  ownerDb: Database;
  ring: KeyRing;
}

export async function establishNodeIdentity(
  deps: EstablishIdentityDeps,
  nodeId: string,
): Promise<void> {
  const { publicKey, privateKey } = generateNodeKeyPair();
  await withTransaction(deps.ownerDb, async (tx) => {
    await putCredential(tx, deps.ring, {
      purpose: NODE_KEY_PURPOSE,
      value: { privateKey },
    });
    await setNodePublicKeyTx(tx, nodeId, publicKey);
  });
}

/** Unseal the node's identity private key (base64 PKCS8). */
export function readNodeIdentityKey(appDb: Database, ring: KeyRing): Promise<string> {
  return withTransaction(appDb, async (tx) => {
    const c = await getCredential(tx, ring, { purpose: NODE_KEY_PURPOSE });
    return c.privateKey as string;
  });
}

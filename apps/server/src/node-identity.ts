import { eq } from "drizzle-orm";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  nodeSigningPublicKey,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
  type KeyRing,
} from "@waitron/credentials";
import {
  nodes,
  setNodePublicKeyTx,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";

export const NODE_KEY_PURPOSE = "membership.node_key";

/**
 * The handle is named `ownerDb` because `nodes` is one of the tables
 * `scripts/write-path-tables.json` lists, which request code may read and never write; nothing in
 * the engine enforces that.
 */
export interface EstablishIdentityDeps {
  ownerDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
}

/**
 * Give the node its Ed25519 identity: reuse the private key `node.db` holds for `nodeId`, or
 * generate and seal one, then stamp its public half on `nodes.public_key`, the trust anchor
 * `readMembershipTrustSet` reads. A re-run after an interruption between the two saves stamps the
 * key already sealed. Run it only after the node's row exists: `setNodePublicKeyTx` is an update
 * with no row-count check, so an early call seals the key and stamps nothing, without error.
 */
export async function establishNodeIdentity(
  deps: EstablishIdentityDeps,
  nodeId: string,
): Promise<void> {
  // node.db is saved before venue.db, as everywhere a signing key is first made (here, first setup
  // and adopt): a stamped public key with no private key behind it could never sign as this box.
  const privateKey = await withNodeTransaction(deps.node, async (tx) => {
    const sealed = await readNodeSigningKey(tx, deps.ring, nodeId);
    if (sealed !== null) return sealed;
    const generated = generateNodeKeyPair().privateKey;
    await sealNodeSigningKeyTx(tx, deps.ring, nodeId, generated);
    return generated;
  });
  const publicKey = nodeSigningPublicKey(privateKey);
  await withTransaction(deps.ownerDb, async (tx) => {
    const [row] = await tx
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, nodeId));
    // Only a fault in Waitron produces this: the venue names a key this box never sealed.
    if (row?.publicKey != null && row.publicKey !== publicKey)
      throw new AppError("node.identity_mismatch", {});
    await setNodePublicKeyTx(tx, nodeId, publicKey);
  });
}

/** Unseal the node's identity private key (base64 PKCS8). */
export async function readNodeIdentityKey(
  node: NodeDatabase,
  ring: KeyRing,
  nodeId: string,
): Promise<string> {
  let privateKey: string | null;
  try {
    privateKey = await readNodeSigningKey(node, ring, nodeId);
  } catch (error) {
    if (isAppError(error) && error.code === "credentials.malformed_payload")
      throw new AppError("server.credential_unusable", {
        purpose: NODE_KEY_PURPOSE,
        field: "privateKey",
      });
    throw error;
  }
  if (privateKey === null) throw new AppError("credentials.missing", { purpose: NODE_KEY_PURPOSE });
  return privateKey;
}

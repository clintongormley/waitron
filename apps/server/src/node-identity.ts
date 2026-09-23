import { generateNodeKeyPair } from "@waitron/membership";
import { getCredential, putCredential, type KeyRing } from "@waitron/credentials";
import { setNodePublicKeyTx, withTransaction, type Database } from "@waitron/db";
import "./errors.js";

/** The credentials-vault purpose for the node's Ed25519 membership private key. Single source of truth. */
export const NODE_KEY_PURPOSE = "membership.node_key";

/**
 * Establish this node's membership identity (design §4) at setup: generate an Ed25519 keypair, then in
 * ONE tenant transaction seal the PRIVATE half in the box vault under `membership.node_key` and stamp
 * the PUBLIC half on `nodes.public_key` — the trust anchor boot reads (readMembershipTrustSet). Called
 * ONLY on the fresh-primary provision path (setup-api provision handler, beside the provisioning-secret seal): a cloud
 * mirror runs as the primary's nodeId and never signs, so it seals no key. Its anchor would be the
 * primary's `nodes` row — nothing carries that row to a mirror today (`mirror-bundle.ts`'s header).
 *
 * The deployment holds one tenant per database. The seal and the stamp are ONE logical change —
 * the private key and its matching public key must land together or not at all — so they share a
 * single `withTransaction` (CLAUDE.md §3: `withTransaction` IS that transaction; nothing non-DB sits
 * between them to force a split). The handle is named `ownerDb` because the `nodes` stamp belongs on
 * the owner path: `nodes` is one of the four tables a request path may read and never write. That
 * used to be enforced by the database — the application role held SELECT on `nodes` and nothing
 * more. It is not enforced by anything in the engine now: there are no roles and no grants, and
 * `ownerDb` and the app handle are the SAME handle at runtime. What keeps this write in a named
 * file is `scripts/write-path-tables.test.ts`, which reads the tree as text. Runs AFTER provisionVenue mints the node row the stamp updates.
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

/**
 * Unseal the node's identity PRIVATE key (base64 PKCS8) under `withTransaction`. The
 * Slice-5 signer's entry point (mint + sign a membership document); exercised now by the establish
 * round-trip. Throws `credentials.decrypt_failed` (a key
 * sealed under a different box key) or `credentials.missing` (never established).
 */
export function readNodeIdentityKey(appDb: Database, ring: KeyRing): Promise<string> {
  return withTransaction(appDb, async (tx) => {
    const c = await getCredential(tx, ring, { purpose: NODE_KEY_PURPOSE });
    return c.privateKey as string;
  });
}

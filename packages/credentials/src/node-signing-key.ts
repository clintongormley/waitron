import { createPrivateKey, createPublicKey } from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import {
  readMembershipTrustSet,
  readNodePublicKeyTx,
  setNodePublicKeyTx,
  tableExists,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { generateNodeKeyPair, type TrustSet } from "@waitron/membership";
import { box, writeBoxSigningKeyTx } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { aadFor, openSealedRow, seal, type SealedRow } from "./cipher.js";
import type { KeyRing } from "./keyring.js";
import "./errors.js";

const PURPOSE = "membership.node_key";

/** The node id is bound in, so a row copied under another node's id does not open. */
function aadForNode(nodeId: string): Buffer {
  return aadFor(`${PURPOSE}/${nodeId}`);
}

/** A sealed signing-key row as any reader holds it: a live `node.db` or a backup's node copy. */
export interface SealedSigningKeyRow extends SealedRow {
  keyVersion: number;
}

/** Upserts this node's private signing key (base64 PKCS8), sealed on the ring's current key. */
export async function sealNodeSigningKeyTx(
  tx: NodeTransaction,
  ring: KeyRing,
  nodeId: string,
  privateKey: string,
): Promise<void> {
  const sealed = seal(ring.current.key, aadForNode(nodeId), JSON.stringify({ privateKey }));
  const values = {
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    keyVersion: ring.current.version,
  };
  await writeBoxSigningKeyTx(tx, nodeId, values);
}

/**
 * Opens one sealed row for `nodeId`. Throws `credentials.key_version_unknown` when the ring lacks
 * the row's key, `credentials.decrypt_failed` when it does not open, and
 * `credentials.malformed_payload` when it opens without a non-empty `privateKey`; never echoes the
 * plaintext.
 */
export function openNodeSigningKeyRow(
  row: SealedSigningKeyRow,
  ring: KeyRing,
  nodeId: string,
): string {
  const plaintext = openSealedRow(ring, PURPOSE, aadForNode(nodeId), row);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AppError("credentials.malformed_payload", { purpose: PURPOSE });
  }
  const privateKey =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { privateKey?: unknown }).privateKey
      : undefined;
  if (typeof privateKey !== "string" || privateKey === "") {
    throw new AppError("credentials.malformed_payload", { purpose: PURPOSE });
  }
  return privateKey;
}

async function readRow(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<SealedSigningKeyRow | null> {
  const [row] = await node
    .select({
      ciphertext: box.signingKeyCiphertext,
      iv: box.signingKeyIv,
      authTag: box.signingKeyAuthTag,
      keyVersion: box.signingKeyVersion,
    })
    .from(box)
    .where(eq(box.nodeId, nodeId));
  return row?.ciphertext == null ? null : { ciphertext: row.ciphertext, iv: row.iv!, authTag: row.authTag!, keyVersion: row.keyVersion! };
}

/** This node's private signing key, or `null` when the table has no row for that node id; a row
 * that will not open throws as {@link openNodeSigningKeyRow} does. */
export async function readNodeSigningKey(
  node: NodeDatabase | NodeTransaction,
  ring: KeyRing,
  nodeId: string,
): Promise<string | null> {
  const row = await readRow(node, nodeId);
  return row === null ? null : openNodeSigningKeyRow({ ciphertext: row.ciphertext!, iv: row.iv!, authTag: row.authTag!, keyVersion: row.keyVersion! }, ring, nodeId);
}

/**
 * Give the box its signing key: reuse the private key `node.db` holds for `nodeId`, or make and
 * seal one, then stamp its public half on `nodes.public_key`, the trust anchor
 * `readMembershipTrustSet` reads. A re-run after an interruption between the two saves stamps the
 * key already sealed. Refuses `node.identity_mismatch` when the venue already names a different
 * key. Run it only after the node's row exists: `setNodePublicKeyTx` is an update with no
 * row-count check, so an early call seals the key and stamps nothing, without error.
 *
 * `ownerDb` is named so because `nodes` is one of the tables `scripts/write-path-tables.json` lists.
 */
export async function establishNodeSigningKey(
  ownerDb: Database,
  node: NodeDatabase,
  ring: KeyRing,
  nodeId: string,
): Promise<void> {
  // node.db is saved before venue.db: a stamped public key with no private key behind it could
  // never sign as this box.
  const privateKey = await withNodeTransaction(node, async (tx) => {
    const sealed = await readNodeSigningKey(tx, ring, nodeId);
    if (sealed !== null) return sealed;
    const generated = generateNodeKeyPair().privateKey;
    await sealNodeSigningKeyTx(tx, ring, nodeId, generated);
    return generated;
  });
  const publicKey = nodeSigningPublicKey(privateKey);
  await withTransaction(ownerDb, async (tx) => {
    const stamped = await readNodePublicKeyTx(tx, nodeId);
    // Only a fault in Waitron produces this: the venue names a key this box never sealed.
    if (stamped !== null && stamped !== publicKey) throw new AppError("node.identity_mismatch", {});
    await setNodePublicKeyTx(tx, nodeId, publicKey);
  });
}

/** The venue's membership trust set beside this box's private signing key (`null` when none is
 * sealed for `nodeId`). */
export async function readNodeIdentity(
  ownerDb: Database,
  node: NodeDatabase,
  ring: KeyRing,
  nodeId: string,
): Promise<{ trust: TrustSet; privateKey: string | null }> {
  return {
    trust: await readMembershipTrustSet(ownerDb),
    privateKey: await readNodeSigningKey(node, ring, nodeId),
  };
}

/** The base64 SPKI public half of a base64 PKCS8 private key. */
export function nodeSigningPublicKey(privateKey: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");
}

/**
 * Re-seals, inside `tx`, every signing-key row not on the ring's current key, each under its own
 * node id. Returns how many it re-sealed and how many were already current.
 */
export async function rotateNodeSigningKeysTx(
  tx: NodeTransaction,
  ring: KeyRing,
): Promise<{ rotated: number; alreadyCurrent: number }> {
  const result = { rotated: 0, alreadyCurrent: 0 };
  // `waitron-credentials rotate` opens node.db without migrating it; a node.db no start has
  // migrated yet has nothing to re-seal.
  if (!(await tableExists(tx, "box"))) return result;
  // Every row, not only this box's: a re-key must leave nothing on the old key, and each row still
  // opens only under its own node id.
  const rows = await tx
    .select({
      nodeId: box.nodeId,
      ciphertext: box.signingKeyCiphertext,
      iv: box.signingKeyIv,
      authTag: box.signingKeyAuthTag,
      keyVersion: box.signingKeyVersion,
    })
    .from(box)
    .where(isNotNull(box.signingKeyCiphertext));
  for (const { nodeId, ...row } of rows) {
    if (row.keyVersion === ring.current.version) {
      result.alreadyCurrent += 1;
      continue;
    }
    await sealNodeSigningKeyTx(tx, ring, nodeId, openNodeSigningKeyRow({ ciphertext: row.ciphertext!, iv: row.iv!, authTag: row.authTag!, keyVersion: row.keyVersion! }, ring, nodeId));
    result.rotated += 1;
  }
  return result;
}

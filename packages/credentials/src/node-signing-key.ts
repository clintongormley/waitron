import { createPrivateKey, createPublicKey } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  now,
  tableExists,
  withNodeTransaction,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { nodeSigningKey } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { aadFor, open, seal, type SealedRow } from "./cipher.js";
import { keyForVersion, type KeyRing } from "./keyring.js";
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
  await tx
    .insert(nodeSigningKey)
    .values({ nodeId, ...values })
    .onConflictDoUpdate({
      target: nodeSigningKey.nodeId,
      set: { ...values, updatedAt: now() },
    });
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
  const key = keyForVersion(ring, row.keyVersion);
  if (key === null) {
    throw new AppError("credentials.key_version_unknown", {
      purpose: PURPOSE,
      keyVersion: row.keyVersion,
    });
  }
  const plaintext = open(key, aadForNode(nodeId), row);
  if (plaintext === null) throw new AppError("credentials.decrypt_failed", { purpose: PURPOSE });
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
  if (!(await tableExists(node, "node_signing_key"))) return null;
  const [row] = await node
    .select({
      ciphertext: nodeSigningKey.ciphertext,
      iv: nodeSigningKey.iv,
      authTag: nodeSigningKey.authTag,
      keyVersion: nodeSigningKey.keyVersion,
    })
    .from(nodeSigningKey)
    .where(eq(nodeSigningKey.nodeId, nodeId));
  return row ?? null;
}

/** This node's private signing key, or `null` only when it has no row; a row that will not open
 * throws as {@link openNodeSigningKeyRow} does. */
export async function readNodeSigningKey(
  node: NodeDatabase | NodeTransaction,
  ring: KeyRing,
  nodeId: string,
): Promise<string | null> {
  const row = await readRow(node, nodeId);
  return row === null ? null : openNodeSigningKeyRow(row, ring, nodeId);
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
 * Re-seals every signing-key row not on the ring's current key, each under its own node id, one
 * node transaction per row. Returns how many it re-sealed and how many were already current.
 */
export async function rotateNodeSigningKeys(
  node: NodeDatabase,
  ring: KeyRing,
): Promise<{ rotated: number; alreadyCurrent: number }> {
  const result = { rotated: 0, alreadyCurrent: 0 };
  if (!(await tableExists(node, "node_signing_key"))) return result;
  const rows = await node
    .select({ nodeId: nodeSigningKey.nodeId, keyVersion: nodeSigningKey.keyVersion })
    .from(nodeSigningKey);
  for (const { nodeId, keyVersion } of rows) {
    if (keyVersion === ring.current.version) {
      result.alreadyCurrent += 1;
      continue;
    }
    await withNodeTransaction(node, async (tx) => {
      const privateKey = await readNodeSigningKey(tx, ring, nodeId);
      if (privateKey === null) return;
      await sealNodeSigningKeyTx(tx, ring, nodeId, privateKey);
      result.rotated += 1;
    });
  }
  return result;
}

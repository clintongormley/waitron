import { eq, ne } from "drizzle-orm";
import {
  now,
  tableExists,
  withNodeTransaction,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { nodePairLink, type PairLink, type PairLinkState } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { aadFor, open, seal } from "./cipher.js";
import { keyForVersion, type KeyRing } from "./keyring.js";
import "./errors.js";

const PURPOSE = "node.pair_secret";

/** Both boxes' ids are bound in, so a row copied under another box's id, or naming another peer,
 * does not open. */
function aadForPair(nodeId: string, peerNodeId: string): Buffer {
  return aadFor(`${PURPOSE}/${nodeId}/${peerNodeId}`);
}

/** What a writer gives for this box's pair link: the reader's fields, and the store's secret key. */
export type NewPairLink = Omit<PairLink, "ringVersion" | "createdAt" | "updatedAt"> & {
  secretAccessKey: string;
};

/**
 * Upserts this node's pair link with its secret key sealed on the ring's current key, and records
 * that key's version as the ring handed to the spare. A second write is a new pairing, so it
 * replaces the whole row, start time included.
 */
export async function writePairLinkTx(
  tx: NodeTransaction,
  ring: KeyRing,
  nodeId: string,
  link: NewPairLink,
): Promise<void> {
  const { secretAccessKey, ...fields } = link;
  const sealed = seal(ring.current.key, aadForPair(nodeId, link.peerNodeId), secretAccessKey);
  const values = {
    ...fields,
    secretCiphertext: sealed.ciphertext,
    secretIv: sealed.iv,
    secretAuthTag: sealed.authTag,
    keyVersion: ring.current.version,
    ringVersion: ring.current.version,
  };
  const at = now();
  await tx
    .insert(nodePairLink)
    .values({ nodeId, ...values, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: nodePairLink.nodeId,
      set: { ...values, createdAt: at, updatedAt: at },
    });
}

async function readSealedRow(node: NodeDatabase | NodeTransaction, nodeId: string) {
  const [row] = await node
    .select({
      peerNodeId: nodePairLink.peerNodeId,
      ciphertext: nodePairLink.secretCiphertext,
      iv: nodePairLink.secretIv,
      authTag: nodePairLink.secretAuthTag,
      keyVersion: nodePairLink.keyVersion,
    })
    .from(nodePairLink)
    .where(eq(nodePairLink.nodeId, nodeId));
  return row ?? null;
}

function openSecret(
  row: NonNullable<Awaited<ReturnType<typeof readSealedRow>>>,
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
  const secret = open(key, aadForPair(nodeId, row.peerNodeId), row);
  if (secret === null) throw new AppError("credentials.decrypt_failed", { purpose: PURPOSE });
  return secret;
}

/**
 * The store's secret key from this node's pair link. Throws `credentials.missing` when the node has
 * no link, `credentials.key_version_unknown` when the ring lacks the sealing key, and
 * `credentials.decrypt_failed` when it does not open; never echoes the secret.
 */
export async function readPairSecret(
  node: NodeDatabase | NodeTransaction,
  ring: KeyRing,
  nodeId: string,
): Promise<string> {
  const row = await readSealedRow(node, nodeId);
  if (row === null) throw new AppError("credentials.missing", { purpose: PURPOSE });
  return openSecret(row, ring, nodeId);
}

/**
 * Re-seals every pair link's secret not on the ring's current key, each under its own two node
 * ids, one node transaction per row. Only the secret and its key version change: the ring version
 * records what the spare was handed, and the start time is the pairing's. Returns how many it
 * re-sealed and how many were already current.
 */
export async function rotateNodePairLinks(
  node: NodeDatabase,
  ring: KeyRing,
): Promise<{ rotated: number; alreadyCurrent: number }> {
  const result = { rotated: 0, alreadyCurrent: 0 };
  // As `rotateNodeSigningKeys`: a node.db no start has migrated yet has nothing to re-seal.
  if (!(await tableExists(node, "node_pair_link"))) return result;
  const rows = await node
    .select({ nodeId: nodePairLink.nodeId, keyVersion: nodePairLink.keyVersion })
    .from(nodePairLink);
  for (const { nodeId, keyVersion } of rows) {
    if (keyVersion === ring.current.version) {
      result.alreadyCurrent += 1;
      continue;
    }
    await withNodeTransaction(node, async (tx) => {
      const row = await readSealedRow(tx, nodeId);
      if (row === null) return;
      const secret = openSecret(row, ring, nodeId);
      const sealed = seal(ring.current.key, aadForPair(nodeId, row.peerNodeId), secret);
      await tx
        .update(nodePairLink)
        .set({
          secretCiphertext: sealed.ciphertext,
          secretIv: sealed.iv,
          secretAuthTag: sealed.authTag,
          keyVersion: ring.current.version,
          updatedAt: now(),
        })
        .where(eq(nodePairLink.nodeId, nodeId));
      result.rotated += 1;
    });
  }
  return result;
}

/** Moves this node's pair link to `state`; the table's check refuses a state outside its role. */
export async function setPairLinkStateTx(
  tx: NodeTransaction,
  nodeId: string,
  state: PairLinkState,
): Promise<void> {
  await tx
    .update(nodePairLink)
    .set({ state, updatedAt: now() })
    .where(eq(nodePairLink.nodeId, nodeId));
}

/** Deletes this node's pair link. */
export async function deletePairLinkTx(tx: NodeTransaction, nodeId: string): Promise<void> {
  await tx.delete(nodePairLink).where(eq(nodePairLink.nodeId, nodeId));
}

/** Deletes every row of this table keyed by a node id other than `nodeId`, and keeps its own. */
export async function deleteNodePairLinkOtherThanTx(
  tx: NodeTransaction,
  nodeId: string,
): Promise<void> {
  await tx.delete(nodePairLink).where(ne(nodePairLink.nodeId, nodeId));
}

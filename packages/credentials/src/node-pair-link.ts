import { eq, ne } from "drizzle-orm";
import { now, tableExists, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import {
  nodePairLink,
  type PairLink,
  type PairLinkRole,
  type PairLinkState,
} from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { aadFor, openSealedRow, seal } from "./cipher.js";
import type { KeyRing } from "./keyring.js";
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
  return openSealedRow(ring, PURPOSE, aadForPair(nodeId, row.peerNodeId), row);
}

/** The role of a pair link `node` holds under any node id, or null when it holds none. */
export async function heldPairLinkRole(
  node: NodeDatabase | NodeTransaction,
): Promise<PairLinkRole | null> {
  if (!(await tableExists(node, "node_pair_link"))) return null;
  const [row] = await node.select({ role: nodePairLink.role }).from(nodePairLink).limit(1);
  return row?.role ?? null;
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

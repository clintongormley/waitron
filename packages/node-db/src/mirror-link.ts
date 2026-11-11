import { eq, ne } from "drizzle-orm";
import { now, withNodeTransaction, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { nodeMirrorLink } from "./schema/node-mirror-link.js";

/**
 * A mirror's non-secret link to its box: where it dials to reach the box and how it trusts the
 * box's TLS. `originNodeId` is the PRIMARY this mirror was adopted from, never this node's own id.
 * `originUrl` is stored in the `relay_url` column.
 */
export interface MirrorConnection {
  originUrl: string;
  boxHostname: string;
  boxCaPem: string;
  originNodeId: string;
}

/** This node's mirror link, or `null` when this node has no row: nothing has adopted it as a mirror. */
export async function readMirrorLink(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<MirrorConnection | null> {
  const [row] = await node
    .select({
      originUrl: nodeMirrorLink.relayUrl,
      boxHostname: nodeMirrorLink.boxHostname,
      boxCaPem: nodeMirrorLink.boxCaPem,
      originNodeId: nodeMirrorLink.originNodeId,
    })
    .from(nodeMirrorLink)
    .where(eq(nodeMirrorLink.nodeId, nodeId));
  return row ?? null;
}

/** Writes this node's mirror link on its own node transaction; see {@link writeMirrorLinkTx}. */
export async function writeMirrorLink(
  node: NodeDatabase,
  nodeId: string,
  link: MirrorConnection,
): Promise<void> {
  await withNodeTransaction(node, (tx) => writeMirrorLinkTx(tx, nodeId, link));
}

/**
 * Upserts this node's mirror link on a caller's node transaction. A second write for the same node
 * replaces its row.
 */
export async function writeMirrorLinkTx(
  tx: NodeTransaction,
  nodeId: string,
  link: MirrorConnection,
): Promise<void> {
  const { originUrl, ...rest } = link;
  const values = { ...rest, relayUrl: originUrl };
  await tx
    .insert(nodeMirrorLink)
    .values({ nodeId, ...values })
    .onConflictDoUpdate({
      target: nodeMirrorLink.nodeId,
      set: { ...values, adoptedAt: now() },
    });
}

/** Deletes every row of this table keyed by a node id other than `nodeId`, and keeps its own. */
export async function deleteNodeMirrorLinkOtherThanTx(
  tx: NodeTransaction,
  nodeId: string,
): Promise<void> {
  await tx.delete(nodeMirrorLink).where(ne(nodeMirrorLink.nodeId, nodeId));
}

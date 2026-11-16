import { eq } from "drizzle-orm";
import { withNodeTransaction, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { box } from "./schema/box.js";
import { writeBoxMirrorLinkTx } from "./box.js";

/**
 * A mirror's non-secret link to its box: where it dials to reach the box and how it trusts the
 * box's TLS. `originNodeId` is the PRIMARY this mirror was adopted from, never this node's own id.
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
      originUrl: box.mirrorOriginUrl,
      boxHostname: box.mirrorBoxHostname,
      boxCaPem: box.mirrorBoxCaPem,
      originNodeId: box.mirrorOriginNodeId,
    })
    .from(box)
    .where(eq(box.nodeId, nodeId));
  return row?.originUrl == null ? null : { originUrl: row.originUrl, boxHostname: row.boxHostname!, boxCaPem: row.boxCaPem!, originNodeId: row.originNodeId! };
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
  await writeBoxMirrorLinkTx(tx, nodeId, link);
}

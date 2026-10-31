import { eq } from "drizzle-orm";
import {
  now,
  tableExists,
  withNodeTransaction,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { nodeMirrorLink } from "./schema/node-mirror-link.js";

/**
 * A mirror's non-secret link to its box: where it dials to reach the box and how it trusts the
 * box's TLS. `originNodeId` is the PRIMARY this mirror was adopted from, never this node's own id.
 */
export interface MirrorConnection {
  relayUrl: string;
  boxHostname: string;
  boxCaPem: string;
  originNodeId: string;
}

/**
 * This node's mirror link, or `null` when the table is absent or this node has no row. Callers must
 * not tell those two apart: both mean nothing has adopted this node as a mirror.
 */
export async function readMirrorLink(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<MirrorConnection | null> {
  if (!(await tableExists(node, "node_mirror_link"))) return null;
  const [row] = await node
    .select({
      relayUrl: nodeMirrorLink.relayUrl,
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
 * Upserts this node's mirror link on a caller's node transaction. Re-adopting overwrites it in
 * place: a box can legitimately move relays or rotate its CA.
 */
export async function writeMirrorLinkTx(
  tx: NodeTransaction,
  nodeId: string,
  link: MirrorConnection,
): Promise<void> {
  await tx
    .insert(nodeMirrorLink)
    .values({ nodeId, ...link })
    .onConflictDoUpdate({
      target: nodeMirrorLink.nodeId,
      set: { ...link, adoptedAt: now() },
    });
}

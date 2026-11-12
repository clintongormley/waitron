import { eq } from "drizzle-orm";
import type { NodeDatabase, NodeTransaction } from "@waitron/db";
import { nodePairLink } from "./schema/node-pair-link.js";

export type PairLinkRole = "streams" | "serves";
export type PairLinkState = "pending" | "streaming" | "awaiting_copy" | "copied";

/** This box's link to the other box of its pair, without the store's secret key. */
export interface PairLink {
  role: PairLinkRole;
  state: PairLinkState;
  peerNodeId: string;
  peerPublicKey: string;
  storeUrl: string;
  venueId: string;
  accessKeyId: string;
  ringVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** This node's pair link, or `null` when it has none. */
export async function readPairLink(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<PairLink | null> {
  const [row] = await node
    .select({
      role: nodePairLink.role,
      state: nodePairLink.state,
      peerNodeId: nodePairLink.peerNodeId,
      peerPublicKey: nodePairLink.peerPublicKey,
      storeUrl: nodePairLink.storeUrl,
      venueId: nodePairLink.venueId,
      accessKeyId: nodePairLink.accessKeyId,
      ringVersion: nodePairLink.ringVersion,
      createdAt: nodePairLink.createdAt,
      updatedAt: nodePairLink.updatedAt,
    })
    .from(nodePairLink)
    .where(eq(nodePairLink.nodeId, nodeId));
  return row ?? null;
}

import { eq } from "drizzle-orm";
import { now, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { nodePrimaryKey } from "./schema/node-primary-key.js";

export interface PinnedPrimaryKey {
  primaryNodeId: string;
  publicKey: string;
}

/** The main box's key this node pinned, or `null` when the table holds none for it. */
export async function readPinnedPrimaryKey(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<PinnedPrimaryKey | null> {
  const [row] = await node
    .select({ primaryNodeId: nodePrimaryKey.primaryNodeId, publicKey: nodePrimaryKey.publicKey })
    .from(nodePrimaryKey)
    .where(eq(nodePrimaryKey.nodeId, nodeId));
  return row ?? null;
}

/** Upserts the main box's key for this node on a caller's node transaction. */
export async function pinPrimaryKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  pinned: PinnedPrimaryKey,
): Promise<void> {
  await tx
    .insert(nodePrimaryKey)
    .values({ nodeId, ...pinned })
    .onConflictDoUpdate({
      target: nodePrimaryKey.nodeId,
      set: { ...pinned, pinnedAt: now() },
    });
}

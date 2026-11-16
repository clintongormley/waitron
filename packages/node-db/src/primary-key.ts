import { eq } from "drizzle-orm";
import { type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { box } from "./schema/box.js";
import { writeBoxPinnedKeyTx } from "./box.js";

export interface PinnedPrimaryKey {
  primaryNodeId: string;
  publicKey: string;
}

/** The main box's key this node pinned, or `null` when its pinned-key group is empty. */
export async function readPinnedPrimaryKey(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<PinnedPrimaryKey | null> {
  const [row] = await node
    .select({ primaryNodeId: box.primaryNodeId, publicKey: box.primaryPublicKey })
    .from(box)
    .where(eq(box.nodeId, nodeId));
  return row?.primaryNodeId == null
    ? null
    : { primaryNodeId: row.primaryNodeId, publicKey: row.publicKey! };
}

/** Upserts the main box's key for this node on a caller's node transaction. */
export async function pinPrimaryKeyTx(
  tx: NodeTransaction,
  nodeId: string,
  pinned: PinnedPrimaryKey,
): Promise<void> {
  await writeBoxPinnedKeyTx(tx, nodeId, pinned);
}

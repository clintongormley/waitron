import { withNodeTransaction, type NodeDatabase } from "@waitron/db";
import { pinPrimaryKeyTx } from "@waitron/node-db";

/** Pins the main box's public key in this box's node.db, as `adoptFromPrimary` does at adopt. */
export async function pinMainBoxKey(
  node: NodeDatabase,
  nodeId: string,
  mainBox: { nodeId: string; publicKey: string },
): Promise<void> {
  await withNodeTransaction(node, (tx) =>
    pinPrimaryKeyTx(tx, nodeId, { primaryNodeId: mainBox.nodeId, publicKey: mainBox.publicKey }),
  );
}

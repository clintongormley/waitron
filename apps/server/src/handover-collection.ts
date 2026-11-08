import { readHistoryNodes, type Database, type Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";

/**
 * The boxes whose open card payments this box collects: every box it took over from, then every box
 * each of those took over from, so a payment left open two handovers back still has an owner. A box
 * that handed over and later took back appears in its own walk, and is left out.
 */
export async function readTakenOverFrom(
  db: Database | Transaction,
  nodeId: NodeId,
): Promise<readonly NodeId[]> {
  return (await readHistoryNodes(db, nodeId)).slice(1);
}

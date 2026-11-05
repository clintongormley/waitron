import type { Database } from "@waitron/db";
import { readActivationRows } from "@waitron/handover";
import { nodeId as brandNodeId, type NodeId } from "@waitron/shared";

/**
 * The boxes whose open card payments this box collects: every box it took over from, then every box
 * each of those took over from, so a payment left open two handovers back still has an owner. A box
 * that handed over and later took back appears in its own walk, and is left out.
 */
export async function readTakenOverFrom(db: Database, nodeId: NodeId): Promise<readonly NodeId[]> {
  const seen = new Set<string>([nodeId]);
  const takenOverFrom: NodeId[] = [];
  const toFollow: string[] = [nodeId];
  for (const destination of toFollow) {
    for (const { sourceNodeId } of await readActivationRows(db, destination)) {
      if (seen.has(sourceNodeId)) continue;
      seen.add(sourceNodeId);
      takenOverFrom.push(brandNodeId(sourceNodeId));
      toFollow.push(sourceNodeId);
    }
  }
  return takenOverFrom;
}

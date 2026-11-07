import { asc, eq } from "drizzle-orm";
import { nodeId as brandNodeId, type NodeId } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { handoverActivations } from "./schema/index.js";

/**
 * This box, then the boxes it took over from, then the boxes those took over from: fewest handovers
 * back first, and the boxes one box took over from in the order it took over from them. A box
 * already listed is skipped, so a box that handed over and took back appears once and the walk ends.
 */
export async function readHistoryNodes(
  db: Database | Transaction,
  nodeId: NodeId,
): Promise<readonly NodeId[]> {
  const history: NodeId[] = [nodeId];
  const seen = new Set<string>(history);
  for (const destination of history) {
    const rows = await db
      .select({ sourceNodeId: handoverActivations.sourceNodeId })
      .from(handoverActivations)
      .where(eq(handoverActivations.destinationNodeId, destination))
      .orderBy(asc(handoverActivations.activatedAt));
    for (const { sourceNodeId } of rows) {
      if (seen.has(sourceNodeId)) continue;
      seen.add(sourceNodeId);
      history.push(brandNodeId(sourceNodeId));
    }
  }
  return history;
}

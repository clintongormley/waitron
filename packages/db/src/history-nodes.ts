import { asc, eq } from "drizzle-orm";
import { nodeId as brandNodeId, type NodeId } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { handoverActivations } from "./schema/index.js";

/**
 * This box, then every box it took over from, then every box each of those took over from: nearest
 * first, each once. A box that handed over and later took back meets itself in the walk, and the walk
 * ends there rather than listing it again.
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

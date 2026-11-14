import { eq, ne, sql } from "drizzle-orm";
import type { NodeDatabase, NodeTransaction } from "@waitron/db";
import { nodeTakeFailures } from "./schema/node-take-failures.js";

/** This node's counted failed takes, or `null` when there are none. */
export async function readTakeFailures(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ failures: number; lastFailedAt: Date } | null> {
  const [row] = await node
    .select({
      failures: nodeTakeFailures.failures,
      lastFailedAt: nodeTakeFailures.lastFailedAt,
    })
    .from(nodeTakeFailures)
    .where(eq(nodeTakeFailures.nodeId, nodeId));
  return row ?? null;
}

export async function recordTakeFailureTx(
  tx: NodeTransaction,
  nodeId: string,
  at: Date,
): Promise<void> {
  await tx
    .insert(nodeTakeFailures)
    .values({ nodeId, failures: 1, lastFailedAt: at })
    .onConflictDoUpdate({
      target: nodeTakeFailures.nodeId,
      set: { failures: sql`${nodeTakeFailures.failures} + 1`, lastFailedAt: at },
    });
}

export async function clearTakeFailuresTx(tx: NodeTransaction, nodeId: string): Promise<void> {
  await tx.delete(nodeTakeFailures).where(eq(nodeTakeFailures.nodeId, nodeId));
}

/** Deletes every row of this table keyed by a node id other than `nodeId`, and keeps its own. */
export async function deleteNodeTakeFailuresOtherThanTx(
  tx: NodeTransaction,
  nodeId: string,
): Promise<void> {
  await tx.delete(nodeTakeFailures).where(ne(nodeTakeFailures.nodeId, nodeId));
}

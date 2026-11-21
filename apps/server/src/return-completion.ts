import { and, asc, eq } from "drizzle-orm";
import { handoverActivations, handoverReturnBatches, type Transaction } from "@waitron/db";
import { returnDigest } from "./return-records.js";

export async function recordReturnBatchTx(
  tx: Transaction,
  batch: {
    operationId: string;
    inventory: string;
    index: number;
    count: number;
    digest: string;
  },
): Promise<void> {
  const [first] = await tx
    .select({ count: handoverReturnBatches.batchCount })
    .from(handoverReturnBatches)
    .where(
      and(
        eq(handoverReturnBatches.operationId, batch.operationId),
        eq(handoverReturnBatches.inventory, batch.inventory),
      ),
    )
    .limit(1);
  if (first && first.count !== batch.count) return;
  await tx
    .insert(handoverReturnBatches)
    .values({
      operationId: batch.operationId,
      inventory: batch.inventory,
      batchIndex: batch.index,
      batchCount: batch.count,
      batchDigest: batch.digest,
    })
    .onConflictDoNothing({
      target: [
        handoverReturnBatches.operationId,
        handoverReturnBatches.inventory,
        handoverReturnBatches.batchIndex,
      ],
    });
}

export async function readCompletedReturns(tx: Transaction): Promise<Set<string>> {
  return completedIn(
    await tx
      .select()
      .from(handoverReturnBatches)
      .orderBy(
        asc(handoverReturnBatches.operationId),
        asc(handoverReturnBatches.inventory),
        asc(handoverReturnBatches.batchIndex),
      ),
  );
}

/** The boxes this venue holds a completed return from, whichever box received it. */
export async function sourcesWithCompletedReturn(tx: Transaction): Promise<Set<string>> {
  const completed = await readCompletedReturns(tx);
  const activations = await tx
    .select({
      operationId: handoverActivations.operationId,
      sourceNodeId: handoverActivations.sourceNodeId,
    })
    .from(handoverActivations);
  return new Set(
    activations.filter((a) => completed.has(a.operationId)).map((a) => a.sourceNodeId),
  );
}

/** Whether this venue holds a completed return from `sourceNodeId`, whichever box received it. */
export async function holdsCompletedReturnFrom(
  tx: Transaction,
  sourceNodeId: string,
): Promise<boolean> {
  const activations = await tx
    .select({ operationId: handoverActivations.operationId })
    .from(handoverActivations)
    .where(eq(handoverActivations.sourceNodeId, sourceNodeId));
  for (const { operationId } of activations) {
    if (await returnCompletedFor(tx, operationId)) return true;
  }
  return false;
}

/** Whether every batch of one inventory recorded for `operationId` is accounted. */
export async function returnCompletedFor(tx: Transaction, operationId: string): Promise<boolean> {
  const rows = await tx
    .select()
    .from(handoverReturnBatches)
    .where(eq(handoverReturnBatches.operationId, operationId))
    .orderBy(asc(handoverReturnBatches.inventory), asc(handoverReturnBatches.batchIndex));
  return completedIn(rows).has(operationId);
}

/** `rows` ordered by operation, inventory and batch index. */
function completedIn(rows: (typeof handoverReturnBatches.$inferSelect)[]): Set<string> {
  const completed = new Set<string>();
  let group: typeof rows = [];
  const check = () => {
    const first = group[0];
    if (
      first &&
      group.length === first.batchCount &&
      returnDigest(group.map((row) => row.batchDigest)) === first.inventory
    )
      completed.add(first.operationId);
  };
  for (const row of rows) {
    const first = group[0];
    if (first && (row.operationId !== first.operationId || row.inventory !== first.inventory)) {
      check();
      group = [];
    }
    group.push(row);
  }
  check();
  return completed;
}

import { and, asc, eq } from "drizzle-orm";
import { handoverReturnBatches, type Transaction } from "@waitron/db";
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
  const rows = await tx
    .select()
    .from(handoverReturnBatches)
    .orderBy(
      asc(handoverReturnBatches.operationId),
      asc(handoverReturnBatches.inventory),
      asc(handoverReturnBatches.batchIndex),
    );
  const completed = new Set<string>();
  let group: typeof rows = [];
  const check = () => {
    const first = group[0];
    if (
      first &&
      group.length === first.batchCount &&
      group.every(
        (row, index) => row.batchIndex === index && row.batchCount === first.batchCount,
      ) &&
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

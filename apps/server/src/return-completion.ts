import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  handoverActivations,
  handoverReturnBatches,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import { nodeHandoverEvents } from "@waitron/node-db";
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

/** The operations whose return is complete, among `operationIds` when given, else all. */
export async function readCompletedReturns(
  tx: Transaction,
  operationIds?: readonly string[],
): Promise<Set<string>> {
  if (operationIds?.length === 0) return new Set();
  return completedIn(
    await tx
      .select()
      .from(handoverReturnBatches)
      .where(
        operationIds === undefined
          ? undefined
          : inArray(handoverReturnBatches.operationId, [...operationIds]),
      )
      .orderBy(
        asc(handoverReturnBatches.operationId),
        asc(handoverReturnBatches.inventory),
        asc(handoverReturnBatches.batchIndex),
      ),
  );
}

export interface SourceActivations {
  /** This venue holds a completed return from the box, whichever box received it. */
  readonly returnCompleted: boolean;
  /** The scenario of the latest activation whose return completed, else of the latest activation. */
  readonly scenario: "controlled" | "emergency";
}

/**
 * For each box some box here took over from, what its activations say; only `sourceNodeId`'s
 * when given.
 */
export async function activationsBySource(
  tx: Transaction,
  sourceNodeId?: string,
): Promise<Map<string, SourceActivations>> {
  const activations = await tx
    .select({
      operationId: handoverActivations.operationId,
      sourceNodeId: handoverActivations.sourceNodeId,
      scenario: handoverActivations.scenario,
    })
    .from(handoverActivations)
    .where(
      sourceNodeId === undefined ? undefined : eq(handoverActivations.sourceNodeId, sourceNodeId),
    )
    .orderBy(asc(handoverActivations.activatedAt), asc(handoverActivations.operationId));
  const completed = await readCompletedReturns(
    tx,
    sourceNodeId === undefined ? undefined : activations.map((a) => a.operationId),
  );
  const bySource = new Map<string, SourceActivations>();
  for (const a of activations) {
    const done = completed.has(a.operationId);
    if (bySource.get(a.sourceNodeId)?.returnCompleted && !done) continue;
    bySource.set(a.sourceNodeId, { returnCompleted: done, scenario: a.scenario });
  }
  return bySource;
}

/**
 * Whether this venue holds a completed return from `sourceNodeId`, whichever box received it: the
 * `returnCompleted` that `activationsBySource` lists, so the Servers listing and the actions it
 * offers answer alike.
 */
export async function holdsCompletedReturnFrom(
  tx: Transaction,
  sourceNodeId: string,
): Promise<boolean> {
  return (await activationsBySource(tx, sourceNodeId)).get(sourceNodeId)?.returnCompleted === true;
}

/**
 * Per box this venue holds a completed return from, when this box recorded the latest of them
 * complete: its `return_complete` step, by this box's clock. Null when any of them has no such
 * step here, as for a return completed with no open takeover, or received by another box.
 */
export async function returnsCompletedAt(
  tx: Transaction,
  node: NodeDatabase,
  selfNodeId: string,
): Promise<Map<string, Date | null>> {
  const completed = await readCompletedReturns(tx);
  const bySource = new Map<string, Date | null>();
  if (completed.size === 0) return bySource;
  const activations = await tx
    .select({
      operationId: handoverActivations.operationId,
      sourceNodeId: handoverActivations.sourceNodeId,
    })
    .from(handoverActivations)
    .where(inArray(handoverActivations.operationId, [...completed]));
  const steps = await node
    .select({ operationId: nodeHandoverEvents.operationId, at: nodeHandoverEvents.recordedAt })
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, selfNodeId),
        eq(nodeHandoverEvents.kind, "return_complete"),
        inArray(nodeHandoverEvents.operationId, [...completed]),
      ),
    );
  const stepAt = new Map(steps.map((s) => [s.operationId, s.at]));
  for (const { operationId, sourceNodeId } of activations) {
    const at = stepAt.get(operationId) ?? null;
    const latest = bySource.get(sourceNodeId);
    if (latest === null) continue;
    bySource.set(sourceNodeId, at === null || latest === undefined || at > latest ? at : latest);
  }
  return bySource;
}

/**
 * Whether every batch of `inventory` is recorded for `operationId` and their digests make it up.
 * Counts the inventory's index entries first, so a partial inventory, asked after each batch, reads
 * none of its rows.
 */
export async function returnCompletedFor(
  tx: Transaction,
  operationId: string,
  inventory: string,
): Promise<boolean> {
  const scope = and(
    eq(handoverReturnBatches.operationId, operationId),
    eq(handoverReturnBatches.inventory, inventory),
  );
  const [first] = await tx
    .select({ count: handoverReturnBatches.batchCount })
    .from(handoverReturnBatches)
    .where(scope)
    .limit(1);
  if (!first) return false;
  const [recorded] = await tx.select({ n: count() }).from(handoverReturnBatches).where(scope);
  if (recorded?.n !== first.count) return false;
  const rows = await tx
    .select()
    .from(handoverReturnBatches)
    .where(scope)
    .orderBy(asc(handoverReturnBatches.batchIndex));
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

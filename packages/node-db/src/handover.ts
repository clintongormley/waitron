import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { now, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import {
  HANDOVER_CLOSED_STATES,
  nodeHandoverEvents,
  nodeHandoverOperations,
  nodeHandoverRestriction,
  type HandoverOperationState,
} from "./schema/node-handover.js";

export { HANDOVER_CLOSED_STATES };

type NodeHandle = NodeDatabase | NodeTransaction;

/** What a box records when it begins an operation. */
export type HandoverOperationRow = Omit<
  typeof nodeHandoverOperations.$inferInsert,
  "createdAt" | "updatedAt"
> & { waitingReason: string | null };

export type HandoverOperation = typeof nodeHandoverOperations.$inferSelect;

export type HandoverEventRow = Omit<
  typeof nodeHandoverEvents.$inferInsert,
  "eventId" | "recordedAt"
>;

export type HandoverEvent = typeof nodeHandoverEvents.$inferSelect;

export type HandoverRestrictionRow = Omit<
  typeof nodeHandoverRestriction.$inferInsert,
  "recordedAt"
> & { operationId: string | null };

export type HandoverRestriction = typeof nodeHandoverRestriction.$inferSelect;

/**
 * Records `row` as this box's operation. The same id with the same fingerprint answers `replayed`
 * and writes nothing; the order of states is the caller's to check.
 */
export async function beginHandoverOperationTx(
  tx: NodeTransaction,
  row: HandoverOperationRow,
): Promise<"created" | "replayed"> {
  const existing = await readHandoverOperation(tx, row.nodeId, row.operationId);
  if (existing !== null) {
    if (existing.fingerprint !== row.fingerprint) {
      throw new AppError("handover.operation_conflict", { operationId: row.operationId });
    }
    return "replayed";
  }
  const open = await readOpenHandoverOperation(tx, row.nodeId);
  if (open !== null) {
    throw new AppError("handover.operation_in_progress", { operationId: open.operationId });
  }
  await tx.insert(nodeHandoverOperations).values(row);
  return "created";
}

/** Moves this box's operation to `to`; `waitingReason` replaces whatever reason it held. */
export async function advanceHandoverOperationTx(
  tx: NodeTransaction,
  nodeId: string,
  operationId: string,
  to: HandoverOperationState,
  waitingReason: string | null,
): Promise<void> {
  const updated = await tx
    .update(nodeHandoverOperations)
    .set({ state: to, waitingReason, updatedAt: now() })
    .where(
      and(
        eq(nodeHandoverOperations.nodeId, nodeId),
        eq(nodeHandoverOperations.operationId, operationId),
      ),
    )
    .returning({ operationId: nodeHandoverOperations.operationId });
  if (updated.length === 0) {
    // A fault in Waitron: the caller read the operation before choosing the next state.
    throw new Error(`no handover operation ${operationId} for node ${nodeId}`);
  }
}

export async function readHandoverOperation(
  node: NodeHandle,
  nodeId: string,
  operationId: string,
): Promise<HandoverOperation | null> {
  const [row] = await node
    .select()
    .from(nodeHandoverOperations)
    .where(
      and(
        eq(nodeHandoverOperations.nodeId, nodeId),
        eq(nodeHandoverOperations.operationId, operationId),
      ),
    );
  return row ?? null;
}

/** This box's one operation not yet in a closing state, or `null`. */
export async function readOpenHandoverOperation(
  node: NodeHandle,
  nodeId: string,
): Promise<HandoverOperation | null> {
  const [row] = await node
    .select()
    .from(nodeHandoverOperations)
    .where(
      and(
        eq(nodeHandoverOperations.nodeId, nodeId),
        notInArray(nodeHandoverOperations.state, [...HANDOVER_CLOSED_STATES]),
      ),
    );
  return row ?? null;
}

export async function appendHandoverEventTx(
  tx: NodeTransaction,
  row: HandoverEventRow,
): Promise<void> {
  await tx.insert(nodeHandoverEvents).values(row);
}

/** The first event of `kind` this box recorded for the operation, or `null`. */
export async function readHandoverEvent(
  node: NodeHandle,
  nodeId: string,
  operationId: string,
  kind: string,
): Promise<HandoverEvent | null> {
  const [row] = await node
    .select()
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, nodeId),
        eq(nodeHandoverEvents.operationId, operationId),
        eq(nodeHandoverEvents.kind, kind),
      ),
    )
    .orderBy(asc(sql`rowid`))
    .limit(1);
  return row ?? null;
}

/**
 * Records this box's restriction. Writing the same values again changes nothing; other values
 * are refused, because nothing may rewrite a restriction once recorded.
 */
export async function recordHandoverRestrictionTx(
  tx: NodeTransaction,
  row: HandoverRestrictionRow,
): Promise<void> {
  const existing = await readHandoverRestriction(tx, row.nodeId);
  if (existing === null) {
    await tx.insert(nodeHandoverRestriction).values(row);
    return;
  }
  if (
    existing.operationId !== row.operationId ||
    existing.kind !== row.kind ||
    existing.successorNodeId !== row.successorNodeId ||
    existing.membershipTerm !== row.membershipTerm
  ) {
    throw new AppError("handover.restriction_conflict", {});
  }
}

export async function readHandoverRestriction(
  node: NodeHandle,
  nodeId: string,
): Promise<HandoverRestriction | null> {
  const [row] = await node
    .select()
    .from(nodeHandoverRestriction)
    .where(eq(nodeHandoverRestriction.nodeId, nodeId));
  return row ?? null;
}

import "./errors.js";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  readNodeMembership,
  recordActivity,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { servingPrimaryNodeId, type SignedMembershipDocument } from "@waitron/membership";
import {
  appendHandoverEventTx,
  nodeHandoverEvents,
  readOpenHandoverOperation,
  readPinnedPrimaryKey,
  type HandoverOperation,
} from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { closeAbandonedReturnTx, openFacts, recordReturnAbandonedTx } from "./return-abandoned.js";
import { latestTakeoverFrom } from "./handover-intervals.js";
import { activationsBySource } from "./return-completion.js";
import { returnDigest } from "./return-records.js";

/**
 * The handover event kind of an order, in node.db: detail `{targetNodeId, orderId, acceptLoss,
 * personId}`, `personId` naming who ordered it.
 */
const RESET_ORDERED = "reset_ordered";

export interface ResetOrder {
  readonly orderId: string;
  readonly acceptLoss: boolean;
}

/**
 * The order this box answers among one target's `reset_ordered` details, in the order they were
 * written: its loss order when one exists, otherwise the first without loss. Event rows are
 * insert-only, so a loss order replaces one without and never the reverse.
 */
function pickResetOrder(details: readonly Record<string, unknown>[]): ResetOrder | null {
  const orders = details.flatMap((detail): ResetOrder[] =>
    typeof detail.orderId === "string" && typeof detail.acceptLoss === "boolean"
      ? [{ orderId: detail.orderId, acceptLoss: detail.acceptLoss }]
      : [],
  );
  return orders.find((o) => o.acceptLoss) ?? orders[0] ?? null;
}

/** The order this box answers for `targetNodeId` (`pickResetOrder`). */
export async function readResetOrderFor(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
  targetNodeId: string,
): Promise<ResetOrder | null> {
  const rows = await node
    .select({ detail: nodeHandoverEvents.detail })
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, nodeId),
        eq(nodeHandoverEvents.kind, RESET_ORDERED),
        sql`json_extract(${nodeHandoverEvents.detail}, '$.targetNodeId') = ${targetNodeId}`,
      ),
    )
    .orderBy(asc(sql`rowid`));
  return pickResetOrder(rows.map((r) => r.detail));
}

/** The id of the `handover.reset_ordered` activity entry of `orderId`. */
const resetOrderedActivityId = (orderId: string) =>
  returnDigest({ kind: "handover.reset_ordered", orderId });

/**
 * The takeover of the order `orderId` this box wrote for `targetNodeId` and who ordered it, or
 * undefined if there is no such order or it names nobody.
 */
export async function readResetOrderOperation(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
  targetNodeId: string,
  orderId: string,
): Promise<{ readonly operationId: string | null; readonly personId: string } | undefined> {
  const [row] = await node
    .select({ operationId: nodeHandoverEvents.operationId, detail: nodeHandoverEvents.detail })
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, nodeId),
        eq(nodeHandoverEvents.kind, RESET_ORDERED),
        sql`json_extract(${nodeHandoverEvents.detail}, '$.targetNodeId') = ${targetNodeId}`,
        sql`json_extract(${nodeHandoverEvents.detail}, '$.orderId') = ${orderId}`,
      ),
    )
    .limit(1);
  const personId = row?.detail.personId;
  return row === undefined || typeof personId !== "string"
    ? undefined
    : { operationId: row.operationId, personId };
}

/** The order this box answers for each box it has ordered to reset (`pickResetOrder`). */
export async function readResetOrders(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<Map<string, ResetOrder>> {
  const rows = await node
    .select({ detail: nodeHandoverEvents.detail })
    .from(nodeHandoverEvents)
    .where(and(eq(nodeHandoverEvents.nodeId, nodeId), eq(nodeHandoverEvents.kind, RESET_ORDERED)))
    .orderBy(asc(sql`rowid`));
  const byTarget = new Map<string, Record<string, unknown>[]>();
  for (const { detail } of rows) {
    if (typeof detail.targetNodeId !== "string") continue;
    byTarget.set(detail.targetNodeId, [...(byTarget.get(detail.targetNodeId) ?? []), detail]);
  }
  const picked = new Map<string, ResetOrder>();
  for (const [target, details] of byTarget) {
    const order = pickResetOrder(details);
    if (order !== null) picked.set(target, order);
  }
  return picked;
}

/**
 * Why this box would refuse to order `targetNodeId` to reset whatever the press, or null: the
 * chart lists the box `sell-only`, this box is its serving primary, the box is the main box whose
 * key this box pinned (the only old box whose questions the peer route answers), and no open
 * handover here names the box other than the takeover waiting for its return.
 */
export function resetRefusal(
  held: SignedMembershipDocument | null,
  selfNodeId: string,
  targetNodeId: string,
  open: HandoverOperation | null,
  pinnedPrimaryNodeId: string | null,
): AppError | null {
  const target = held?.body.nodes.find((n) => n.nodeId === targetNodeId);
  if (held === null || (target === undefined && !held.body.revoked?.includes(targetNodeId))) {
    return new AppError("membership.node_not_found", {});
  }
  if (servingPrimaryNodeId(held) !== selfNodeId) return new AppError("membership.not_primary", {});
  if (target?.standing !== "sell-only") return new AppError("membership.node_not_replaced", {});
  if (pinnedPrimaryNodeId !== targetNodeId)
    return new AppError("handover.reset_not_previous_main", {});
  const { returnOutstanding, inOpenOperation } = openFacts(open, targetNodeId);
  if (inOpenOperation && !returnOutstanding) {
    return new AppError("handover.operation_in_progress", { operationId: open!.operationId });
  }
  return null;
}

export interface ResetFacts {
  /** `resetRefusal` refuses whatever the press. */
  readonly refused: boolean;
  readonly standing: ResetOrder | null;
  /** This venue holds a completed return from the box (`activationsBySource`). */
  readonly returnCompleted: boolean;
  /** An open takeover here waits for the box's return. */
  readonly returnOutstanding: boolean;
  /** This venue recorded a takeover from the box. */
  readonly activated: boolean;
}

/**
 * Whether `orderReset` accepts a plain wipe and one accepting the loss, a standing order being
 * answered as it stands.
 */
export function resetOptions(facts: ResetFacts): { plain: boolean; withLoss: boolean } {
  if (facts.refused) return { plain: false, withLoss: false };
  return {
    plain: facts.standing !== null || facts.returnCompleted,
    withLoss: facts.standing?.acceptLoss === true || facts.returnOutstanding || facts.activated,
  };
}

/**
 * Orders the replaced old main box `targetNodeId` to reset, or returns the order already standing.
 * node.db's lock is held throughout; venue.db's entries commit first under ids derived from the
 * order, so a retry after a failure in node.db writes no second entry and repairs node.db.
 */
export async function orderReset(
  deps: { readonly db: Database; readonly node: NodeDatabase; readonly nodeId: string },
  args: { readonly targetNodeId: string; readonly personId: string; readonly acceptLoss: boolean },
): Promise<ResetOrder> {
  const { targetNodeId, acceptLoss } = args;
  return withNodeTransaction(deps.node, async (nodeTx) => {
    const held = await readNodeMembership(deps.db);
    const open = await readOpenHandoverOperation(nodeTx, deps.nodeId);
    const pinned = await readPinnedPrimaryKey(nodeTx, deps.nodeId);
    const refusal = resetRefusal(
      held,
      deps.nodeId,
      targetNodeId,
      open,
      pinned?.primaryNodeId ?? null,
    );
    if (refusal !== null) throw refusal;
    const { returnOutstanding } = openFacts(open, targetNodeId);
    const standing = await readResetOrderFor(nodeTx, deps.nodeId, targetNodeId);
    const activation = (await activationsBySource(deps.db, targetNodeId)).get(targetNodeId);
    const options = resetOptions({
      refused: false,
      standing,
      returnCompleted: activation?.returnCompleted === true,
      returnOutstanding,
      activated: activation !== undefined,
    });
    if (!acceptLoss && !options.plain) throw new AppError("handover.reset_loss_unaccepted", {});
    if (acceptLoss && !options.withLoss) throw new AppError("membership.node_not_replaced", {});
    if (standing !== null && (standing.acceptLoss || !acceptLoss)) return standing;

    // Either option holds only when a takeover waits for the box or this venue recorded one.
    const operationId = returnOutstanding
      ? open!.operationId
      : (await latestTakeoverFrom(deps.db, targetNodeId))!.operationId;
    const orderId = returnDigest({ kind: "handover.reset_order", operationId, acceptLoss });
    const abandon = acceptLoss && returnOutstanding;

    await withTransaction(deps.db, async (tx) => {
      await recordActivity(tx, {
        id: resetOrderedActivityId(orderId),
        kind: "handover.reset_ordered",
        subjectId: targetNodeId,
        personId: args.personId,
        data: { orderId, operationId, acceptLoss },
      });
      if (abandon) {
        await recordReturnAbandonedTx(tx, {
          id: returnDigest({ kind: "handover.return_abandoned", orderId }),
          operationId,
          sourceNodeId: targetNodeId,
          personId: args.personId,
        });
      }
    });
    if (abandon) await closeAbandonedReturnTx(nodeTx, deps.nodeId, open!);
    // No event for this orderId exists here: a standing order of the same or the loss kind
    // returned above.
    await appendHandoverEventTx(nodeTx, {
      nodeId: deps.nodeId,
      operationId,
      kind: RESET_ORDERED,
      detail: { targetNodeId, orderId, acceptLoss, personId: args.personId },
      envelope: null,
    });
    return { orderId, acceptLoss };
  });
}

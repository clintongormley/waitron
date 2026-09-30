import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  adjustmentReasons,
  createAdjustmentReason,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import { withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { applyAdjustment } from "../adjustments-apply.js";
import type { TillConfig } from "../till-config.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000c1";

/** A reason that allows a cancel, applied by anyone with no approval and no note. */
export const CANCEL_REASON: AdjustmentReasonInput = {
  name: "Cancelled in a test",
  names: {},
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "staff",
  approverRole: "staff",
  noteRequired: false,
};

/** {@link CANCEL_REASON}'s id, created the first time a database is asked for it. */
export async function cancelReasonId(tx: Transaction): Promise<string> {
  const [found] = await tx
    .select({ id: adjustmentReasons.id })
    .from(adjustmentReasons)
    .where(eq(adjustmentReasons.name, CANCEL_REASON.name));
  return found?.id ?? (await createAdjustmentReason(tx, CANCEL_REASON)).id;
}

/** A person with `id`, added (at the default role) when no person has that id: an adjustment is
 * requested by someone. */
async function ensureOperator(tx: Transaction, id: string): Promise<string> {
  await tx
    .insert(persons)
    .values({ id, displayName: `Operator ${id}` })
    .onConflictDoNothing({ target: persons.id });
  return id;
}

/** Line `lineNo`'s id and the bill's revision, as they stand. */
async function lineAndRevision(
  tx: Transaction,
  orderId: string,
  lineNo: number,
): Promise<{ lineId: string; revision: number }> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, orderId), eq(workingOrderLines.lineNo, lineNo)),
    );
  if (line === undefined) throw new Error(`no line ${lineNo} on bill ${orderId}`);
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return { lineId: line.id, revision: order!.revision };
}

/**
 * The body of `POST /api/working-orders/:id/adjustments` cancelling `quantity` of line `lineNo`, all
 * of it when absent, under {@link CANCEL_REASON} at the bill's current revision.
 */
export async function cancelBody(
  db: Database,
  orderId: string,
  lineNo: number,
  quantity?: string,
): Promise<Record<string, unknown>> {
  return withTransaction(db, async (tx) => {
    const { lineId, revision } = await lineAndRevision(tx, orderId, lineNo);
    return {
      submissionId: randomUUID(),
      expectedRevision: revision,
      lineId,
      reasonId: await cancelReasonId(tx),
      action: "cancel",
      ...(quantity === undefined ? {} : { quantity }),
      note: null,
    };
  });
}

/**
 * Cancel `quantity` of line `lineNo` of a party's bill, all of it when absent, through
 * {@link applyAdjustment}, which the adjustment route calls, without the route's invoice issue: at
 * the bill's current revision, under {@link CANCEL_REASON}. `operatorId` is made a person when it is
 * not one yet.
 */
export async function cancelLine(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lineNo: number,
  quantity?: string,
  operatorId?: string,
): Promise<{ adjustmentIds: string[]; revision: number }> {
  const { lineId, revision } = await lineAndRevision(tx, orderId, lineNo);
  return applyAdjustment(
    tx,
    cfg,
    {
      orderId,
      submissionId: randomUUID(),
      expectedRevision: revision,
      lineId,
      reasonId: await cancelReasonId(tx),
      action: "cancel",
      ...(quantity === undefined ? {} : { quantity }),
      note: null,
      operatorId: await ensureOperator(tx, operatorId ?? OPERATOR),
    },
    cfg.locale,
  );
}

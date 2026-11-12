import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./trading-admission.js";
import { readBillEditState } from "../bill-editing.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import {
  adjustmentReasons,
  createAdjustmentReason,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import { withTransaction, workingOrderLines, workingOrders } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { thousandthsToDecimal } from "@waitron/shared";
import { cancelItem, type CancelItemAsk } from "../line-cancel.js";
import { readCancellationContext } from "../line-cancel-context.js";
import { partyRevision } from "../parties.js";
import type { OrderAttendance } from "../working-order.js";
import { applyAdjustment } from "../adjustments-apply.js";
import type { TradingContext } from "../trading-context.js";
import { send, type BillVenue } from "./bill-venue.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000c1";

/** A Void reason with no note. */
export const CANCEL_REASON: AdjustmentReasonInput = {
  name: "Cancelled in a test",
  names: {},
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,

  noteRequired: false,
};

/** A Comp reason giving a line away, applied by anyone with no approval and no note. */
export const GIVE_AWAY_REASON: AdjustmentReasonInput = {
  name: "Given away in a test",
  names: {},
  kind: "comp",
  actions: ["comp"],
  maxPercentBp: null,
  maxAmount: null,

  noteRequired: false,
};

/** A Comp reason taking a percentage off a whole bill, applied by anyone with no approval and no
 * note. */
export const COMP_BILL_REASON: AdjustmentReasonInput = {
  name: "Bill comped in a test",
  names: {},
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: null,

  noteRequired: false,
};

/** `reason`'s id, created the first time a database is asked for it. */
async function reasonIdOf(tx: Transaction, reason: AdjustmentReasonInput): Promise<string> {
  const [found] = await tx
    .select({ id: adjustmentReasons.id })
    .from(adjustmentReasons)
    .where(eq(adjustmentReasons.name, reason.name));
  return found?.id ?? (await createAdjustmentReason(tx, reason)).id;
}

/** {@link CANCEL_REASON}'s id, created the first time a database is asked for it. */
export function cancelReasonId(tx: Transaction): Promise<string> {
  return reasonIdOf(tx, CANCEL_REASON);
}

/** A person with `id`, added as a supervisor when no person has that id: an adjustment is
 * requested by someone, and a supervisor holds the refund permission a sent dish's cancel needs. */
export async function ensureOperator(tx: Transaction, id: string): Promise<string> {
  if (!(await tx.select({ id: persons.id }).from(persons).where(eq(persons.id, id)))[0]) {
    await seedPersons(tx, { id, displayName: `Operator ${id}`, role: "supervisor" });
  }
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
      expectedEdit: await readBillEditState(tx, orderId),
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
  cfg: TradingContext,
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
      admission: testTradingAdmission(),
      orderId,
      expectedEdit: await readBillEditState(tx, orderId),
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

/** Gives away line `lineNo` of the bill in full through the adjustment route, under
 * {@link GIVE_AWAY_REASON}. */
export async function giveAway(venue: BillVenue, billId: string, lineNo: number): Promise<void> {
  const reasonId = await withTransaction(venue.db, (tx) => reasonIdOf(tx, GIVE_AWAY_REASON));
  const body = await cancelBody(venue.db, billId, lineNo);
  const given = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/adjustments`,
    { ...body, reasonId, action: "comp" },
  );
  expect(given.status).toBe(200);
}

/** Takes `percentBp` off the whole bill through the adjustment route, under
 * {@link COMP_BILL_REASON}: 10000 makes it free. */
export async function compWholeBill(
  venue: BillVenue,
  billId: string,
  percentBp: number,
): Promise<void> {
  const reasonId = await withTransaction(venue.db, (tx) => reasonIdOf(tx, COMP_BILL_REASON));
  const body = await cancelBody(venue.db, billId, 1);
  const comped = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/adjustments`,
    { ...body, lineId: null, reasonId, action: "discount_percent", percentBp },
  );
  expect(comped.status).toBe(200);
}

export async function observedCancelItem(
  tx: Transaction,
  orderId: string,
  lineNo: number,
  quantity?: string,
) {
  const { lineId, revision } = await lineAndRevision(tx, orderId, lineNo);
  const [line] = await tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, lineId));
  const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, orderId));
  const target = bill!.partyId ?? { billId: orderId };
  const body: CancelItemAsk = {
    expectedEdit: await readBillEditState(tx, orderId),
    expectedBillRevision: revision,
    ...(bill!.partyId === null
      ? {}
      : { expectedPartyRevision: await partyRevision(tx, bill!.partyId) }),
    expectedContext: await readCancellationContext(tx, target, lineId),
    quantity: quantity ?? thousandthsToDecimal(line!.quantity),
    outcome: "remove_charge",
    submissionId: randomUUID(),
  };
  return { target, lineId, body };
}

export async function cancelItemForTest(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  lineNo: number,
  quantity?: string,
  operatorId?: string,
  attendance?: OrderAttendance,
) {
  const { target, lineId, body } = await observedCancelItem(tx, orderId, lineNo, quantity);
  return cancelItem(
    tx,
    cfg,
    target,
    lineId,
    { ...body, reasonId: await cancelReasonId(tx), admission: testTradingAdmission() },
    await ensureOperator(tx, operatorId ?? OPERATOR),
    attendance,
  );
}

export async function cancelItemRequest(
  db: Database,
  orderId: string,
  lineNo: number,
  quantity?: string,
  overrides: Partial<CancelItemAsk> = {},
) {
  const observed = await withTransaction(db, async (tx) => {
    const current = await observedCancelItem(tx, orderId, lineNo, quantity);
    if (overrides.lineIds !== undefined)
      current.body.expectedContext = await readCancellationContext(
        tx,
        current.target,
        current.lineId,
        overrides.lineIds,
      );
    return current;
  });
  const path =
    typeof observed.target === "string"
      ? `/api/parties/${observed.target}/lines/${observed.lineId}/cancel-item`
      : `/api/working-orders/${orderId}/lines/${observed.lineId}/cancel-item`;
  return { path, body: { ...observed.body, ...overrides } };
}

export async function cancelItemHttp(
  db: Database,
  app: Parameters<typeof send>[0],
  cookie: string,
  orderId: string,
  lineNo: number,
  quantity?: string,
  overrides: Partial<CancelItemAsk> = {},
) {
  const { path, body } = await cancelItemRequest(db, orderId, lineNo, quantity, overrides);
  return send(app, cookie, "POST", path, body);
}

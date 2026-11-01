import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertBillInvariant, refuseBillWithPayments } from "./bill-payments.js";
import {
  enqueueMovedSlips,
  moveKitchenPrintLinks,
  orderTableLabel,
  readSentWork,
} from "./kitchen-print.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { VENUE_SERVICE } from "./modules.js";
import { requireBillEditor, requireBillEditors } from "./bill-editing.js";
import type { BillEditExpected, BillEditState } from "./order-drafts.js";
import { isRecalledDish } from "./draft-source.js";
import { moveDraftsToBill } from "./order-drafts.js";
import { inheritKitchenNote } from "./order-kitchen-note.js";
import { guardParty, refuseMovedParty, requireBillOfParty } from "./parties.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import {
  assertDistinctTransferLines,
  assertServiceModesMatch,
  bumpRevision,
  carveOffLines,
  createOpenOrder,
  moveOrderLines,
  type OrderAttendance,
} from "./working-order.js";
import "./errors.js";

/**
 * Split, merge and transfer between the bills of one party. When the path bill belongs to a party,
 * each checks that party's revision before either bill's own state, so of two tills acting from one
 * read the second is refused `party.out_of_date` whichever ran first, never a code describing what
 * the first did.
 */

export interface BillCommand {
  expectedPartyRevision?: number;
  /** The party the till read the path bill under. */
  partyId?: string;
  operatorId: string;
}

type Transfers = { lineNo: number; quantity?: string }[];

// Reserved sources change only through their owning draft's revision-checked commands.
async function requireUnreservedTransfers(
  tx: Transaction,
  billId: string,
  transfers: Transfers,
  edit: BillEditState,
): Promise<void> {
  const [reserved] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        inArray(
          workingOrderLines.lineNo,
          transfers.map((line) => line.lineNo),
        ),
        isRecalledDish(tx),
      ),
    )
    .limit(1);
  if (reserved !== undefined) throw reservedRefusal(billId, edit);
}

function reservedRefusal(billId: string, edit: BillEditState): AppError {
  return new AppError("draft.out_of_date", {
    billId,
    draftId: edit.draftId,
    revision: edit.draftRevision,
    edit,
  });
}

type BillStatus = (typeof workingOrders.$inferSelect)["status"];

/** The path bill as {@link guardPathParty} read it. */
interface PathBill {
  partyId: string | null;
  status: BillStatus;
}

/** The bill's own state, without its payments. */
function refuseClosedBill(billId: string, status: BillStatus): void {
  if (status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (status === "placed") throw new AppError("bill.presented", { workingOrderId: billId });
}

/**
 * Refuse a bill that is not untouched: missing, paid, abandoned or presented, or holding any
 * payment, one given back in full included.
 */
export async function requireUntouched(tx: Transaction, billId: string): Promise<void> {
  const [bill] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
  await refuseTouched(tx, billId, bill.status);
}

async function refuseTouched(tx: Transaction, billId: string, status: BillStatus): Promise<void> {
  refuseClosedBill(billId, status);
  await refuseBillWithPayments(tx, billId);
}

/**
 * The party of the path bill, checked and moved on (`party.not_open`, then `party.out_of_date`).
 * A command naming a party the bill is not in is `party.out_of_date` whatever revision it sends,
 * or `party.not_open` when no party has that id; one that read the bill with no party
 * (`partyId: null`) once it has one is `party.out_of_date`, naming that party. A bill of no party
 * has no revision.
 */
export async function guardPathParty(
  tx: Transaction,
  billId: string,
  command: Omit<BillCommand, "partyId"> & { partyId?: string | null },
): Promise<PathBill> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
  if (command.partyId !== undefined && command.partyId !== bill.partyId) {
    await refuseMovedParty(tx, command.partyId ?? bill.partyId!);
  }
  if (bill.partyId !== null) await guardParty(tx, bill.partyId, command);
  return bill;
}

/**
 * Refuse unless the other bill and the path bill, in that order, are untouched bills of the path
 * bill's party: not paid, abandoned or presented, and holding no payment, one given back in full
 * included. A counter order belongs to no party. Returns the party.
 */
async function requireUntouchedPair(
  tx: Transaction,
  pathBillId: string,
  path: PathBill,
  otherBillId: string,
): Promise<string> {
  if (path.partyId === null) {
    throw new AppError("bill.other_party", { workingOrderId: otherBillId });
  }
  await requireBillOfParty(tx, path.partyId, otherBillId);
  await refuseBillWithPayments(tx, otherBillId);
  await refuseTouched(tx, pathBillId, path.status);
  return path.partyId;
}

/**
 * Put the chosen items of an open bill on a new bill of the same party, or a new counter order when
 * the bill has none. A partly paid bill may be split; the items paid for stay (`bill.line_paid`).
 * A dish in a held group may be split off, keeping its group, and fires with it; a dish the kitchen
 * holds outside a held group is refused `tab.split_held_line`.
 */
export async function splitBill(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  transfers: Transfers,
  command: BillCommand & { expectedEdit: BillEditExpected },
): Promise<{ billId: string }> {
  if (transfers.length === 0) throw new AppError("sale.empty_basket", {});
  assertDistinctTransferLines(billId, transfers);
  const path = await guardPathParty(tx, billId, command);
  refuseClosedBill(billId, path.status);
  const edit = await requireBillEditor(tx, billId, command.operatorId, command.expectedEdit);
  await requireUnreservedTransfers(tx, billId, transfers, edit);

  const newBillId = randomUUID();
  await createOpenOrder(tx, cfg, newBillId, [], await orderTableLabel(tx, cfg, billId), {
    partyId: path.partyId,
    existingService: true,
    copyServiceContextFrom: billId,
  });
  if (path.partyId === null)
    await inheritKitchenNote(
      tx,
      cfg,
      { workingOrderId: billId },
      { workingOrderId: newBillId },
      "copy",
    );
  const before = await readSentWork(tx, billId);
  const { splitFrom } = await carveOffLines(tx, cfg, billId, newBillId, transfers, {
    refuseHeld: true,
    actorId: command.operatorId,
  });
  await bumpRevision(tx, [billId, newBillId]);
  await assertBillInvariant(tx, [billId]);
  await enqueueMovedSlips(tx, cfg, before, newBillId, splitFrom);
  return { billId: newBillId };
}

/**
 * Move every line of `fromBillId` onto `intoBillId` and abandon it, which files nothing. Both must be
 * untouched bills of one party.
 */
export async function mergeBills(
  tx: Transaction,
  cfg: TradingContext,
  intoBillId: string,
  fromBillId: string,
  command: BillCommand & { expectedEdits: BillEditExpected[] },
  attendance?: OrderAttendance,
): Promise<void> {
  if (intoBillId === fromBillId) throw new AppError("tab.merge_self", { tabId: intoBillId });
  const path = await guardPathParty(tx, intoBillId, command);
  await requireUntouchedPair(tx, intoBillId, path, fromBillId);
  await assertServiceModesMatch(tx, cfg, fromBillId, intoBillId);
  await mergeCheckedBills(tx, cfg, intoBillId, fromBillId, {
    operatorId: command.operatorId,
    expectedEdits: command.expectedEdits,
    ...(attendance === undefined
      ? {}
      : {
          attendance: {
            recorder: attendance.recorder,
            at: attendance.clock.now().instant.toISOString(),
          },
        }),
  });
}

/**
 * {@link mergeBills} after its checks, for a caller that has made them itself: both bills are
 * untouched bills of one party, in one service mode. `known.kitchenTold` is set by a caller that
 * tells the kitchen of `fromBillId`'s sent dishes itself, from what it read before `fromBillId`
 * joined the party.
 */
export async function mergeCheckedBills(
  tx: Transaction,
  cfg: TradingContext,
  intoBillId: string,
  fromBillId: string,
  known: {
    operatorId: string;
    expectedEdits: BillEditExpected[];
    kitchenTold?: boolean;
    attendance?: { recorder: AttendanceRecorder; at: string };
  },
): Promise<void> {
  await requireBillEditors(tx, [fromBillId, intoBillId], known.operatorId, known.expectedEdits);
  const before = known.kitchenTold === true ? null : await readSentWork(tx, fromBillId);
  await moveOrderLines(tx, cfg, fromBillId, intoBillId, undefined, {
    actorId: known.operatorId,
  });
  await moveDraftsToBill(
    tx,
    cfg,
    fromBillId,
    intoBillId,
    known.operatorId,
    known.expectedEdits,
    known.attendance,
  );
  await moveKitchenPrintLinks(tx, fromBillId, intoBillId);
  await bumpRevision(tx, [fromBillId, intoBillId]);
  await tx
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, fromBillId));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [fromBillId]);
  if (before !== null) await enqueueMovedSlips(tx, cfg, before, intoBillId);
}

/**
 * Move the chosen items from one untouched bill of a party to another. Whole lines move; a part of
 * a line splits it, keeping its unit prices.
 */
export async function transferItems(
  tx: Transaction,
  cfg: TradingContext,
  fromBillId: string,
  toBillId: string,
  transfers: Transfers,
  command: BillCommand & { expectedEdits: BillEditExpected[] },
): Promise<void> {
  if (fromBillId === toBillId) throw new AppError("tab.transfer_self", { tabId: fromBillId });
  if (transfers.length === 0) throw new AppError("sale.empty_basket", {});
  const path = await guardPathParty(tx, fromBillId, command);
  await requireUntouchedPair(tx, fromBillId, path, toBillId);
  assertDistinctTransferLines(fromBillId, transfers);
  await assertServiceModesMatch(tx, cfg, fromBillId, toBillId);
  const edits = await requireBillEditors(
    tx,
    [fromBillId, toBillId],
    command.operatorId,
    command.expectedEdits,
  );
  await requireUnreservedTransfers(
    tx,
    fromBillId,
    transfers,
    edits.find((e) => e.billId === fromBillId)!,
  );

  const before = await readSentWork(tx, fromBillId);
  const { splitFrom } = await carveOffLines(tx, cfg, fromBillId, toBillId, transfers, {
    refuseHeld: false,
    actorId: command.operatorId,
  });
  await bumpRevision(tx, [fromBillId, toBillId]);
  await assertBillInvariant(tx, [fromBillId]);
  await enqueueMovedSlips(tx, cfg, before, toBillId, splitFrom);
}

/**
 * The line numbers of `lineIds`, each a dish of `billId`, in the order named, and whether any is
 * recalled into a draft. The ids travel as one JSON value, so they take one bound value however many
 * are named.
 */
async function resolveMoveLines(
  tx: Transaction,
  billId: string,
  lineIds: readonly string[],
): Promise<{ transfers: { lineNo: number }[]; recalled: boolean }> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      recalled: isRecalledDish(tx).mapWith(Boolean),
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        inArray(
          workingOrderLines.id,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const transfers = lineIds.map((lineId) => {
    const row = byId.get(lineId);
    if (row === undefined) throw new AppError("tab.line_not_found", { tabId: billId, lineId });
    if (row.parentLineId !== null) {
      throw new AppError("tab.transfer_modifier_line", { tabId: billId, lineNo: row.lineNo });
    }
    return { lineNo: row.lineNo };
  });
  assertDistinctTransferLines(billId, transfers);
  return { transfers, recalled: rows.some((row) => row.recalled) };
}

/**
 * Move the chosen dishes, whole and with their extras, from an open bill to another bill of its
 * party, or to a new bill (a new counter order when the bill has none). The source may be partly
 * paid: a paid dish stays (`bill.line_paid`) and the source keeps at least what it has received. An
 * existing destination may hold payments and owes more afterwards. To a new bill, a dish the kitchen holds outside a held
 * group is refused `tab.split_held_line`, as `splitBill` refuses it.
 */
export async function moveDishes(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  toBillId: string | null,
  lineIds: readonly string[],
  command: BillCommand & { expectedEdits: BillEditExpected[] },
): Promise<{ billId: string }> {
  if (lineIds.length === 0) throw new AppError("sale.empty_basket", {});
  if (toBillId === fromBillId) throw new AppError("tab.transfer_self", { tabId: fromBillId });
  const path = await guardPathParty(tx, fromBillId, command);
  refuseClosedBill(fromBillId, path.status);
  if (toBillId !== null) {
    if (path.partyId === null) {
      throw new AppError("bill.other_party", { workingOrderId: toBillId });
    }
    await requireBillOfParty(tx, path.partyId, toBillId);
    await assertServiceModesMatch(tx, cfg, fromBillId, toBillId);
  }
  const { transfers, recalled } = await resolveMoveLines(tx, fromBillId, lineIds);
  const edits = await requireBillEditors(
    tx,
    toBillId === null ? [fromBillId] : [fromBillId, toBillId],
    command.operatorId,
    command.expectedEdits,
  );
  if (recalled) {
    throw reservedRefusal(
      fromBillId,
      edits.find((edit) => edit.billId === fromBillId)!,
    );
  }

  let destinationId = toBillId;
  if (destinationId === null) {
    destinationId = randomUUID();
    await createOpenOrder(tx, cfg, destinationId, [], await orderTableLabel(tx, cfg, fromBillId), {
      partyId: path.partyId,
      existingService: true,
      copyServiceContextFrom: fromBillId,
    });
    if (path.partyId === null)
      await inheritKitchenNote(
        tx,
        cfg,
        { workingOrderId: fromBillId },
        { workingOrderId: destinationId },
        "copy",
      );
  }
  const before = await readSentWork(tx, fromBillId);
  const { splitFrom } = await carveOffLines(tx, cfg, fromBillId, destinationId, transfers, {
    refuseHeld: toBillId === null,
    actorId: command.operatorId,
  });
  await bumpRevision(tx, [fromBillId, destinationId]);
  await assertBillInvariant(tx, [fromBillId]);
  await enqueueMovedSlips(tx, cfg, before, destinationId, splitFrom);
  return { billId: destinationId };
}

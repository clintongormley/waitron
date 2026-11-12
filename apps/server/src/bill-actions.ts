import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
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
import { requireBillEditors } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { carryMergeInvoice, checkMergeInvoice } from "./merge-invoice.js";
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
 * Merge bills and move dishes between the bills of one party. When the path bill belongs to a
 * party, each checks that party's revision before either bill's own state, so of two tills acting
 * from one read the second is refused `party.out_of_date` whichever ran first, never a code
 * describing what the first did.
 */

export interface BillCommand {
  expectedPartyRevision?: number;
  /** The party the till read the path bill under. */
  partyId?: string;
  operatorId: string;
}

type Transfers = { lineNo: number }[];

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
 * Move every line of `fromBillId` onto `intoBillId` and abandon it, which files nothing. Both must be
 * open bills of one party; the bill merged away must hold no payment.
 */
export async function mergeBills(
  tx: Transaction,
  cfg: TradingContext,
  intoBillId: string,
  fromBillId: string,
  command: BillCommand & {
    expectedEdits: BillEditExpected[];
    admission: TradingAdmission;
    invoiceChoice?: unknown;
  },
  attendance?: OrderAttendance,
): Promise<void> {
  await requireEconomicWrite(tx, cfg, command.admission);
  if (intoBillId === fromBillId) throw new AppError("tab.merge_self", { tabId: intoBillId });
  const path = await guardPathParty(tx, intoBillId, command);
  if (path.partyId === null) throw new AppError("bill.other_party", { workingOrderId: fromBillId });
  await requireBillOfParty(tx, path.partyId, fromBillId);
  await refuseBillWithPayments(tx, fromBillId);
  refuseClosedBill(intoBillId, path.status);
  await assertServiceModesMatch(tx, fromBillId, intoBillId);
  await mergeCheckedBills(tx, cfg, intoBillId, fromBillId, {
    operatorId: command.operatorId,
    expectedEdits: command.expectedEdits,
    invoiceChoice: command.invoiceChoice,
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
 * open bills of one party, in one service mode, with no payment on the bill merged away.
 * `known.invoiceChoice` is the request's, checked here by {@link checkMergeInvoice}.
 * `known.kitchenTold` is set by a caller that tells the kitchen of `fromBillId`'s sent dishes itself,
 * from what it read before `fromBillId` joined the party.
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
    invoiceChoice: unknown;
  },
): Promise<void> {
  const invoices = await checkMergeInvoice(tx, intoBillId, fromBillId, known.invoiceChoice);
  await requireBillEditors(tx, [fromBillId, intoBillId], known.operatorId, known.expectedEdits);
  // Before the lines move: their check of the simplified-invoice limit reads the kept invoice type.
  await carryMergeInvoice(tx, intoBillId, invoices);
  const before = known.kitchenTold === true ? null : await readSentWork(tx, fromBillId);
  await moveOrderLines(tx, cfg, fromBillId, intoBillId, undefined, {
    actorId: known.operatorId,
  });
  await moveDraftsToBill(
    tx,
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
 * The ids travel as one JSON value, so they take one bound value however many are named.
 */
export async function resolveMoveLines(
  tx: Transaction,
  billId: string,
  lineIds: readonly string[],
): Promise<{ transfers: { lineNo: number }[] }> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
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
  return { transfers };
}

/**
 * Move the chosen dishes, whole and with their extras, from an open bill to another bill of its
 * party, or to a new bill (a new counter order when the bill has none). The source may be partly
 * paid: a paid dish stays (`bill.line_paid`) and the source keeps at least what it has received. An
 * existing destination may hold payments and owes more afterwards.
 */
export async function moveDishes(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  toBillId: string | null,
  lineIds: readonly string[],
  command: BillCommand & { expectedEdits: BillEditExpected[]; admission: TradingAdmission },
): Promise<{ billId: string }> {
  await requireEconomicWrite(tx, cfg, command.admission);
  if (lineIds.length === 0) throw new AppError("sale.empty_basket", {});
  if (toBillId === fromBillId) throw new AppError("tab.transfer_self", { tabId: fromBillId });
  const path = await guardPathParty(tx, fromBillId, command);
  refuseClosedBill(fromBillId, path.status);
  if (toBillId !== null) {
    if (path.partyId === null) {
      throw new AppError("bill.other_party", { workingOrderId: toBillId });
    }
    await requireBillOfParty(tx, path.partyId, toBillId);
    await assertServiceModesMatch(tx, fromBillId, toBillId);
  }
  const { transfers } = await resolveMoveLines(tx, fromBillId, lineIds);
  await requireBillEditors(
    tx,
    toBillId === null ? [fromBillId] : [fromBillId, toBillId],
    command.operatorId,
    command.expectedEdits,
  );

  let destinationId = toBillId;
  if (destinationId === null) {
    destinationId = randomUUID();
    await createOpenOrder(tx, cfg, destinationId, [], await orderTableLabel(tx, fromBillId), {
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
  await moveCheckedDishes(tx, cfg, fromBillId, destinationId, transfers, {
    actorId: command.operatorId,
  });
  await assertBillInvariant(tx, [fromBillId]);
  await enqueueMovedSlips(tx, cfg, before, destinationId);
  return { billId: destinationId };
}

/**
 * {@link moveDishes} after its checks: the dishes cross, and both bills count one more write,
 * refused on a bill being paid. The caller runs `assertBillInvariant` once its source has lost all
 * it will lose, and tells the kitchen.
 */
export async function moveCheckedDishes(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  toBillId: string,
  transfers: Transfers,
  options: { actorId: string },
): Promise<void> {
  await carveOffLines(tx, cfg, fromBillId, toBillId, transfers, options);
  await bumpRevision(tx, [fromBillId, toBillId]);
}

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { diningTables, orderGroups, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { assertBillInvariant, refuseBillWithPayments } from "./bill-payments.js";
import {
  enqueueMovedSlips,
  moveKitchenPrintLinks,
  orderTableLabel,
  readSentWork,
} from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  guardParties,
  readMainBill,
  refuseMovedParty,
  requireBillOfParty,
  setMainBill,
} from "./parties.js";
import type { TillConfig } from "./till-config.js";
import {
  assertDistinctTransferLines,
  assertServiceModesMatch,
  bumpRevision,
  carveOffLines,
  createOpenOrder,
  moveOrderLines,
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
  if (bill.partyId !== null) await guardParties(tx, bill.partyId, null, command);
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
 * Refuse `tab.split_held_line` for the lowest-numbered named line whose group is held. A dish with
 * no preparation gets no ticket item, so the unfired-ticket test in `carveOffLines` cannot see it.
 */
async function refuseHeldGroupLines(
  tx: Transaction,
  billId: string,
  transfers: Transfers,
): Promise<void> {
  const [held] = await tx
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        inArray(
          workingOrderLines.lineNo,
          transfers.map((t) => t.lineNo),
        ),
        eq(orderGroups.state, "held"),
      ),
    )
    .orderBy(workingOrderLines.lineNo)
    .limit(1);
  if (held !== undefined) {
    throw new AppError("tab.split_held_line", { tabId: billId, lineNo: held.lineNo });
  }
}

/**
 * Put the chosen items of an open bill on a new bill of the same party, or a new counter order when
 * the bill has none. A partly paid bill may be split; the items paid for stay (`bill.line_paid`).
 * Held work is never split off (owner ruling 2026-09-26).
 */
export async function splitBill(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  transfers: Transfers,
  command: BillCommand,
): Promise<{ billId: string }> {
  if (transfers.length === 0) throw new AppError("sale.empty_basket", {});
  assertDistinctTransferLines(billId, transfers);
  const path = await guardPathParty(tx, billId, command);
  refuseClosedBill(billId, path.status);
  await refuseHeldGroupLines(tx, billId, transfers);

  const newBillId = randomUUID();
  await createOpenOrder(tx, cfg, newBillId, [], await orderTableLabel(tx, cfg, billId), {
    partyId: path.partyId,
  });
  // The new bill takes the source's service mode, so `carveOffLines` needs no mode check.
  await VENUE_SERVICE.copyOrderContext(tx, cfg, billId, newBillId);
  await carveOffLines(tx, cfg, billId, newBillId, transfers, {
    refuseHeld: true,
    leavesParty: false,
  });
  await bumpRevision(tx, [billId, newBillId]);
  await assertBillInvariant(tx, [billId]);
  return { billId: newBillId };
}

/**
 * Move every line of `fromBillId` onto `intoBillId` and abandon it, which files nothing. Both must be
 * untouched bills of one party. The surviving bill becomes the main bill when the other was.
 */
export async function mergeBills(
  tx: Transaction,
  cfg: TillConfig,
  intoBillId: string,
  fromBillId: string,
  command: BillCommand,
): Promise<void> {
  if (intoBillId === fromBillId) throw new AppError("tab.merge_self", { tabId: intoBillId });
  const path = await guardPathParty(tx, intoBillId, command);
  const partyId = await requireUntouchedPair(tx, intoBillId, path, fromBillId);
  await assertServiceModesMatch(tx, cfg, fromBillId, intoBillId);
  await mergeCheckedBills(tx, cfg, partyId, intoBillId, fromBillId);
}

/**
 * {@link mergeBills} after its checks, for a caller that has made them itself: both bills are
 * untouched bills of `partyId`, in one service mode. `known.mainBillId` is the party's main bill as
 * the caller has just read it. `known.kitchenTold` is set by a caller that tells the kitchen of
 * `fromBillId`'s sent dishes itself, from what it read before `fromBillId` joined the party.
 */
export async function mergeCheckedBills(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  intoBillId: string,
  fromBillId: string,
  known: { mainBillId?: string | null; kitchenTold?: boolean } = {},
): Promise<void> {
  const mainBillId =
    known.mainBillId !== undefined ? known.mainBillId : await readMainBill(tx, partyId);
  const before = known.kitchenTold === true ? null : await readSentWork(tx, cfg, fromBillId);
  await moveOrderLines(tx, cfg, fromBillId, intoBillId, undefined, { modesChecked: true });
  await moveKitchenPrintLinks(tx, fromBillId, intoBillId);
  await bumpRevision(tx, [fromBillId, intoBillId]);
  await tx
    .update(workingOrders)
    .set({ status: "abandoned" })
    .where(eq(workingOrders.id, fromBillId));
  // While tables still point at bills, a table of the party showing the abandoned bill shows the
  // surviving one; its membership is unchanged.
  await tx
    .update(diningTables)
    .set({ tabId: intoBillId })
    .where(eq(diningTables.tabId, fromBillId));
  if (mainBillId === fromBillId) await setMainBill(tx, partyId, intoBillId);
  if (before !== null) await enqueueMovedSlips(tx, cfg, before, intoBillId);
}

/**
 * Move the chosen items from one untouched bill of a party to another. Whole lines move; a part of
 * a line splits it, keeping its unit prices.
 */
export async function transferItems(
  tx: Transaction,
  cfg: TillConfig,
  fromBillId: string,
  toBillId: string,
  transfers: Transfers,
  command: BillCommand,
): Promise<void> {
  if (fromBillId === toBillId) throw new AppError("tab.transfer_self", { tabId: fromBillId });
  if (transfers.length === 0) throw new AppError("sale.empty_basket", {});
  const path = await guardPathParty(tx, fromBillId, command);
  await requireUntouchedPair(tx, fromBillId, path, toBillId);
  assertDistinctTransferLines(fromBillId, transfers);
  await assertServiceModesMatch(tx, cfg, fromBillId, toBillId);

  const before = await readSentWork(tx, cfg, fromBillId);
  const { splitFrom } = await carveOffLines(tx, cfg, fromBillId, toBillId, transfers, {
    refuseHeld: false,
    leavesParty: false,
  });
  await bumpRevision(tx, [fromBillId, toBillId]);
  await assertBillInvariant(tx, [fromBillId]);
  await enqueueMovedSlips(tx, cfg, before, toBillId, splitFrom);
}

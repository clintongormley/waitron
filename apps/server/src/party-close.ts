import {
  type Transaction,
  diningTables,
  parties,
  workingOrders,
  workingOrderLines,
  ticketItems,
  nowIso,
  partyTables,
  unpaidDepartures,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { inArray, eq, and, isNull, sql } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { readPartyBillIds, requireBillEditors } from "./bill-editing.js";
import { refuseBillHoldingMoney } from "./bill-payments.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import { VENUE_SERVICE } from "./modules.js";
import { type BillEditExpected, discardPartyDrafts } from "./order-drafts.js";
import { readPartyTables } from "./orders-list.js";
import {
  leaveTables,
  checkAndBumpParty,
  partyFamily,
  memberTables,
  type PartyBill,
} from "./parties.js";
import "./errors.js";

/**
 * The tables' parties have left them: their memberships end, and each table whose department has
 * Needs clearing on needs clearing from `at` until {@link markTableCleared}.
 */
export async function leaveForClearing(
  tx: Transaction,
  tableIds: readonly string[],
  at: string,
): Promise<void> {
  await leaveTables(tx, tableIds, at);
  const clearing = await VENUE_SERVICE.readTablesNeedingClearing(tx, tableIds);
  if (clearing.size === 0) return;
  await tx
    .update(diningTables)
    .set({ needsClearingSince: at })
    .where(inArray(diningTables.id, [...clearing]));
}

export async function finishTable(
  tx: Transaction,
  args: {
    partyId: string;
    expectedPartyRevision: number;
    operatorId: string;
    expectedEdits: BillEditExpected[];
  },
  attendance?: { recorder: AttendanceRecorder },
): Promise<{ state: "closed" }> {
  const { partyId } = args;
  await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");

  const bills = await readFamilyBills(tx, await partyFamily(tx, partyId));
  if (bills.some(billOwes)) {
    throw new AppError("party.bill_outstanding", { partyId });
  }
  const empty = bills.filter((bill) => bill.status === "open").map((bill) => bill.id);
  const closed = await closeParty(
    tx,
    partyId,
    empty,
    args.operatorId,
    attendance,
    args.expectedEdits,
  );
  await handOverFinishedBills(tx, partyId);
  return closed;
}

export async function handOverFinishedBills(
  tx: Transaction,
  partyId: string,
  kitchenBillIds?: readonly string[],
): Promise<void> {
  const [party] = await tx
    .select({ closedAt: parties.closedAt })
    .from(parties)
    .where(eq(parties.id, partyId));
  const ids =
    kitchenBillIds ??
    (
      await tx
        .selectDistinct({ id: workingOrders.id })
        .from(workingOrders)
        .innerJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
        .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
        .where(
          and(
            inArray(workingOrders.partyId, await partyFamily(tx, partyId)),
            eq(workingOrders.status, "settled"),
            isNull(workingOrders.collectedAt),
          ),
        )
    ).map((bill) => bill.id);
  await tx
    .update(workingOrders)
    .set({ collectedAt: party!.closedAt })
    .where(and(inArray(workingOrders.id, [...ids]), isNull(workingOrders.collectedAt)));
}

export async function requirePartyClosingEdits(
  tx: Transaction,
  partyId: string,
  operatorId: string,
  expectedEdits: BillEditExpected[],
): Promise<void> {
  const bills = await readPartyBillIds(tx, await partyFamily(tx, partyId));
  await requireBillEditors(tx, bills, operatorId, expectedEdits);
  for (const billId of bills) await assertBillHasNoUnsent(tx, billId);
}

export async function closeParty(
  tx: Transaction,
  partyId: string,
  emptyBillIds: readonly string[],
  operatorId: string,
  attendance: { recorder: AttendanceRecorder } | undefined,
  expectedEdits: BillEditExpected[],
): Promise<{ state: "closed" }> {
  await requirePartyClosingEdits(tx, partyId, operatorId, expectedEdits);
  // An emptied bill can still hold a tip its refunded payment kept (design §2.3, §4.5).
  await refuseBillHoldingMoney(tx, emptyBillIds);
  if (emptyBillIds.length > 0) {
    await tx
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(inArray(workingOrders.id, [...emptyBillIds]));
  }

  const family = await partyFamily(tx, partyId);
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(inArray(workingOrders.partyId, family));
  await VENUE_SERVICE.withdrawPendingDepartmentTransfers(
    tx,
    bills.map((bill) => bill.id),
  );
  await discardPartyDrafts(tx, partyId, operatorId, attendance);

  const at = nowIso();
  const tables = await memberTables(tx, partyId);
  await tx
    .update(parties)
    .set({ state: "closed", closedAt: at, closedBy: operatorId })
    .where(eq(parties.id, partyId));
  await leaveForClearing(tx, tables, at);
  await closePartyTables(tx, partyId);
  return { state: "closed" };
}
/**
 * A closing party keeps the names of every table it ever held, in the order it joined them, and lets
 * go of its `party_tables` rows, so a table it held can later be removed.
 */
export async function closePartyTables(tx: Transaction, partyId: string): Promise<void> {
  const tableNames = (await readPartyTables(tx, [partyId])).get(partyId) ?? [];
  await tx.update(parties).set({ tableNames }).where(eq(parties.id, partyId));
  await tx.delete(partyTables).where(eq(partyTables.partyId, partyId));
}
/** Each bill of these parties with how many lines it holds. */
export async function readFamilyBills(
  tx: Transaction,
  family: readonly string[],
): Promise<{ id: string; status: PartyBill["status"]; lines: number; leftUnpaid: boolean }[]> {
  return tx
    .select({
      id: workingOrders.id,
      status: workingOrders.status,
      leftUnpaid: sql<boolean>`${unpaidDepartures.id} is not null`.mapWith(Boolean),
      lines: sql<number>`count(${workingOrderLines.id})`,
    })
    .from(workingOrders)
    .leftJoin(unpaidDepartures, eq(unpaidDepartures.workingOrderId, workingOrders.id))
    .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .where(inArray(workingOrders.partyId, [...family]))
    .groupBy(workingOrders.id);
}
/** A bill that still blocks finishing service; recorded debts are collected separately. */
export function billOwes(bill: {
  status: PartyBill["status"];
  lines: number;
  leftUnpaid?: boolean;
}): boolean {
  return (
    !bill.leftUnpaid && (bill.status === "placed" || (bill.status === "open" && bill.lines > 0))
  );
}
/** The table is ready for the next party. Clearing a table that does not need it is not refused. */
export async function markTableCleared(tx: Transaction, tableId: string): Promise<void> {
  const cleared = await tx
    .update(diningTables)
    .set({ needsClearingSince: null })
    .where(eq(diningTables.id, tableId))
    .returning({ id: diningTables.id });
  if (cleared.length === 0) throw new AppError("table.not_found", { tableId });
}

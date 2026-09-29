import { and, asc, eq, inArray } from "drizzle-orm";
import { diningTables, nowIso, parties, partyTables, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { mergeCheckedBills } from "./bill-actions.js";
import { enqueueMovedSlipsFor, readPartiesSentWork } from "./kitchen-print.js";
import {
  isUntouched,
  leaveParty,
  readTargetTable,
  refuseUnseatable,
  takeIntoParty,
  type BillState,
} from "./move-bill.js";
import { moveDraftsToParty } from "./order-drafts.js";
import { moveGroupsToParty } from "./order-groups.js";
import {
  checkAndBumpParty,
  leaveForClearing,
  leaveTables,
  memberTables,
  openParty,
  partyMainBill,
  partyZone,
  setMainBill,
} from "./parties.js";
import type { TillConfig } from "./till-config.js";
import { serviceModesMatch } from "./working-order.js";
import "./errors.js";

/**
 * Move guests, join tables and split a table (spec §6). Each checks the revision of the party in
 * the path, then of the party holding the target table, before any table's or bill's own state
 * (P27), so of two tills acting from one read the second is refused `party.out_of_date`.
 */

export interface TableActionOptions {
  bills: "merge" | "separate";
  /** The party in the path. */
  expectedPartyRevision: number;
  /** The party holding the target table, required when one does. */
  expectedOtherPartyRevision?: number;
  operatorId: string;
}

export interface TableActionResult {
  partyId: string;
  mainBillId: string | null;
  merged: boolean;
}

export interface CombineResult {
  merged: boolean;
  mainBillId: string | null;
  /** Each bill merged away, mapped to the bill it merged into. */
  mergedInto: Map<string, string>;
}

/**
 * The party moves off all its tables to `toTableId`. A table another party holds combines this
 * party into that one; the tables left behind need clearing where the venue's setting says so.
 */
export async function moveGuests(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  toTableId: string,
  options: TableActionOptions,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(
    tx,
    cfg,
    toTableId,
    partyId,
    options.expectedOtherPartyRevision,
  );
  if (table.holding !== null && table.holding !== partyId) {
    return combineAt(tx, cfg, partyId, table.holding, "leave", options);
  }
  const held = await memberTables(tx, partyId);
  if (table.holding === partyId && held.length === 1) {
    throw new AppError("table.already_in_party", { tableId: toTableId });
  }
  if (table.holding === null) await refuseUnseatable(tx, cfg, toTableId, table);

  const before = await readPartiesSentWork(tx, cfg, [partyId]);
  const zoneBefore = await partyZone(tx, cfg, partyId);
  const leaving = held.filter((id) => id !== toTableId);
  await leaveForClearing(tx, leaving, nowIso());
  const mainBillId = await mainBillOf(tx, partyId);
  if (table.holding === null) {
    await tx.insert(partyTables).values({ partyId, tableId: toTableId });
    // A turnover, as seating one: no manual status carries over to these guests.
    await tx
      .update(diningTables)
      .set({ tabId: mainBillId, statusId: null })
      .where(eq(diningTables.id, toTableId));
  }
  const zoneAfter = await partyZone(tx, cfg, partyId);
  if (zoneAfter !== null && zoneAfter !== zoneBefore) {
    await retargetOpenBills(tx, cfg, partyId, zoneAfter);
  }
  await enqueueMovedSlipsFor(tx, cfg, before);
  return { partyId, mainBillId, merged: false };
}

/**
 * `tableId` is added to the party; both stay. A table another party holds combines that party into
 * this one, with every table it holds. Tables in two service zones are refused.
 */
export async function joinTables(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(
    tx,
    cfg,
    tableId,
    partyId,
    options.expectedOtherPartyRevision,
  );
  if (table.holding === partyId) throw new AppError("table.already_in_party", { tableId });
  const zoneId = await partyZone(tx, cfg, partyId);
  if (zoneId !== null && table.zoneId !== null && zoneId !== table.zoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId,
      tableZoneId: table.zoneId,
    });
  }
  if (table.holding !== null) {
    return combineAt(tx, cfg, table.holding, partyId, "join", options);
  }
  await refuseUnseatable(tx, cfg, tableId, table);

  const before = await readPartiesSentWork(tx, cfg, [partyId]);
  await tx.insert(partyTables).values({ partyId, tableId });
  const mainBillId = await mainBillOf(tx, partyId);
  await tx.update(diningTables).set({ tabId: mainBillId }).where(eq(diningTables.id, tableId));
  await enqueueMovedSlipsFor(tx, cfg, before);
  return { partyId, mainBillId, merged: false };
}

/** {@link combineParties} as a table action: the kitchen is told of every sent dish that moved. */
async function combineAt(
  tx: Transaction,
  cfg: TillConfig,
  from: string,
  into: string,
  tables: "leave" | "join",
  options: TableActionOptions,
): Promise<TableActionResult> {
  const before = await readPartiesSentWork(tx, cfg, [from, into]);
  const combined = await combineParties(tx, cfg, {
    from,
    into,
    bills: options.bills,
    tables,
    operatorId: options.operatorId,
  });
  await enqueueMovedSlipsFor(tx, cfg, before, combined.mergedInto);
  return { partyId: into, mainBillId: combined.mainBillId, merged: combined.merged };
}

/**
 * Party `from` becomes part of `into` and closes, recorded as merged into it. Its groups and drafts
 * move, and its open and presented bills move across whole (P13); its paid and abandoned bills stay
 * on it and count through the family. The bill choice (P12): with `"merge"`, `from`'s main bill
 * merges into `into`'s when both are untouched and in one service mode; otherwise `into`'s main bill
 * stays, or, when it has none, `from`'s becomes main. `from`'s tables are left for clearing, or
 * join `into`. The caller has checked and moved on both parties' revisions, and tells the kitchen.
 */
export async function combineParties(
  tx: Transaction,
  cfg: TillConfig,
  args: {
    from: string;
    into: string;
    bills: "merge" | "separate";
    tables: "leave" | "join";
    operatorId: string;
  },
): Promise<CombineResult> {
  const { from, into } = args;
  const fromMain = await mainBillOf(tx, from);
  const intoMain = await mainBillOf(tx, into);
  await moveGroupsToParty(tx, from, into);
  await moveDraftsToParty(tx, from, into, args.operatorId);

  const zoneId = await partyZone(tx, cfg, into);
  let fromMainState: BillState | undefined;
  for (const billId of await billsTaking(tx, from, ["open", "placed"])) {
    // Whole groups travel with the party, so no bill leaves its group here.
    const state = await takeIntoParty(tx, cfg, billId, into, zoneId);
    if (billId === fromMain) fromMainState = state;
  }

  const mergedInto = new Map<string, string>();
  if (fromMain !== null && fromMainState !== undefined) {
    if (
      args.bills === "merge" &&
      intoMain !== null &&
      (await isUntouched(tx, fromMain, fromMainState)) &&
      (await isUntouched(tx, intoMain)) &&
      // A table bill sends nothing when it is paid, so a pay-first or invoice-first bill's unsent
      // dishes merged into it would never reach the kitchen.
      (await serviceModesMatch(tx, cfg, fromMain, intoMain))
    ) {
      await mergeCheckedBills(tx, cfg, into, intoMain, fromMain, {
        mainBillId: intoMain,
        kitchenTold: true,
      });
      mergedInto.set(fromMain, intoMain);
    } else if (intoMain === null && fromMainState.status === "open") {
      await setMainBill(tx, into, fromMain);
    }
  }

  const at = nowIso();
  const tables = await memberTables(tx, from);
  if (args.tables === "leave") {
    await leaveForClearing(tx, tables, at);
  } else if (tables.length > 0) {
    await leaveTables(tx, tables, at);
    await tx.insert(partyTables).values(tables.map((tableId) => ({ partyId: into, tableId })));
  }
  // Only after `from`'s memberships have ended: closing a party clears the manual status of every
  // table it still holds (`parties_clear_table_status`), which a joining table keeps.
  await tx
    .update(parties)
    .set({ state: "closed", closedAt: at, closedBy: args.operatorId, mergedIntoPartyId: into })
    .where(eq(parties.id, from));

  const mainBillId = await mainBillOf(tx, into);
  if (mainBillId !== null) await setMainBill(tx, into, mainBillId);
  return { merged: mergedInto.size > 0, mainBillId, mergedInto };
}

/**
 * `tableId` leaves the party and a new, unnamed party starts on it, taking `billId`, or a new empty
 * main bill when none is chosen. The chosen bill must be an open or presented bill of the party
 * other than its main bill, holding no dish held for the kitchen.
 */
export async function splitTable(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  tableId: string,
  billId: string | null,
  options: { expectedPartyRevision: number; operatorId: string },
): Promise<{ partyId: string; mainBillId: string | null }> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const held = await memberTables(tx, partyId);
  if (!held.includes(tableId)) throw new AppError("table.not_joined", { tableId, partyId });
  if (held.length === 1) throw new AppError("table.not_shared", { tableId, partyId });
  const partyMain = await mainBillOf(tx, partyId);
  const open = billId !== null && (await refuseUnsplittableBill(tx, partyId, partyMain, billId));
  if (billId !== null) await leaveParty(tx, billId);

  const before = await readPartiesSentWork(tx, cfg, [partyId]);
  await leaveTables(tx, [tableId]);
  const [table] = await tx
    .update(diningTables)
    .set({ tabId: null })
    .where(eq(diningTables.id, tableId))
    .returning({ zoneId: diningTables.zoneId });
  const { partyId: newParty } = await openParty(tx, {
    guestCount: null,
    operatorId: options.operatorId,
    tableId,
  });
  let mainBillId: string | null = null;
  if (billId === null) {
    mainBillId = await partyMainBill(tx, cfg, newParty, "moved");
  } else {
    await takeIntoParty(tx, cfg, billId, newParty, table!.zoneId);
    if (open) {
      await setMainBill(tx, newParty, billId);
      mainBillId = billId;
    }
  }
  if (partyMain !== null) await setMainBill(tx, partyId, partyMain);
  await enqueueMovedSlipsFor(tx, cfg, before);
  return { partyId: newParty, mainBillId };
}

/**
 * Refuse a bill Split a table cannot give the new party, in this order: another party's (or none),
 * paid, abandoned or missing, and the party's main bill. Answers whether it is open.
 */
async function refuseUnsplittableBill(
  tx: Transaction,
  partyId: string,
  partyMain: string | null,
  billId: string,
): Promise<boolean> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
  if (bill.partyId !== partyId) throw new AppError("bill.other_party", { workingOrderId: billId });
  if (bill.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (bill.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (billId === partyMain) throw new AppError("party.main_bill_stays", { partyId });
  return bill.status === "open";
}

async function mainBillOf(tx: Transaction, partyId: string): Promise<string | null> {
  const [party] = await tx
    .select({ mainBillId: parties.mainBillId })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party!.mainBillId;
}

async function billsTaking(
  tx: Transaction,
  partyId: string,
  statuses: ("open" | "placed")[],
): Promise<string[]> {
  const rows = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(eq(workingOrders.partyId, partyId), inArray(workingOrders.status, statuses)))
    .orderBy(asc(workingOrders.openedAt), asc(workingOrders.orderNumber));
  return rows.map((row) => row.id);
}

/** The party's open bills take `zoneId` for what is added later (P15), as a moved bill does. */
async function retargetOpenBills(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  zoneId: string,
): Promise<void> {
  for (const billId of await billsTaking(tx, partyId, ["open"])) {
    await takeIntoParty(tx, cfg, billId, partyId, zoneId);
  }
}

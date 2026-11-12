import { and, asc, eq, inArray } from "drizzle-orm";
import { diningTables, nowIso, parties, partyTables, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, MAX_GUEST_COUNT } from "@waitron/shared";
import { moveCheckedDishes, resolveMoveLines } from "./bill-actions.js";
import {
  readPartyBillIds,
  relocateBillEditor,
  requireRelocatableBillEditors,
  requireSplitEditors,
} from "./bill-editing.js";
import { assertBillInvariant } from "./bill-payments.js";
import type { BillEditExpected } from "./order-drafts.js";
import { leaveMergesRestoring, mergeMembers } from "./floor-today-merges.js";
import {
  leaveParty,
  readTargetTable,
  refuseUnseatable,
  takeIntoParty,
  type OtherPartyRead,
} from "./move-bill.js";
import { VENUE_SERVICE } from "./modules.js";
import { withMovedSlips, type SlipsLater } from "./moved-slips.js";
import { moveBillDraftsToParty, moveDraftsToParty } from "./order-drafts.js";
import {
  enqueueMovedSlipsFor,
  enqueueMovedSlipsForNamesGone,
  enqueueMovedSlipsOnto,
  readNamesOnPaper,
  readPartiesSentWork,
} from "./kitchen-print.js";
import { inheritKitchenNote } from "./order-kitchen-note.js";
import {
  copyHeldGroups,
  copyWaitingGroups,
  groupArrivingDishes,
  moveGroupsToParty,
  printHoldTickets,
  type Firer,
} from "./order-groups.js";
import {
  checkAndBumpParty,
  ensureFamilyBill,
  closePartyTables,
  leaveForClearing,
  leaveTables,
  memberTables,
  notAbandonedInFamily,
  insertPartyBill,
  openParty,
  partyFamily,
  partyZone,
  requireBillOfParty,
} from "./parties.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import type { OrderAttendance } from "./working-order.js";
import "./errors.js";

/**
 * Move guests, join tables and split a table (spec §6). Each checks the revision of the party in
 * the path; a move or join then checks that the party the till read at the target table still holds
 * it, and that party's revision, before any table's or bill's own state (P27), so of two tills
 * acting from one read the second is refused `party.out_of_date`.
 */

export interface TableActionOptions extends OtherPartyRead {
  expectedEdits: BillEditExpected[];
  /** The party in the path. */
  expectedPartyRevision: number;
  operatorId: string;
  /** Honoured by a join, which then tells the kitchen nothing. */
  slipsLater?: SlipsLater;
}

export interface TableActionResult {
  partyId: string;
  /** The party's bills that are not abandoned, its family's included, in number order; never empty. */
  billIds: string[];
}

/**
 * The party moves off all its tables to `toTableId`. A table another party holds combines this
 * party into that one; the tables left behind need clearing where their department has Needs
 * clearing on.
 */
export async function moveGuests(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  toTableId: string,
  options: TableActionOptions,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(tx, toTableId, partyId, options);
  const zoneBefore = await partyZone(tx, partyId);
  if (table.zoneId !== zoneBefore)
    await VENUE_SERVICE.assertZoneTakesNewOrders(tx, table.zoneId, new Date());
  const held = await memberTables(tx, partyId);
  if (table.holding !== null && table.holding !== partyId) {
    const combined = await combineAt(tx, cfg, partyId, table.holding, "leave", options);
    await leaveMergeOf(tx, toTableId, held);
    return combined;
  }
  if (table.holding === partyId && held.length === 1) {
    throw new AppError("table.already_in_party", { tableId: toTableId });
  }
  if (table.holding === null) await refuseUnseatable(tx, table);

  await requireRelocatableBillEditors(
    tx,
    await readPartyBillIds(tx, [partyId]),
    options.operatorId,
    options.expectedEdits,
  );
  return withMovedSlips(tx, cfg, { parties: [partyId] }, async () => {
    const leaving = held.filter((id) => id !== toTableId);
    await leaveForClearing(tx, leaving, nowIso());
    if (table.holding === null) {
      await addTable(tx, partyId, toTableId);
    }
    // The table moved to is now the party's only one.
    if (table.zoneId !== zoneBefore) {
      await retargetUnsettledBills(tx, cfg, partyId, table.zoneId);
    }
    await leaveMergeOf(tx, toTableId, held);
    for (const expected of options.expectedEdits)
      await relocateBillEditor(tx, expected.billId, expected);
    return { partyId, billIds: await shownBillIds(tx, cfg, partyId) };
  });
}

/** Only a party staying on part of its merge breaks it up; a merge left whole stays, free. */
async function leaveMergeOf(
  tx: Transaction,
  tableId: string,
  held: readonly string[],
): Promise<void> {
  const merged = await mergeMembers(tx, tableId);
  await leaveMergesRestoring(
    tx,
    held.filter((id) => id !== tableId && merged.includes(id)),
  );
}

/**
 * `tableId` is added to the party; both stay. A table another party holds combines that party into
 * this one, with every table it holds. Tables in two service zones are refused.
 */
export async function joinTables(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(tx, tableId, partyId, options);
  if (table.holding === partyId) throw new AppError("table.already_in_party", { tableId });
  const zoneId = await partyZone(tx, partyId);
  if (zoneId !== null && zoneId !== table.zoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId,
      tableZoneId: table.zoneId,
    });
  }
  if (table.holding !== null) {
    return combineAt(tx, cfg, table.holding, partyId, "join", options, zoneId);
  }
  await refuseUnseatable(tx, table);

  await requireRelocatableBillEditors(
    tx,
    await readPartyBillIds(tx, [partyId]),
    options.operatorId,
    options.expectedEdits,
  );
  const reach =
    options.slipsLater === undefined ? { parties: [partyId] } : { later: options.slipsLater };
  return withMovedSlips(tx, cfg, reach, async () => {
    await addTable(tx, partyId, tableId);
    return { partyId, billIds: await shownBillIds(tx, cfg, partyId) };
  });
}

/** {@link combineParties} as a table action. */
async function combineAt(
  tx: Transaction,
  cfg: OriginConfig,
  from: string,
  into: string,
  tables: "leave" | "join",
  options: TableActionOptions,
  intoZoneId?: string | null,
): Promise<TableActionResult> {
  const reach =
    options.slipsLater === undefined ? { parties: [from, into] } : { later: options.slipsLater };
  return withMovedSlips(tx, cfg, reach, async () => {
    await combineParties(tx, cfg, {
      from,
      into,
      tables,
      operatorId: options.operatorId,
      expectedEdits: options.expectedEdits,
      intoZoneId,
    });
    return { partyId: into, billIds: await shownBillIds(tx, cfg, into) };
  });
}

function combinedGuests(from: number | null, into: number | null): number | null {
  if (from === null || into === null) return null;
  const sum = from + into;
  return sum <= MAX_GUEST_COUNT ? sum : null;
}

/**
 * Party `from` becomes part of `into` and closes, recorded as merged into it. Its groups and drafts
 * move, and its open and presented bills move across whole (P13); its paid and abandoned bills stay
 * on it and count through the family. No bill merges (spec §3.4). `from`'s tables are left
 * for clearing, or join `into`. The caller has checked and moved on both parties' revisions, and
 * tells the kitchen.
 */
export async function combineParties(
  tx: Transaction,
  cfg: TradingContext,
  args: {
    from: string;
    into: string;
    expectedEdits: BillEditExpected[];
    tables: "leave" | "join";
    operatorId: string;
    /** `into`'s zone, when the caller has just read it. */
    intoZoneId?: string | null;
  },
): Promise<void> {
  const { from, into } = args;
  const guests = await tx
    .select({ id: parties.id, guestCount: parties.guestCount })
    .from(parties)
    .where(inArray(parties.id, [from, into]));
  const partyOf = (partyId: string) => guests.find((party) => party.id === partyId)!;
  await requireRelocatableBillEditors(
    tx,
    await readPartyBillIds(tx, [from, into]),
    args.operatorId,
    args.expectedEdits,
  );
  const zoneId = args.intoZoneId !== undefined ? args.intoZoneId : await partyZone(tx, into);
  await inheritKitchenNote(tx, cfg, { partyId: from }, { partyId: into }, "combine");
  await VENUE_SERVICE.mergePartyAllergies(tx, from, into, args.operatorId);
  await moveGroupsToParty(tx, from, into);
  const movingBills = await billsTaking(tx, from, ["open", "placed"]);
  for (const billId of movingBills) {
    // Whole groups travel with the party, so no bill leaves its group here.
    await takeIntoParty(tx, cfg, billId, into, zoneId);
  }

  await VENUE_SERVICE.rescopeBillNumbers(tx, from, into);
  await moveDraftsToParty(
    tx,
    from,
    into,
    args.expectedEdits.filter((edit) => movingBills.includes(edit.billId)),
  );

  const at = nowIso();
  const tables = await memberTables(tx, from);
  if (args.tables === "leave") {
    await leaveForClearing(tx, tables, at);
  } else if (tables.length > 0) {
    await leaveTables(tx, tables, at);
    const joinedAt = (i: number) => new Date(Date.parse(at) + i).toISOString();
    await tx
      .insert(partyTables)
      .values(tables.map((tableId, i) => ({ partyId: into, tableId, joinedAt: joinedAt(i) })));
  }
  await tx
    .update(parties)
    .set({ guestCount: combinedGuests(partyOf(from).guestCount, partyOf(into).guestCount) })
    .where(eq(parties.id, into));
  await tx
    .update(parties)
    .set({ state: "closed", closedAt: at, closedBy: args.operatorId, mergedIntoPartyId: into })
    .where(eq(parties.id, from));
  await closePartyTables(tx, from);
}

export interface SplitGuestCounts {
  staying: number | null;
  leaving: number | null;
}

/** Which bills go whole, and which dishes go loose, to the party Split a table starts. */
export interface SplitSelection {
  wholeBillIds: string[];
  loose: { billId: string; lineIds: string[] }[];
}

/**
 * `tableId` leaves the party and its today's merge ({@link leaveMergesRestoring}), and a new,
 * unnamed party starts on it, taking the selection's whole bills and one new bill holding its loose
 * dishes, or a new empty bill when nothing is selected. A whole bill must be an open or presented
 * bill of the party; it takes its next number at the new party in its old number order, and keeps
 * its payments. A loose source must be an open bill of the party; its dishes move as
 * {@link moveCheckedDishes} moves them, and the new bill numbers last, at the new party, so the
 * staying table's numbers keep no gap. Held dishes move to one held copy
 * of each of their groups, however many of the bills share it ({@link copyHeldGroups}), and
 * dishes `waitingDishesOnHoldPaper` keeps in a fired group to a fired copy of theirs
 * ({@link copyWaitingGroups}); the rest of each bill's dishes group as that bill arrives
 * ({@link groupArrivingDishes}). A staying party whose family is left with no bill that is not
 * abandoned is given a new empty one. The answer's `billIds` are the new party's bills in number
 * order, and `looseSourceIds` the bills that lost loose dishes.
 */
export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  selection: SplitSelection,
  options: {
    expectedPartyRevision: number;
    operatorId: string;
    guestCounts?: SplitGuestCounts;
    expectedEdits: BillEditExpected[];
  },
  attendance?: OrderAttendance,
): Promise<{ partyId: string; billIds: string[]; looseSourceIds: string[] }> {
  await checkAndBumpParty(
    tx,
    partyId,
    options.expectedPartyRevision,
    "open",
    options.guestCounts === undefined ? {} : { guestCount: options.guestCounts.staying },
  );
  const held = await memberTables(tx, partyId);
  if (!held.includes(tableId)) throw new AppError("table.not_joined", { tableId, partyId });
  if (held.length === 1) throw new AppError("table.not_shared", { tableId, partyId });
  const { wholeBillIds, loose } = selection;
  const looseIds = loose.map((entry) => entry.billId);
  const named = [...wholeBillIds, ...looseIds];
  if (new Set(named).size !== named.length || loose.some((entry) => entry.lineIds.length === 0))
    throw new AppError("management.request_invalid", { field: "selection" });
  await requireSplitEditors(tx, wholeBillIds, looseIds, options.operatorId, options.expectedEdits);
  for (const billId of wholeBillIds) await refuseUnsplittableBill(tx, partyId, billId);
  const looseSourceIds = await inNumberOrder(tx, looseIds);
  const looseMoves: { billId: string; transfers: { lineNo: number }[] }[] = [];
  for (const billId of looseSourceIds) {
    await requireBillOfParty(tx, partyId, billId);
    const { lineIds } = loose.find((entry) => entry.billId === billId)!;
    const { transfers } = await resolveMoveLines(tx, billId, lineIds);
    looseMoves.push({ billId, transfers });
  }
  const leaving: { billId: string; firers: ReadonlyMap<string, Firer> }[] = [];
  const heldLineIds: string[] = [];
  const waitingLineIds: string[] = [];
  for (const billId of await inNumberOrder(tx, wholeBillIds)) {
    const left = await leaveParty(tx, billId, "keep", { keepWaiting: true });
    leaving.push({ billId, firers: left.firers });
    heldLineIds.push(...left.heldLineIds);
    waitingLineIds.push(...left.waitingLineIds);
  }

  // Read while held dishes, and dishes waiting on HOLD paper, are still in their groups and loose
  // dishes still on their sources: what the kitchen is told at the end is measured against this.
  const sentWork = await readPartiesSentWork(tx, [partyId]);
  const wholeIds = new Set(wholeBillIds);
  const notWhole = new Map([...sentWork].filter(([billId]) => !wholeIds.has(billId)));
  const namesOnPaper = await readNamesOnPaper(tx, notWhole, tableId);
  await leaveTables(tx, [tableId]);
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  const { partyId: newParty } = await openParty(tx, {
    guestCount: options.guestCounts?.leaving ?? null,
    operatorId: options.operatorId,
    tableId,
  });
  await inheritKitchenNote(tx, cfg, { partyId }, { partyId: newParty }, "copy");
  for (const { billId } of leaving) await VENUE_SERVICE.allocateBillNumber(tx, billId, newParty);
  const arriving = [...leaving];
  let newBill: string | null = null;
  if (looseMoves.length > 0) {
    newBill = await insertPartyBill(tx, cfg, newParty);
    for (const { billId, transfers } of looseMoves) {
      await moveCheckedDishes(tx, cfg, billId, newBill, transfers, {
        actorId: options.operatorId,
      });
    }
    await assertBillInvariant(tx, looseSourceIds);
    const left = await leaveParty(tx, newBill, "keep", { keepWaiting: true });
    arriving.push({ billId: newBill, firers: left.firers });
    heldLineIds.push(...left.heldLineIds);
    waitingLineIds.push(...left.waitingLineIds);
  }
  await VENUE_SERVICE.splitPartyAllergies(
    tx,
    partyId,
    newParty,
    arriving.map(({ billId }) => billId),
    options.operatorId,
  );
  if (arriving.length === 0) await insertPartyBill(tx, cfg, newParty);
  for (const { billId } of leaving) {
    await takeIntoParty(tx, cfg, billId, newParty, table!.zoneId);
    await moveBillDraftsToParty(
      tx,
      billId,
      newParty,
      options.expectedEdits.find((edit) => edit.billId === billId)!,
    );
  }
  const activity =
    attendance === undefined
      ? undefined
      : {
          recorder: attendance.recorder,
          at: attendance.clock.now().instant.toISOString(),
        };
  const heldGroups: string[] = [];
  for (const { billId, firers } of arriving) {
    const { held: groups } = await groupArrivingDishes(
      tx,
      cfg,
      newParty,
      billId,
      options.operatorId,
      firers,
      activity,
    );
    heldGroups.push(...groups);
  }
  await copyWaitingGroups(tx, partyId, newParty, waitingLineIds, options.operatorId, activity);
  await copyHeldGroups(tx, partyId, newParty, heldLineIds, options.operatorId, activity);
  await printHoldTickets(tx, cfg, heldGroups);
  if (leaving.length > 0) await ensureFamilyBill(tx, cfg, partyId);
  await leaveMergesRestoring(tx, [tableId]);
  await enqueueMovedSlipsFor(
    tx,
    cfg,
    new Map([...sentWork].filter(([billId]) => wholeIds.has(billId))),
  );
  if (newBill !== null)
    await enqueueMovedSlipsOnto(
      tx,
      cfg,
      newBill,
      looseMoves.map(({ billId }) => sentWork.get(billId) ?? null),
    );
  await enqueueMovedSlipsForNamesGone(tx, cfg, notWhole, namesOnPaper);
  return {
    partyId: newParty,
    billIds: await shownBillIds(tx, cfg, newParty),
    looseSourceIds,
  };
}

/**
 * Refuse a bill Split a table cannot give the new party, in this order: another party's (or none),
 * paid, abandoned or missing.
 */
async function refuseUnsplittableBill(
  tx: Transaction,
  partyId: string,
  billId: string,
): Promise<void> {
  const [bill] = await tx
    .select({ partyId: workingOrders.partyId, status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill === undefined) throw new AppError("tab.not_open", { tabId: billId });
  if (bill.partyId !== partyId) throw new AppError("bill.other_party", { workingOrderId: billId });
  if (bill.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (bill.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
}

/**
 * The family's bills that are not abandoned, in number order (unnumbered last, then by id). A
 * party whose family has none is first given one new empty bill, as {@link ensureFamilyBill} does.
 */
async function shownBillIds(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(notAbandonedInFamily(await partyFamily(tx, partyId)));
  if (rows.length === 0) return [await insertPartyBill(tx, cfg, partyId)];
  return inNumberOrder(
    tx,
    rows.map((row) => row.id),
  );
}

/** The bills in number order, unnumbered last, then by id. */
async function inNumberOrder(tx: Transaction, billIds: readonly string[]): Promise<string[]> {
  const numbers = await VENUE_SERVICE.readBillIdentities(tx, billIds);
  const numberOf = (id: string) => numbers.get(id)?.number ?? Number.POSITIVE_INFINITY;
  return [...billIds].sort((a, b) => numberOf(a) - numberOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

async function addTable(tx: Transaction, partyId: string, tableId: string): Promise<void> {
  await tx.insert(partyTables).values({ partyId, tableId });
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

/**
 * The party's open and presented bills take `zoneId`, as a bill moved into a party does; a settled
 * bill keeps the zone it was paid in.
 */
async function retargetUnsettledBills(
  tx: Transaction,
  cfg: TradingContext,
  partyId: string,
  zoneId: string,
): Promise<void> {
  for (const billId of await billsTaking(tx, partyId, ["open", "placed"])) {
    await takeIntoParty(tx, cfg, billId, partyId, zoneId);
  }
}

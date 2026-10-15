import { and, asc, eq, inArray } from "drizzle-orm";
import { diningTables, nowIso, parties, partyTables, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, MAX_GUEST_COUNT } from "@waitron/shared";
import { mergeCheckedBills } from "./bill-actions.js";
import { leaveMergesRestoring, mergeMembers } from "./floor-today-merges.js";
import {
  isUntouched,
  leaveParty,
  readTargetTable,
  refuseUnseatable,
  takeIntoParty,
  type BillState,
  type OtherPartyRead,
} from "./move-bill.js";
import { VENUE_SERVICE } from "./modules.js";
import { withMovedSlips, type SlipsLater } from "./moved-slips.js";
import { moveDraftsToParty } from "./order-drafts.js";
import {
  groupArrivingDishes,
  moveGroupsToParty,
  printHoldTickets,
  type Firer,
} from "./order-groups.js";
import {
  checkAndBumpParty,
  closePartyTables,
  leaveForClearing,
  leaveTables,
  memberTables,
  openParty,
  partyMainBill,
  partyZone,
  readMainBill,
  setMainBill,
} from "./parties.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import { serviceModesMatch } from "./working-order.js";
import type { OrderAttendance } from "./working-order.js";
import "./errors.js";

/**
 * Move guests, join tables and split a table (spec §6). Each checks the revision of the party in
 * the path; a move or join then checks that the party the till read at the target table still holds
 * it, and that party's revision, before any table's or bill's own state (P27), so of two tills
 * acting from one read the second is refused `party.out_of_date`.
 */

export interface TableActionOptions extends OtherPartyRead {
  bills: "merge" | "separate";
  /** The party in the path. */
  expectedPartyRevision: number;
  operatorId: string;
  /** Honoured by a join, which then tells the kitchen nothing. */
  slipsLater?: SlipsLater;
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
  attendance?: OrderAttendance,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(tx, cfg, toTableId, partyId, options);
  const zoneBefore = await partyZone(tx, cfg, partyId);
  if (table.zoneId !== zoneBefore)
    await VENUE_SERVICE.assertZoneTakesNewOrders(tx, cfg, table.zoneId, new Date());
  const held = await memberTables(tx, partyId);
  if (table.holding !== null && table.holding !== partyId) {
    const combined = await combineAt(
      tx,
      cfg,
      partyId,
      table.holding,
      "leave",
      options,
      undefined,
      attendance,
    );
    await leaveMergeOf(tx, toTableId, held);
    return combined;
  }
  if (table.holding === partyId && held.length === 1) {
    throw new AppError("table.already_in_party", { tableId: toTableId });
  }
  if (table.holding === null) await refuseUnseatable(tx, cfg, table);

  return withMovedSlips(tx, cfg, { parties: [partyId] }, async () => {
    const leaving = held.filter((id) => id !== toTableId);
    await leaveForClearing(tx, leaving, nowIso());
    const mainBillId = await readMainBill(tx, partyId);
    // A turnover, as seating one: no manual status carries over to these guests.
    if (table.holding === null) {
      await addTable(tx, partyId, toTableId, { clearStatus: true });
    }
    // The table moved to is now the party's only one.
    if (table.zoneId !== zoneBefore) {
      await retargetUnsettledBills(tx, cfg, partyId, table.zoneId);
    }
    await leaveMergeOf(tx, toTableId, held);
    return { partyId, mainBillId, merged: false };
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
  cfg: TillConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
  attendance?: OrderAttendance,
): Promise<TableActionResult> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const table = await readTargetTable(tx, cfg, tableId, partyId, options);
  if (table.holding === partyId) throw new AppError("table.already_in_party", { tableId });
  const zoneId = await partyZone(tx, cfg, partyId);
  if (zoneId !== null && zoneId !== table.zoneId) {
    throw new AppError("service_zone.join_mismatch", {
      orderZoneId: zoneId,
      tableZoneId: table.zoneId,
    });
  }
  if (table.holding !== null) {
    return combineAt(tx, cfg, table.holding, partyId, "join", options, zoneId, attendance);
  }
  await refuseUnseatable(tx, cfg, table);

  const reach =
    options.slipsLater === undefined ? { parties: [partyId] } : { later: options.slipsLater };
  return withMovedSlips(tx, cfg, reach, async () => {
    const mainBillId = await readMainBill(tx, partyId);
    await addTable(tx, partyId, tableId, { clearStatus: false });
    return { partyId, mainBillId, merged: false };
  });
}

/** {@link combineParties} as a table action. */
async function combineAt(
  tx: Transaction,
  cfg: TillConfig,
  from: string,
  into: string,
  tables: "leave" | "join",
  options: TableActionOptions,
  intoZoneId?: string | null,
  attendance?: OrderAttendance,
): Promise<TableActionResult> {
  const reach =
    options.slipsLater === undefined ? { parties: [from, into] } : { later: options.slipsLater };
  return withMovedSlips(tx, cfg, reach, async (slips) => {
    const combined = await combineParties(
      tx,
      cfg,
      {
        from,
        into,
        bills: options.bills,
        tables,
        operatorId: options.operatorId,
        intoZoneId,
      },
      attendance,
    );
    for (const [billId, intoBillId] of combined.mergedInto)
      slips.mergedInto.set(billId, intoBillId);
    return { partyId: into, mainBillId: combined.mainBillId, merged: combined.merged };
  });
}

/** Both counts added, or none when either is unknown or the sum is more than a count can be. */
function combinedGuests(from: number | null, into: number | null): number | null {
  if (from === null || into === null) return null;
  const sum = from + into;
  return sum <= MAX_GUEST_COUNT ? sum : null;
}

/**
 * Party `from` becomes part of `into` and closes, recorded as merged into it. Its groups and drafts
 * move, and its open and presented bills move across whole (P13); its paid and abandoned bills stay
 * on it and count through the family. The bill choice (P12): with `"merge"`, `from`'s main bill
 * merges into `into`'s when both are untouched and in one service mode; otherwise `into`'s main
 * bill stays, or, when it has none, `from`'s becomes main if it is open. `from`'s tables are left
 * for clearing, or join `into`. The caller has checked and moved on both parties' revisions, and
 * tells the kitchen.
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
    /** `into`'s zone, when the caller has just read it. */
    intoZoneId?: string | null;
  },
  attendance?: OrderAttendance,
): Promise<CombineResult> {
  const { from, into } = args;
  const mains = await tx
    .select({ id: parties.id, mainBillId: parties.mainBillId, guestCount: parties.guestCount })
    .from(parties)
    .where(inArray(parties.id, [from, into]));
  const partyOf = (partyId: string) => mains.find((party) => party.id === partyId)!;
  const fromMain = partyOf(from).mainBillId;
  const intoMain = partyOf(into).mainBillId;
  await moveGroupsToParty(tx, from, into);
  await moveDraftsToParty(
    tx,
    from,
    into,
    args.operatorId,
    attendance === undefined
      ? undefined
      : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
  );

  const zoneId = args.intoZoneId !== undefined ? args.intoZoneId : await partyZone(tx, cfg, into);
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
    const joinedAt = (i: number) => new Date(Date.parse(at) + i).toISOString();
    await tx
      .insert(partyTables)
      .values(tables.map((tableId, i) => ({ partyId: into, tableId, joinedAt: joinedAt(i) })));
  }
  await tx
    .update(parties)
    .set({ guestCount: combinedGuests(partyOf(from).guestCount, partyOf(into).guestCount) })
    .where(eq(parties.id, into));
  // Only after `from`'s memberships have ended: closing a party clears the manual status of every
  // table it still holds (`parties_clear_table_status`), which a joining table keeps.
  await tx
    .update(parties)
    .set({ state: "closed", closedAt: at, closedBy: args.operatorId, mergedIntoPartyId: into })
    .where(eq(parties.id, from));
  await closePartyTables(tx, from);

  return { merged: mergedInto.size > 0, mainBillId: await readMainBill(tx, into), mergedInto };
}

/** The guest counts the waiter gives each side of Split a table; null leaves one unknown. */
export interface SplitGuests {
  staying: number | null;
  leaving: number | null;
}

/**
 * `tableId` leaves the party and its today's merge ({@link leaveMergesRestoring}), and a new,
 * unnamed party starts on it, taking `billId`, or a new empty main bill when none is chosen. The
 * chosen bill must be an open or presented bill of the party other than its main bill, holding no
 * dish held for the kitchen.
 */
export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  billId: string | null,
  options: { expectedPartyRevision: number; operatorId: string; guests?: SplitGuests },
  attendance?: OrderAttendance,
): Promise<{ partyId: string; mainBillId: string | null }> {
  await checkAndBumpParty(tx, partyId, options.expectedPartyRevision, "open");
  const held = await memberTables(tx, partyId);
  if (!held.includes(tableId)) throw new AppError("table.not_joined", { tableId, partyId });
  if (held.length === 1) throw new AppError("table.not_shared", { tableId, partyId });
  const partyMain = await readMainBill(tx, partyId);
  let firers: ReadonlyMap<string, Firer> = new Map();
  if (billId !== null) {
    await refuseUnsplittableBill(tx, partyId, partyMain, billId);
    firers = await leaveParty(tx, billId);
  }

  return withMovedSlips(tx, cfg, { parties: [partyId] }, async () => {
    await leaveTables(tx, [tableId]);
    const [table] = await tx
      .select({ zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(eq(diningTables.id, tableId));
    if (options.guests !== undefined) {
      await tx
        .update(parties)
        .set({ guestCount: options.guests.staying })
        .where(eq(parties.id, partyId));
    }
    const { partyId: newParty } = await openParty(tx, {
      guestCount: options.guests?.leaving ?? null,
      operatorId: options.operatorId,
      tableId,
    });
    let mainBillId: string | null = null;
    if (billId === null) {
      mainBillId = await partyMainBill(tx, cfg, newParty, "moved");
    } else {
      const { status } = await takeIntoParty(tx, cfg, billId, newParty, table!.zoneId);
      const { held } = await groupArrivingDishes(
        tx,
        newParty,
        billId,
        options.operatorId,
        firers,
        attendance === undefined
          ? undefined
          : {
              recorder: attendance.recorder,
              at: attendance.clock.now().instant.toISOString(),
            },
      );
      await printHoldTickets(tx, cfg, held);
      if (status === "open") {
        await setMainBill(tx, newParty, billId);
        mainBillId = billId;
      }
    }
    await leaveMergesRestoring(tx, [tableId]);
    return { partyId: newParty, mainBillId };
  });
}

/**
 * Refuse a bill Split a table cannot give the new party, in this order: another party's (or none),
 * paid, abandoned or missing, and the party's main bill.
 */
async function refuseUnsplittableBill(
  tx: Transaction,
  partyId: string,
  partyMain: string | null,
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
  if (billId === partyMain) throw new AppError("party.main_bill_stays", { partyId });
}

/** The table joins the party; `clearStatus` also clears its manual status. */
async function addTable(
  tx: Transaction,
  partyId: string,
  tableId: string,
  options: { clearStatus: boolean },
): Promise<void> {
  await tx.insert(partyTables).values({ partyId, tableId });
  if (options.clearStatus) {
    await tx.update(diningTables).set({ statusId: null }).where(eq(diningTables.id, tableId));
  }
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
  cfg: TillConfig,
  partyId: string,
  zoneId: string,
): Promise<void> {
  for (const billId of await billsTaking(tx, partyId, ["open", "placed"])) {
    await takeIntoParty(tx, cfg, billId, partyId, zoneId);
  }
}

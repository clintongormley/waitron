import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  diningTables,
  parties,
  partyTableLabels,
  partyTables,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, partyDisplayName } from "@waitron/shared";
import { guardPathParty, mergeCheckedBills } from "./bill-actions.js";
import { holdsPayment } from "./bill-payments.js";
import { enqueueMovedSlips, readSentWork } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { groupArrivingDishes } from "./order-groups.js";
import {
  checkAndBumpParty,
  openParty,
  partyZone,
  readMainBill,
  refuseMovedParty,
  setMainBill,
} from "./parties.js";
import type { TillConfig } from "./till-config.js";
import {
  assertSendable,
  clearGroups,
  fireLines,
  isOpenOrder,
  refuseHeldLeavingParty,
  serviceModesMatch,
  unsentDishLines,
} from "./working-order.js";
import "./errors.js";

export type MoveTarget = { tableId: string } | { counter: { zoneId: string | null } };

/** The party a command read at the table it names, as {@link readTargetTable} checks it. */
export interface OtherPartyRead {
  /** The revision of the party holding the target table, required when one does. */
  expectedOtherPartyRevision?: number;
  /** The party the till read at the target table, required with its revision; null when it read
   * the table free. */
  otherPartyId?: string | null;
}

export interface MoveBillOptions extends OtherPartyRead {
  bills: "merge" | "separate";
  /** The bill's own party's, required when it has one. */
  expectedPartyRevision?: number;
  /** The party the till read the bill under; null when it read the bill with no party. */
  partyId?: string | null;
  operatorId: string;
}

export interface MoveBillResult {
  partyId: string | null;
  /** The moved bill, or the main bill it merged into. */
  billId: string;
  merged: boolean;
}

/** Where the bill goes: the counter, a free table, or a table another party holds. */
type Destination =
  | { kind: "counter"; zoneId: string | null }
  | { kind: "free"; tableId: string; zoneId: string | null }
  | { kind: "party"; partyId: string };

/**
 * Move a whole bill to another party, a free table (a new party) or the counter, or a counter order
 * into a party. Both parties' revisions are checked before either the bill's or the table's own
 * state, so of two tills acting from one read the second is refused `party.out_of_date`.
 */
export async function moveBill(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  to: MoveTarget,
  options: MoveBillOptions,
): Promise<MoveBillResult> {
  const path = await guardPathParty(tx, billId, options);
  const destination = await resolveDestination(tx, cfg, path.partyId, to, options);

  if (path.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (path.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  const open = path.status === "open";

  // Read before the bill's party changes, which clears the party's main bill when it is this bill.
  const source = path.partyId === null ? null : await readSourceParty(tx, path.partyId);
  if (source !== null) {
    await refuseMainBillLeaving(tx, source, billId);
    await leaveParty(tx, billId);
    await repointSourceTables(tx, source, billId);
  }
  const before = await readSentWork(tx, cfg, billId);

  let result: MoveBillResult;
  if (destination.kind === "counter") {
    if (source === null) throw new AppError("management.request_invalid", { field: "to" });
    await tx
      .update(workingOrders)
      .set({
        partyId: null,
        revision: movedRevision,
        ...(open ? { label: await counterLabel(tx, source) } : {}),
      })
      .where(eq(workingOrders.id, billId));
    if (open && destination.zoneId !== null) await adoptZone(tx, cfg, billId, destination.zoneId);
    result = { partyId: null, billId, merged: false };
  } else if (destination.kind === "free") {
    const { partyId } = await openParty(tx, {
      guestCount: null,
      operatorId: options.operatorId,
      tableId: destination.tableId,
    });
    await takeIntoParty(tx, cfg, billId, partyId, destination.zoneId);
    await groupArrivingDishes(tx, partyId, billId, options.operatorId);
    if (open) await setMainBill(tx, partyId, billId);
    result = { partyId, billId, merged: false };
  } else {
    const partyId = destination.partyId;
    const moved = await takeIntoParty(tx, cfg, billId, partyId, await partyZone(tx, cfg, partyId));
    // Before any merge: a merge keeps line ids, so the dishes take these groups onto the main bill,
    // whose own lines keep theirs.
    await groupArrivingDishes(tx, partyId, billId, options.operatorId);
    const main = await readMainBill(tx, partyId);
    if (
      options.bills === "merge" &&
      main !== null &&
      (await isUntouched(tx, billId, moved)) &&
      (await isUntouched(tx, main)) &&
      (await serviceModesMatch(tx, cfg, billId, main))
    ) {
      // `before` was read while the bill was still at its old tables, so the kitchen is told below.
      await mergeCheckedBills(tx, cfg, partyId, main, billId, {
        mainBillId: main,
        kitchenTold: true,
      });
      result = { partyId, billId: main, merged: true };
    } else {
      if (main === null && open) await setMainBill(tx, partyId, billId);
      result = { partyId, billId, merged: false };
    }
  }

  await enqueueMovedSlips(tx, cfg, before, result.billId, new Map(), {
    force: source === null || result.partyId === null,
  });
  return result;
}

/**
 * The destination, with the party the till read at the target table checked first, by identity and
 * revision, and that revision moved on ({@link readTargetTable}); then the table's own state.
 */
async function resolveDestination(
  tx: Transaction,
  cfg: TillConfig,
  source: string | null,
  to: MoveTarget,
  options: MoveBillOptions,
): Promise<Destination> {
  if ("counter" in to) return { kind: "counter", zoneId: to.counter.zoneId };
  const { tableId } = to;
  const table = await readTargetTable(tx, cfg, tableId, source, options);
  if (table.holding !== null && table.holding === source) {
    throw new AppError("table.already_in_party", { tableId });
  }
  if (table.holding !== null) return { kind: "party", partyId: table.holding };
  await refuseUnseatable(tx, cfg, tableId, table);
  return { kind: "free", tableId, zoneId: table.zoneId };
}

/** A table an action names, as {@link readTargetTable} answers it. */
export interface TargetTable {
  /** The party holding the table now, or null. */
  holding: string | null;
  tabId: string | null;
  zoneId: string | null;
}

/**
 * The table an action moves to or joins. A revision read there must name its party. The party the
 * command read there must be the one holding it now, else `party.out_of_date` for that party, since
 * a revision alone can match a party seated there since; a table read free (`otherPartyId: null`)
 * that a party other than `source` holds now is `party.out_of_date` for the party holding it. Then
 * the revision of a party holding it, other than `source`, is checked and moved on (P27); then the
 * table is refused when it does not exist, is out of use or needs clearing.
 */
export async function readTargetTable(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  source: string | null,
  read: OtherPartyRead,
): Promise<TargetTable> {
  const { otherPartyId, expectedOtherPartyRevision } = read;
  if (typeof otherPartyId !== "string" && expectedOtherPartyRevision !== undefined) {
    throw new AppError("management.request_invalid", { field: "otherPartyId" });
  }
  const [holder] = await tx
    .select({ partyId: partyTables.partyId })
    .from(partyTables)
    .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
  const holding = holder?.partyId ?? null;
  if (otherPartyId === null && holding !== null && holding !== source) {
    await refuseMovedParty(tx, holding);
  }
  if (typeof otherPartyId === "string" && otherPartyId !== holding) {
    await refuseMovedParty(tx, otherPartyId);
  }
  if (holding !== null && holding !== source) {
    if (expectedOtherPartyRevision === undefined) {
      throw new AppError("management.request_invalid", { field: "expectedOtherPartyRevision" });
    }
    await checkAndBumpParty(tx, holding, expectedOtherPartyRevision, "open");
  }
  const [table] = await tx
    .select({
      active: diningTables.active,
      tabId: diningTables.tabId,
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
    })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)));
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  if (!table.active) throw new AppError("table.inactive", { tableId });
  if (table.needsClearingSince !== null) throw new AppError("table.needs_clearing", { tableId });
  return { holding, tabId: table.tabId, zoneId: table.zoneId };
}

/**
 * A table no party holds, refused as a tab move refuses it while it shows an open order, and as
 * seating refuses one in a zone that seats no one.
 */
export async function refuseUnseatable(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  table: TargetTable,
): Promise<void> {
  if (table.tabId !== null && (await isOpenOrder(tx, table.tabId))) {
    throw new AppError("table.occupied", { tableId });
  }
  if (table.zoneId !== null) {
    const context = await VENUE_SERVICE.resolveZoneContext(tx, cfg, table.zoneId);
    if (context.serviceMode !== "table_tab") {
      throw new AppError("service_zone.mode_incompatible", {
        zoneId: table.zoneId,
        expected: "table_tab",
        actual: context.serviceMode,
      });
    }
  }
}

interface SourceParty {
  id: string;
  mainBillId: string | null;
  name: string | null;
}

async function readSourceParty(tx: Transaction, partyId: string): Promise<SourceParty> {
  const [party] = await tx
    .select({ id: parties.id, mainBillId: parties.mainBillId, name: parties.name })
    .from(parties)
    .where(eq(parties.id, partyId));
  return party!;
}

/** What a bill taken from the party to the counter is labelled: the party's display name. */
async function counterLabel(tx: Transaction, party: SourceParty): Promise<string> {
  return partyDisplayName(party.name, (await partyTableLabels(tx, [party.id])).get(party.id)!);
}

/** The party's main bill leaves only as its last unpaid bill (spec §13 item 5). */
async function refuseMainBillLeaving(
  tx: Transaction,
  party: SourceParty,
  billId: string,
): Promise<void> {
  if (party.mainBillId !== billId) return;
  const partyId = party.id;
  const [other] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(
        eq(workingOrders.partyId, partyId),
        ne(workingOrders.id, billId),
        inArray(workingOrders.status, ["open", "placed"]),
      ),
    )
    .limit(1);
  if (other !== undefined) throw new AppError("party.main_bill_stays", { partyId });
}

/** A bill's status and when a payment in full at a reader began, as {@link takeIntoParty} answers. */
export interface BillState {
  status: (typeof workingOrders.$inferSelect)["status"];
  attemptAt: string | null;
}

/**
 * Whether the bill is untouched: open, not being paid in full at a reader, and holding no payment,
 * one given back in full or being given back included. Stricter than `requireUntouched`
 * (bill-actions.ts), which does not count a card payment in full at the reader (`payment_attempt_at`
 * set) as touching the bill. `known` is the bill's state when the caller has just read it.
 */
export async function isUntouched(
  tx: Transaction,
  billId: string,
  known?: BillState,
): Promise<boolean> {
  const bill = known ?? (await readBillState(tx, billId));
  return bill.status === "open" && bill.attemptAt === null && !(await holdsPayment(tx, billId));
}

async function readBillState(tx: Transaction, billId: string): Promise<BillState> {
  const [bill] = await tx
    .select({ status: workingOrders.status, attemptAt: workingOrders.paymentAttemptAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return bill!;
}

/**
 * One more write on an open or presented bill, without `bumpRevision`'s refusal of money in flight:
 * a move changes no amount, and a card at the reader completes on the bill wherever it now is.
 */
const movedRevision = sql`${workingOrders.revision} + 1`;

/**
 * The bill joins the party: no longer delivered to a table, its revision moved on, and, while it is
 * open, its service context taking `zoneId` for what is added later. A presented bill keeps its own
 * zone. Answers the bill's state.
 */
export async function takeIntoParty(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  partyId: string,
  zoneId: string | null,
): Promise<BillState> {
  const [bill] = await tx
    .update(workingOrders)
    .set({ partyId, deliveryTableId: null, revision: movedRevision })
    .where(eq(workingOrders.id, billId))
    .returning({ status: workingOrders.status, attemptAt: workingOrders.paymentAttemptAt });
  if (bill!.status === "open" && zoneId !== null) await adoptZone(tx, cfg, billId, zoneId);
  return bill!;
}

/**
 * The bill leaves its party: refused `group.held_leaves_party` while a dish of it is held for the
 * kitchen, and its sent dishes leave their groups, keeping their ticket and served state.
 */
export async function leaveParty(tx: Transaction, billId: string): Promise<void> {
  const lines = await tx
    .select({ id: workingOrderLines.id, groupId: workingOrderLines.groupId })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, billId), isNull(workingOrderLines.parentLineId)),
    );
  await refuseHeldLeavingParty(
    tx,
    billId,
    lines.map((line) => line.id),
  );
  await clearGroups(
    tx,
    lines.filter((line) => line.groupId !== null).map((line) => line.id),
  );
}

/**
 * The open bill takes `zoneId`'s service context. A bill entering table service from another mode
 * has its unsent dishes, which a pay-first or invoice-first bill sends when it is paid or placed,
 * sent now as a round is: table service sends a dish when it is ordered, and none when the bill is
 * paid. As placing does, the move is refused `product.unavailable` when one cannot be sold now.
 */
async function adoptZone(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  zoneId: string,
): Promise<void> {
  const previous = await VENUE_SERVICE.findOrderContext(tx, cfg, billId);
  if (previous === null) {
    await VENUE_SERVICE.recordOrderContext(tx, cfg, billId, zoneId);
  } else {
    await VENUE_SERVICE.retargetOrderContext(tx, cfg, billId, zoneId);
  }
  // Within table service a later course's dishes wait for their course. `fireLines` judges the
  // earliest course from this bill's ticket items and the lines it is given, and a no-preparation
  // dish leaves no ticket item, so it would send one waiting for a later course.
  if ((previous?.serviceMode ?? cfg.orderFlow) === "table_tab") return;
  if ((await VENUE_SERVICE.findOrderContext(tx, cfg, billId))!.serviceMode !== "table_tab") return;
  const unsent = await unsentDishLines(tx, billId);
  await assertSendable(
    tx,
    unsent.map((line) => line.id),
  );
  await fireLines(tx, cfg, billId, unsent);
}

/**
 * While tables still point at bills, a table of the party the bill is leaving that shows it shows
 * the party's main bill instead, or none when the bill leaving is the main bill or the party has
 * none.
 */
export async function repointSourceTables(
  tx: Transaction,
  party: Pick<SourceParty, "id" | "mainBillId">,
  billId: string,
): Promise<void> {
  const main = party.mainBillId === billId ? null : party.mainBillId;
  await tx
    .update(diningTables)
    .set({ tabId: main })
    .where(
      and(
        eq(diningTables.tabId, billId),
        inArray(
          diningTables.id,
          tx
            .select({ id: partyTables.tableId })
            .from(partyTables)
            .where(and(eq(partyTables.partyId, party.id), isNull(partyTables.leftAt))),
        ),
      ),
    );
}

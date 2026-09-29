import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { diningTables, parties, partyTables, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, partyDisplayName } from "@waitron/shared";
import { guardPathParty, mergeCheckedBills } from "./bill-actions.js";
import { holdsPayment } from "./bill-payments.js";
import { enqueueMovedSlips, readSentWork } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  checkAndBumpParty,
  openParty,
  partyTableLabels,
  partyZone,
  setMainBill,
} from "./parties.js";
import type { TillConfig } from "./till-config.js";
import {
  clearGroups,
  fireLines,
  refuseHeldLeavingParty,
  serviceModesMatch,
  unsentDishLines,
} from "./working-order.js";
import "./errors.js";

export type MoveTarget = { tableId: string } | { counter: { zoneId: string | null } };

export interface MoveBillOptions {
  bills: "merge" | "separate";
  /** The bill's own party's, required when it has one. */
  expectedPartyRevision?: number;
  /** The party the till read the bill under; null when it read the bill with no party. */
  partyId?: string | null;
  /** The party holding the target table's, required when one does. */
  expectedOtherPartyRevision?: number;
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
  const source = path.partyId;
  const destination = await resolveDestination(tx, cfg, source, to, options);

  const [bill] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill!.status === "abandoned") throw new AppError("tab.not_open", { tabId: billId });
  if (bill!.status === "settled") throw new AppError("bill.paid", { workingOrderId: billId });
  if (source === null && destination.kind === "counter") {
    throw new AppError("management.request_invalid", { field: "to" });
  }
  const open = bill!.status === "open";

  let label: string | null = null;
  if (source !== null) {
    await refuseMainBillLeaving(tx, source, billId);
    await leaveParty(tx, billId);
    await repointSourceTables(tx, source, billId);
    const [party] = await tx
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, source));
    label = partyDisplayName(party!.name, (await partyTableLabels(tx, [source])).get(source)!);
  }
  const before = await readSentWork(tx, cfg, billId);

  let result: MoveBillResult;
  if (destination.kind === "counter") {
    await tx
      .update(workingOrders)
      .set(open ? { partyId: null, label } : { partyId: null })
      .where(eq(workingOrders.id, billId));
    await moveRevisionOn(tx, billId);
    if (open && destination.zoneId !== null) await adoptZone(tx, cfg, billId, destination.zoneId);
    result = { partyId: null, billId, merged: false };
  } else if (destination.kind === "free") {
    const { partyId } = await openParty(tx, {
      guestCount: null,
      operatorId: options.operatorId,
      tableId: destination.tableId,
    });
    await takeIntoParty(tx, cfg, billId, partyId, destination.zoneId);
    if (open) await setMainBill(tx, partyId, billId);
    result = { partyId, billId, merged: false };
  } else {
    const partyId = destination.partyId;
    await takeIntoParty(tx, cfg, billId, partyId, await partyZone(tx, cfg, partyId));
    const [party] = await tx
      .select({ mainBillId: parties.mainBillId })
      .from(parties)
      .where(eq(parties.id, partyId));
    const main = party!.mainBillId;
    if (
      options.bills === "merge" &&
      main !== null &&
      (await isUntouched(tx, billId)) &&
      (await isUntouched(tx, main)) &&
      // A pay-first bill's unsent dishes go when it is paid, and a table bill sends none when it is
      // paid.
      (await serviceModesMatch(tx, cfg, billId, main))
    ) {
      await mergeCheckedBills(tx, cfg, partyId, main, billId);
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
 * The destination, with the revision of a party holding the target table checked and moved on
 * first; then the table's own state, refused as seating refuses it.
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
  const [holder] = await tx
    .select({ partyId: partyTables.partyId })
    .from(partyTables)
    .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
  const holding = holder?.partyId ?? null;
  if (holding !== null && holding !== source) {
    if (options.expectedOtherPartyRevision === undefined) {
      throw new AppError("management.request_invalid", { field: "expectedOtherPartyRevision" });
    }
    await checkAndBumpParty(tx, holding, options.expectedOtherPartyRevision, "open");
  }
  const [table] = await tx
    .select({
      active: diningTables.active,
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
    })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.locationId, cfg.locationId)));
  if (table === undefined) throw new AppError("table.not_found", { tableId });
  if (!table.active) throw new AppError("table.inactive", { tableId });
  if (table.needsClearingSince !== null) throw new AppError("table.needs_clearing", { tableId });
  if (holding !== null && holding === source) {
    throw new AppError("table.already_in_party", { tableId });
  }
  if (holding !== null) return { kind: "party", partyId: holding };
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
  return { kind: "free", tableId, zoneId: table.zoneId };
}

/** The party's main bill leaves only as its last unpaid bill (spec §13 item 5). */
async function refuseMainBillLeaving(
  tx: Transaction,
  partyId: string,
  billId: string,
): Promise<void> {
  const [party] = await tx
    .select({ mainBillId: parties.mainBillId })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party!.mainBillId !== billId) return;
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

/**
 * Whether the bill is untouched: open, not being paid in full at a reader, and holding no payment,
 * one given back in full or being given back included.
 */
export async function isUntouched(tx: Transaction, billId: string): Promise<boolean> {
  const [bill] = await tx
    .select({ status: workingOrders.status, attemptAt: workingOrders.paymentAttemptAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return bill!.status === "open" && bill!.attemptAt === null && !(await holdsPayment(tx, billId));
}

/**
 * The bill joins the party: no longer delivered to a table, its revision moved on, and, while it is
 * open, its service context taking `zoneId` for what is added later. A presented bill keeps its own
 * zone, since its collection settles the invoice it already has.
 */
export async function takeIntoParty(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  partyId: string,
  zoneId: string | null,
): Promise<void> {
  const [bill] = await tx
    .update(workingOrders)
    .set({ partyId, deliveryTableId: null })
    .where(eq(workingOrders.id, billId))
    .returning({ status: workingOrders.status });
  await moveRevisionOn(tx, billId);
  if (bill!.status === "open" && zoneId !== null) await adoptZone(tx, cfg, billId, zoneId);
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
 * Counts one more write on an open or presented bill without `bumpRevision`'s refusal of money in
 * flight: a move changes no amount, and a card at the reader completes on the bill wherever it now is.
 */
async function moveRevisionOn(tx: Transaction, billId: string): Promise<void> {
  await tx
    .update(workingOrders)
    .set({ revision: sql`${workingOrders.revision} + 1` })
    .where(eq(workingOrders.id, billId));
}

/**
 * The open bill takes `zoneId`'s service context. In table service its unsent dishes, which a
 * pay-first or invoice-first bill sends when it is paid or placed, are sent now as a round is: table
 * service sends a dish when it is ordered, and none when the bill is paid.
 */
async function adoptZone(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  zoneId: string,
): Promise<void> {
  if ((await VENUE_SERVICE.findOrderContext(tx, cfg, billId)) === null) {
    await VENUE_SERVICE.recordOrderContext(tx, cfg, billId, zoneId);
  } else {
    await VENUE_SERVICE.retargetOrderContext(tx, cfg, billId, zoneId);
  }
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, billId);
  if (context!.serviceMode === "table_tab") {
    await fireLines(tx, cfg, billId, await unsentDishLines(tx, billId));
  }
}

/**
 * While tables still point at bills, a table of the party the bill is leaving that shows it shows
 * the party's main bill instead, or none when the bill leaving is the main bill.
 */
async function repointSourceTables(
  tx: Transaction,
  partyId: string,
  billId: string,
): Promise<void> {
  const [party] = await tx
    .select({ mainBillId: parties.mainBillId })
    .from(parties)
    .where(eq(parties.id, partyId));
  const main = party!.mainBillId === billId ? null : party!.mainBillId;
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
            .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt))),
        ),
      ),
    );
}

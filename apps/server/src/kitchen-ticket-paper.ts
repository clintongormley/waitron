import {
  type Transaction,
  ticketItems,
  workingOrderLines,
  orderGroups,
  orderGroupHoldStations,
  partyFamilies,
  workingOrders,
  partyTables,
} from "@waitron/db";
import { eq, and, inArray, or, isNotNull, isNull } from "drizzle-orm";
import { foodOnItsWay } from "./delivery-release.js";
import { inIds } from "./in-ids.js";
import { heldPaperStations } from "./order-group-hold-paper.js";
import { type OrderPlaces, readOrderPlaces } from "@waitron/db";
import { holdersOf } from "./parties.js";

/** The kitchen work an order has on paper, and its places. */
export interface SentWork {
  places: OrderPlaces;
  /**
   * Its fired ticket items, its held ones whose group's HOLD ticket was queued
   * ({@link readOnHoldTickets}), and those waiting for the pass on HOLD paper
   * ({@link readWaitingOnHoldPaper}), which count as held; never empty.
   */
  ticketItemIds: ReadonlySet<string>;
  /** Of {@link ticketItemIds}, the held ones. */
  heldItemIds: ReadonlySet<string>;
}
/** Read before a path moves an order's lines or its tables; null when nothing is on paper. */
export async function readSentWork(tx: Transaction, orderId: string): Promise<SentWork | null> {
  const sent = (await readSentItems(tx, [orderId])).get(orderId);
  if (sent === undefined) return null;
  const places = (await readOrderPlaces(tx, [orderId])).get(orderId)!;
  return { places, ...sent };
}
/**
 * The ticket items that went to the kitchen for each of `orderIds`, keyed by order: its fired ones,
 * its held ones whose group's HOLD ticket was queued, and those waiting for the pass on HOLD paper
 * ({@link readWaitingOnHoldPaper}), which count as held. An order with none is left out.
 */
async function readSentItems(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, { ticketItemIds: Set<string>; heldItemIds: Set<string> }>> {
  const firedOrUngrouped = await tx
    .select({
      id: ticketItems.id,
      workingOrderId: workingOrderLines.workingOrderId,
      firedAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...orderIds]),
        or(
          isNotNull(ticketItems.firedAt),
          and(
            isNull(workingOrderLines.groupId),
            isNotNull(ticketItems.requestedAt),
            eq(ticketItems.holdPaperQueued, true),
          ),
        ),
      ),
    );
  const held = [
    ...(await readOnHoldTickets(tx, orderIds)),
    ...(await readWaitingOnHoldPaper(tx, orderIds)),
  ];
  const sent = new Map<string, { ticketItemIds: Set<string>; heldItemIds: Set<string> }>();
  const entry = (orderId: string) => {
    const known = sent.get(orderId) ?? { ticketItemIds: new Set(), heldItemIds: new Set() };
    sent.set(orderId, known);
    return known;
  };
  for (const item of firedOrUngrouped) {
    const order = entry(item.workingOrderId);
    order.ticketItemIds.add(item.id);
    if (item.firedAt === null) order.heldItemIds.add(item.id);
  }
  for (const item of held) {
    const known = entry(item.workingOrderId);
    known.ticketItemIds.add(item.id);
    known.heldItemIds.add(item.id);
  }
  return sent;
}
/** A dish that left its group still has HOLD paper at the station that received it. */
export async function onHeldPaper(
  tx: Transaction,
  items: readonly { workingOrderLineId: string; stationId: string | null }[],
): Promise<(item: { workingOrderLineId: string; stationId: string | null }) => boolean> {
  if (items.length === 0) return () => false;
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      groupId: workingOrderLines.groupId,
      holdPaperQueued: ticketItems.holdPaperQueued,
    })
    .from(workingOrderLines)
    .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      inIds(
        workingOrderLines.id,
        items.map((item) => item.workingOrderLineId),
      ),
    );
  const byId = new Map(lines.map((line) => [line.id, line]));
  const recorded = await heldPaperStations(
    tx,
    lines.flatMap((line) => line.groupId ?? []),
  );
  return (item) => {
    const line = byId.get(item.workingOrderLineId);
    if (line === undefined || item.stationId === null) return false;
    return line.groupId === null
      ? line.holdPaperQueued
      : recorded.get(line.groupId)?.has(item.stationId) === true;
  };
}
/**
 * The unfired ticket items of `orderIds` whose group is still held and whose HOLD ticket was
 * queued.
 */
export async function readOnHoldTickets(tx: Transaction, orderIds: readonly string[]) {
  return tx
    .select({
      id: ticketItems.id,
      workingOrderId: workingOrderLines.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      holdPrintedAt: orderGroups.holdPrintedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        inIds(workingOrderLines.workingOrderId, orderIds),
        isNull(ticketItems.firedAt),
        eq(orderGroups.state, "held"),
        isNotNull(orderGroups.holdPrintedAt),
      ),
    );
}

export function hasUngroupedHoldPaper(item: {
  firedAt: string | null;
  requestedAt: string | null;
  holdPaperQueued: boolean | null;
}): boolean {
  return item.firedAt === null && item.requestedAt !== null && item.holdPaperQueued === true;
}
/**
 * The ticket items of `orderIds` the pass has been asked for and has not released, at a station
 * recorded as having their line's group's HOLD paper ({@link heldPaperStations}).
 */
export async function readWaitingOnHoldPaper(tx: Transaction, orderIds: readonly string[]) {
  return tx
    .select({
      id: ticketItems.id,
      workingOrderId: workingOrderLines.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      holdPrintedAt: orderGroups.holdPrintedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(
      orderGroupHoldStations,
      and(
        eq(orderGroupHoldStations.groupId, workingOrderLines.groupId),
        eq(orderGroupHoldStations.stationId, ticketItems.stationId),
      ),
    )
    .where(
      and(
        inIds(workingOrderLines.workingOrderId, orderIds),
        isNotNull(ticketItems.requestedAt),
        isNull(ticketItems.firedAt),
      ),
    );
}
/**
 * The sent work of every open, placed or settled bill of `partyIds` and of every party merged into
 * them ({@link partyFamilies}), and of every counter order with food on its way
 * ({@link foodOnItsWay}) to one of those parties' tables or to one of `tableIds`, keyed by order;
 * an order the kitchen has nothing on paper for is left out. Read before a table action changes
 * which tables those bills belong to, or what those tables are called.
 */
export async function readPartiesSentWork(
  tx: Transaction,
  partyIds: readonly string[],
  tableIds: readonly string[] = [],
): Promise<Map<string, SentWork>> {
  const ofParties = [...new Set([...(await partyFamilies(tx, partyIds)).values()].flat())];
  const sendable = inArray(workingOrders.status, ["open", "placed", "settled"]);
  const ofTheParties = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(sendable, inArray(workingOrders.partyId, ofParties)));
  const partiesTables = tx
    .select({ tableId: partyTables.tableId })
    .from(partyTables)
    .where(and(inArray(partyTables.partyId, ofParties), isNull(partyTables.leftAt)));
  const delivered = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(
        sendable,
        isNull(workingOrders.partyId),
        foodOnItsWay(),
        or(
          inArray(workingOrders.deliveryTableId, partiesTables),
          inArray(workingOrders.deliveryTableId, [...tableIds]),
        ),
      ),
    );
  const bills = [...ofTheParties, ...delivered];
  const sent = await readSentItems(
    tx,
    bills.map((bill) => bill.id),
  );
  const places = await readOrderPlaces(tx, [...sent.keys()]);
  const work = new Map<string, SentWork>();
  for (const bill of bills) {
    const items = sent.get(bill.id);
    if (items === undefined) continue;
    work.set(bill.id, { places: places.get(bill.id)!, ...items });
  }
  return work;
}
/** {@link readPartiesSentWork} of the parties at `tableIds` and of the tables themselves. */
export async function readSentWorkAt(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Map<string, SentWork>> {
  return readPartiesSentWork(tx, [...new Set((await holdersOf(tx, tableIds)).values())], tableIds);
}

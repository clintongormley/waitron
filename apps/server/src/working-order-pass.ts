import {
  type Transaction,
  ticketItems,
  workingOrderLines,
  kitchenStations,
  kitchenCourses,
  workingOrders,
  orderGroups,
  parties,
  orderTableLabels,
} from "@waitron/db";
import {
  type KitchenAllergyBlock,
  type OptionSnapshot,
  type ProductAllergens,
  type DietProfile,
  type StationThresholds,
  type TimingBand,
  kitchenPresentationName,
  thousandthsToDecimal,
  classifyBand,
} from "@waitron/shared";
import { type SQL, sql, eq, and } from "drizzle-orm";
import { readFormerNumbers } from "./former-numbers.js";
import { firedQuantity, liveKitchenDish } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { readGroupNumberLabels } from "./order-group-records.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import type { PassRow } from "./pass-card.js";
import {
  type QueueModifier,
  type QueueCrossRef,
  type QueueGroup,
  queueGroupColumns,
  readQueueSubItems,
  readBillTableShortNames,
  queueGroup,
  optional,
  minutesSince,
} from "./working-order-station-queue.js";
import type { TicketState } from "./kitchen-print.js";

/** One item on the cross-station expo board. */
export interface ExpoItem {
  allergy: KitchenAllergyBlock | null;
  optionSnapshots?: OptionSnapshot[];
  id: string;
  /** The same KITCHEN name the stations read. */
  name: string;
  qty: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  /** Counted in Each, whose unit the expo board leaves out. */
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  firedAt: string | null;
  note: string | null;
  modifiers: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  queuedAt: string;
  group?: QueueGroup;
  /** This item's OWN station's order-timing thresholds — per item, not per order, because one order's
   *  items can span several stations each with different thresholds. */
  thresholds: StationThresholds;
  band: TimingBand;
}
/** The stored facts the closed-station test reads, beside the row. */
export type PassRowRead = Omit<PassRow, "zoneId" | "stationWaitsNow" | "stationClosed"> & {
  stationChosenAt: string | null;
  stationRetainedAtRelease: boolean;
  makeAtStationId: string | null;
  deliveryTableId: string | null;
};
/** Every live kitchen item `scope` selects, with the facts the pass card and release read; each
 *  bill's `tableShortNames` only `withShortNames`. */
export async function readPassRows(
  tx: Transaction,
  scope: SQL,
  nowMs: number,
  { withShortNames = false }: { withShortNames?: boolean } = {},
): Promise<PassRowRead[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      requestedAt: ticketItems.requestedAt,
      readyAt: ticketItems.readyAt,
      passControlled: ticketItems.passControlled,
      stationChosenAt: ticketItems.stationChosenAt,
      stationRetainedAtRelease: ticketItems.stationRetainedAtRelease,
      makeAtStationId: workingOrderLines.makeAtStationId,
      parentLineId: workingOrderLines.parentLineId,
      note: ticketItems.note,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: sql<number>`${firedQuantity} - ${workingOrderLines.servedQuantity}`,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      stationName: kitchenStations.name,
      // Per item, not per order: one order's items can span stations with different thresholds.
      queuedAt: ticketItems.queuedAt,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      openedAt: workingOrders.openedAt,
      dining: workingOrders.dining,
      ...queueGroupColumns,
      groupRequestKind: orderGroups.requestKind,
      groupCreatedAt: orderGroups.createdAt,
      partyFirstGroupAt: sql<string | null>`(
        select min(earlier.created_at) from order_groups earlier
        where earlier.party_id = ${orderGroups.partyId}
      )`,
      groupPartyRevision: sql<number | null>`(
        select own.revision from parties own where own.id = ${orderGroups.partyId}
      )`,
      // Not exposed; read only to name the order's table (`orderTableLabels`).
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
      label: workingOrders.label,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(workingOrders, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`, as in `listStationQueue`.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(liveKitchenDish(), scope))
    .orderBy(
      workingOrders.openedAt,
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      workingOrderLines.lineNo,
      ticketItems.id,
    );

  const allergies = await VENUE_SERVICE.readTicketAllergies(
    tx,
    rows.map((row) => row.itemId),
  );
  const numberLabels = await readGroupNumberLabels(
    tx,
    rows.flatMap((row) => (row.groupPartyId === null ? [] : [row.groupPartyId])),
  );
  const { modifiersByParent, crossRefsByLine, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.lineId),
  );
  const soldInEach = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    rows.map((row) => row.lineId),
  );
  const former = await readFormerNumbers(
    tx,
    rows.map((row) => row.orderId),
  );
  const kitchenNotes = await readOrderKitchenNotes(
    tx,
    rows.map((row) => row.orderId),
  );
  const bills = [...new Map(rows.map((row) => [row.orderId, row])).values()];
  const tableLabels = await orderTableLabels(
    tx,
    bills.map((row) => ({
      id: row.orderId,
      partyId: row.partyId,
      deliveryTableId: row.deliveryTableId,
      deliveryTableLabel: row.deliveryTableLabel,
      label: row.label,
    })),
  );
  const tableShortNames = withShortNames
    ? await readBillTableShortNames(tx, bills)
    : new Map<string, string[]>();

  return rows.map((row) => {
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    const group = queueGroup(row, numberLabels);
    const ageFrom =
      row.firedAt === null && row.requestedAt !== null ? row.requestedAt : row.queuedAt;
    const item: ExpoItem = {
      id: row.itemId,
      allergy: allergies.get(row.itemId)?.originalBlock ?? null,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      qty: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      soldInEach: soldInEach.has(row.lineId),
      stationName: row.stationName,
      state: row.state,
      firedAt: row.firedAt,
      note: row.note,
      modifiers: modifiersByParent.get(row.lineId) ?? [],
      ...optional("crossRefs", crossRefsByLine.get(row.lineId)),
      asServed: asServedByParent.get(row.lineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.lineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      queuedAt: row.queuedAt,
      ...optional("group", group),
      thresholds,
      // Rounded to the whole minute first, as in `listStationQueue`. A Requested dish's
      // `queued_at` is still its insert, so it is aged from the request.
      band: classifyBand(nowMs - minutesSince(ageFrom, nowMs) * 60_000, nowMs, thresholds),
    };
    return {
      item,
      lineId: row.lineId,
      orderId: row.orderId,
      stationId: row.stationId,
      partyId: row.partyId,
      partyRevision: row.partyRevision,
      course:
        row.courseId === null
          ? null
          : { id: row.courseId, name: row.courseName!, displayOrder: row.courseDisplayOrder! },
      group:
        group === undefined
          ? null
          : {
              id: group.id,
              partyId: row.groupPartyId!,
              partyRevision: row.groupPartyRevision!,
              state: group.state as "held" | "fired",
              requestKind: row.groupRequestKind!,
              position: group.position,
              createdAt: row.groupCreatedAt!,
              displayNumber: group.displayNumber,
              ...optional("numberPartyLabel", group.numberPartyLabel),
              partyFirstCreatedAt: row.partyFirstGroupAt!,
            },
      requestedAt: row.requestedAt,
      firedAt: row.firedAt,
      readyAt: row.readyAt,
      passControlled: row.passControlled,
      extra: row.parentLineId !== null,
      remaining: row.quantity,
      lineNo: row.lineNo,
      order: {
        orderNumber: row.orderNumber,
        ...optional("tableLabel", tableLabels.get(row.orderId) ?? undefined),
        ...optional("tableShortNames", tableShortNames.get(row.orderId)),
        kitchenNote: kitchenNotes.get(row.orderId)!.note,
        ...optional("formerNumbers", former.get(row.orderId)),
        dining: row.dining,
        openedAt: row.openedAt,
      },
      stationChosenAt: row.stationChosenAt,
      stationRetainedAtRelease: row.stationRetainedAtRelease,
      makeAtStationId: row.makeAtStationId,
      deliveryTableId: row.deliveryTableId,
    };
  });
}

import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { parentJoin, parentProducts, staffPresentationName } from "@waitron/catalogue";
import {
  kitchenStations,
  kitchenStationTiming,
  kitchenTimingDefaults,
  orderDrafts,
  orderGroups,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { classifyBand, worstBand } from "@waitron/shared";
import type { KitchenSignal, ReadyAtStation, TableSignal } from "@waitron/shared";
import type { FamilyBill } from "./parties.js";
import type { TableParty } from "./working-order.js";
import { productSellable } from "./working-order.js";

/** A fired line with a record nobody has finished serving, with its station and waiting bands. */
interface KitchenLine {
  billId: string;
  stationId: string;
  stationName: string;
  displayOrder: number;
  state: string;
  queuedAt: string;
  units: number;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

/** The fired kitchen lines of these bills still to serve, excluding items made at the till. */
async function readKitchenLines(
  tx: Transaction,
  billIds: readonly string[],
): Promise<KitchenLine[]> {
  if (billIds.length === 0) return [];
  const dish = alias(workingOrderLines, "signal_dish");
  const rows = await tx
    .select({
      billId: workingOrderLines.workingOrderId,
      stationId: ticketItems.stationId,
      stationName: kitchenStations.name,
      displayOrder: kitchenStations.displayOrder,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
      dishQuantity: dish.quantity,
      dishServedQuantity: dish.servedQuantity,
      dishUnitPrecision: dish.unitPrecision,
      warmAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.warmAfterMinutes}, ${kitchenTimingDefaults.warmAfterMinutes})`,
      overdueAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.overdueAfterMinutes}, ${kitchenTimingDefaults.overdueAfterMinutes})`,
      forgottenAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.forgottenAfterMinutes}, ${kitchenTimingDefaults.forgottenAfterMinutes})`,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .leftJoin(dish, eq(dish.id, workingOrderLines.parentLineId))
    .innerJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
    .leftJoin(kitchenStationTiming, eq(kitchenStationTiming.stationId, kitchenStations.id))
    .innerJoin(
      kitchenTimingDefaults,
      eq(kitchenTimingDefaults.locationId, kitchenStations.locationId),
    )
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...billIds]),
        isNull(workingOrderLines.servedAt),
        isNotNull(ticketItems.firedAt),
        eq(ticketItems.madeHere, false),
      ),
    );
  return rows.map(
    ({
      quantity,
      servedQuantity,
      unitPrecision,
      dishQuantity,
      dishServedQuantity,
      dishUnitPrecision,
      ...line
    }) => ({
      ...line,
      // A weighed dish is one plate however much it weighs; a counted one is its units left to serve.
      units:
        (dishUnitPrecision ?? unitPrecision)
          ? 1
          : ((dishQuantity ?? quantity) - (dishServedQuantity ?? servedQuantity)) / 1000,
    }),
  );
}

/** `ready` per station and the worst `long_wait` band over the lines, in that order. */
function kitchenSignals(lines: readonly KitchenLine[], nowMs: number): KitchenSignal[] {
  const signals: KitchenSignal[] = [];
  const ready = new Map<string, ReadyAtStation & { displayOrder: number }>();
  for (const line of lines) {
    if (line.state !== "ready") continue;
    const station = ready.get(line.stationId) ?? {
      stationId: line.stationId,
      stationName: line.stationName,
      displayOrder: line.displayOrder,
      count: 0,
    };
    station.count += line.units;
    ready.set(line.stationId, station);
  }
  if (ready.size > 0) {
    const byStation = [...ready.values()]
      .sort((a, b) => a.displayOrder - b.displayOrder || a.stationName.localeCompare(b.stationName))
      .map(({ stationId, stationName, count }) => ({ stationId, stationName, count }));
    signals.push({ kind: "ready", byStation });
  }
  const band = worstBand(lines.map((line) => classifyBand(Date.parse(line.queuedAt), nowMs, line)));
  if (band !== "fresh") signals.push({ kind: "long_wait", band });
  return signals;
}

/** Each bill's `ready` and `long_wait` signals, keyed by bill: the counter's tab list shows them. */
export async function readBillSignals(
  tx: Transaction,
  billIds: readonly string[],
  nowMs: number,
): Promise<Map<string, KitchenSignal[]>> {
  const lines = groupBy(await readKitchenLines(tx, billIds), (line) => line.billId);
  return new Map(billIds.map((billId) => [billId, kitchenSignals(lines.get(billId) ?? [], nowMs)]));
}

/** The rows grouped by `key`, each group in the rows' own order. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

/** What the floor read already knows of a seated party beyond {@link TableParty}. */
export interface SeatedPartyFacts {
  /** Every bill of the party's family, abandoned ones included. */
  bills: readonly FamilyBill[];
  billRequestedAt: string | null;
}

/**
 * Each seated party's signals, keyed by party, in {@link TableSignal}'s order. Bills and dishes are
 * the party's family's, abandoned bills left out, so a paid bill's dish still waiting shows. Every
 * kind of fact read here is one query for all the parties, whatever their number.
 */
export async function readPartySignals(
  tx: Transaction,
  seated: readonly TableParty[],
  facts: ReadonlyMap<string, SeatedPartyFacts>,
  nowMs: number,
): Promise<Map<string, TableSignal[]>> {
  const partyIds = seated.map((party) => party.id);
  if (partyIds.length === 0) return new Map();
  const billsOf = new Map(
    partyIds.map((id) => [id, facts.get(id)!.bills.filter((bill) => bill.status !== "abandoned")]),
  );
  const kitchen = groupBy(
    await readKitchenLines(
      tx,
      [...billsOf.values()].flat().map((bill) => bill.workingOrderId),
    ),
    (line) => line.billId,
  );
  const unavailableRows = await tx
    .select({
      groupId: orderGroups.id,
      partyId: orderGroups.partyId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .innerJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(
      and(
        inArray(orderGroups.partyId, partyIds),
        eq(orderGroups.state, "held"),
        ne(workingOrders.status, "abandoned"),
        sql`not ${productSellable}`,
      ),
    )
    .orderBy(
      asc(orderGroups.position),
      asc(orderGroups.createdAt),
      asc(orderGroups.id),
      asc(workingOrders.orderNumber),
      asc(workingOrderLines.lineNo),
    );
  const unavailable = groupBy(unavailableRows, (row) => row.partyId);
  const drafting = new Set(
    (
      await tx
        .selectDistinct({ partyId: orderDrafts.partyId })
        .from(orderDrafts)
        .where(and(inArray(orderDrafts.partyId, partyIds), eq(orderDrafts.state, "open")))
    ).map((row) => row.partyId),
  );

  const signals = new Map<string, TableSignal[]>();
  for (const party of seated) {
    const own = billsOf.get(party.id)!;
    const list: TableSignal[] = [];
    if (own.every((bill) => bill.lines === 0) && !drafting.has(party.id)) {
      list.push({ kind: "take_order" });
    }
    if (party.unsentDrafts.length > 0) {
      list.push({
        kind: "unsent_draft",
        ownerNames: party.unsentDrafts.map((draft) => draft.ownerName),
      });
    }
    list.push(
      ...kitchenSignals(
        own.flatMap((bill) => kitchen.get(bill.workingOrderId) ?? []),
        nowMs,
      ),
    );
    if (party.reminder?.dueAt != null) {
      list.push({
        kind: "release_due",
        groupId: party.reminder.groupId,
        dueAt: party.reminder.dueAt,
      });
    }
    const held = groupBy(unavailable.get(party.id) ?? [], (line) => line.groupId);
    for (const [groupId, lines] of held) {
      list.push({ kind: "held_unavailable", groupId, lineNames: lines.map(staffPresentationName) });
    }
    const requestedAt = facts.get(party.id)!.billRequestedAt;
    if (requestedAt !== null) list.push({ kind: "bill_requested", requestedAt });
    signals.set(party.id, list);
  }
  return signals;
}

/** The table's signals: its party's, if one sits there, then whether it waits to be cleared. */
export function tableSignals(
  partySignals: readonly TableSignal[] | undefined,
  needsClearingSince: string | null,
): TableSignal[] {
  return [
    ...(partySignals ?? []),
    ...(needsClearingSince === null
      ? []
      : [{ kind: "needs_clearing" as const, since: needsClearingSince }]),
  ];
}

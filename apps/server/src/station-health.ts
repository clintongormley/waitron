import { and, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { kitchenPresentationName } from "@waitron/catalogue";
import {
  diningTables,
  assertKitchenTimingPresent,
  kitchenStations,
  kitchenStationTiming,
  kitchenTimingDefaults,
  partyTables,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { classifyBand, thousandthsToDecimal, type TimingBand } from "@waitron/shared";
import {
  stationPrintersDown,
  stationScreensDark,
  type DarkScreen,
  type DownPrinter,
} from "./station-outputs-down.js";
import type { TillConfig } from "./till-config.js";
import { VENUE_SERVICE } from "./modules.js";

export interface StationHealthItem {
  id: string;
  name: string;
  orderId: string;
  orderNumber: number;
  label: string | null;
  tableNames: string[];
  state: "queued" | "preparing" | "ready";
  queuedAt: string;
  remainingQuantity: string;
  band: TimingBand;
}
export interface StationHealth {
  id: string;
  name: string;
  hasScreen: boolean;
  waiting: number;
  preparing: number | null;
  ready: number | null;
  late: { warm: number; overdue: number; forgotten: number };
  oldestMinutes: number | null;
  items: StationHealthItem[];
}
export interface StationHealthSnapshot {
  capturedAt: string;
  stations: StationHealth[];
  outputsDown: { printersDown: DownPrinter[]; screensDark: DarkScreen[] };
}

export function stationHealthItemsQuery(tx: Transaction, locationId: string) {
  return tx
    .select({
      id: ticketItems.id,
      stationId: ticketItems.stationId,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      partyId: workingOrders.partyId,
    })
    .from(ticketItems)
    .innerJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(
      and(
        eq(kitchenStations.locationId, locationId),
        eq(ticketItems.madeHere, false),
        isNotNull(ticketItems.firedAt),
        isNull(workingOrderLines.parentLineId),
        gt(workingOrderLines.quantity, workingOrderLines.servedQuantity),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    .orderBy(ticketItems.queuedAt, workingOrders.orderNumber, workingOrderLines.lineNo);
}

export async function readStationHealth(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  now: Date,
): Promise<StationHealthSnapshot> {
  await assertKitchenTimingPresent(tx);
  const stations = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      warmAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.warmAfterMinutes}, ${kitchenTimingDefaults.warmAfterMinutes})`,
      overdueAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.overdueAfterMinutes}, ${kitchenTimingDefaults.overdueAfterMinutes})`,
      forgottenAfterMinutes: sql<number>`coalesce(${kitchenStationTiming.forgottenAfterMinutes}, ${kitchenTimingDefaults.forgottenAfterMinutes})`,
    })
    .from(kitchenStations)
    .leftJoin(kitchenStationTiming, eq(kitchenStationTiming.stationId, kitchenStations.id))
    .innerJoin(
      kitchenTimingDefaults,
      eq(kitchenTimingDefaults.locationId, kitchenStations.locationId),
    )
    .where(eq(kitchenStations.locationId, cfg.locationId))
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
  const selected = new Set(
    (await VENUE_SERVICE.readStationScreens(tx, cfg, { withSwitchedOff: true })).flatMap(
      (screen) => screen.stationIds,
    ),
  );
  const rows = await stationHealthItemsQuery(tx, cfg.locationId);
  const partyIds = [...new Set(rows.flatMap((r) => (r.partyId === null ? [] : [r.partyId])))];
  const tables =
    partyIds.length === 0
      ? []
      : await tx
          .select({
            partyId: partyTables.partyId,
            name: diningTables.label,
          })
          .from(partyTables)
          .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
          .where(and(inArray(partyTables.partyId, partyIds), isNull(partyTables.leftAt)))
          .orderBy(partyTables.joinedAt, diningTables.label);
  const tableNames = new Map<string, string[]>();
  for (const table of tables) {
    const names = tableNames.get(table.partyId) ?? [];
    names.push(table.name);
    tableNames.set(table.partyId, names);
  }
  const byStation = new Map(
    stations.map((station) => {
      const hasScreen = selected.has(station.id);
      const health: StationHealth = {
        id: station.id,
        name: station.name,
        hasScreen,
        waiting: 0,
        preparing: hasScreen ? 0 : null,
        ready: hasScreen ? 0 : null,
        late: { warm: 0, overdue: 0, forgotten: 0 },
        oldestMinutes: null,
        items: [],
      };
      return [station.id, { health, thresholds: station }] as const;
    }),
  );
  for (const row of rows) {
    const { health, thresholds } = byStation.get(row.stationId)!;
    const age = Math.max(0, Math.floor((now.getTime() - Date.parse(row.queuedAt)) / 60_000));
    const band = classifyBand(Date.parse(row.queuedAt), now.getTime(), thresholds);
    if (!health.hasScreen || row.state === "queued") health.waiting++;
    else if (row.state === "preparing") health.preparing!++;
    else health.ready!++;
    if (band !== "fresh") health.late[band]++;
    health.oldestMinutes = Math.max(health.oldestMinutes ?? 0, age);
    health.items.push({
      id: row.id,
      name: kitchenPresentationName(row),
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      label: row.label,
      tableNames: row.partyId === null ? [] : (tableNames.get(row.partyId) ?? []),
      state: row.state,
      queuedAt: row.queuedAt,
      remainingQuantity: thousandthsToDecimal(row.quantity - row.servedQuantity),
      band,
    });
  }
  return {
    capturedAt: now.toISOString(),
    stations: [...byStation.values()].map((s) => s.health),
    outputsDown: {
      printersDown: await stationPrintersDown(tx, cfg.locationId, now),
      screensDark: await stationScreensDark(tx, cfg.locationId, now),
    },
  };
}

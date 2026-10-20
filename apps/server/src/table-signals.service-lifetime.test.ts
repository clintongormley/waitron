import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenStations,
  lineServiceCancellations,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { readBillSignals } from "./table-signals.js";
import { listTablesWithState } from "./working-order.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
let extraStationId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    extraStationId = await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra station" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
      return station.id;
    });
  },
});

async function snapshot(billId: string) {
  return inTx(venue, async (tx) => ({
    orders: await tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    lines: await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
    items: await tx
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, billId))
      .orderBy(ticketItems.id),
  }));
}

async function signalsOf(order: { billId: string; partyId: string }) {
  return inTx(venue, async (tx) => {
    const bills = await readBillSignals(tx, [order.billId], Date.now());
    const tables = await listTablesWithState(tx, venue.cfg);
    const table = tables.find((row) => row.party?.id === order.partyId)!;
    return {
      bill: bills.get(order.billId),
      table: table.signals.filter(
        (signal) => signal.kind === "ready" || signal.kind === "long_wait",
      ),
    };
  });
}

async function fixture({
  cancelled = 0,
  served = 0,
  weighed = false,
  extras = false,
  legacyQuantity = false,
  held = false,
  madeHere = false,
  state = "ready",
}: {
  cancelled?: number;
  served?: number;
  weighed?: boolean;
  extras?: boolean;
  legacyQuantity?: boolean;
  held?: boolean;
  madeHere?: boolean;
  state?: "ready" | "preparing";
}) {
  const order = await billWith(
    venue,
    [
      {
        name: weighed ? "Ham" : "Pizza",
        quantity: weighed ? "0.350" : "3",
        ...(extras ? { olives: 2 } : {}),
      },
    ],
    { release: held ? "hold" : "fire" },
  );
  const at = new Date(Date.now() - 30 * 60_000).toISOString();
  await inTx(venue, async (tx) => {
    const lines = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo);
    const parent = lines[0]!;
    if (cancelled > 0)
      await tx.insert(lineServiceCancellations).values({
        lineId: parent.id,
        quantity: cancelled,
        cancelledAt: at,
        wasStarted: true,
        actorId: venue.staffId,
      });
    for (const line of lines) {
      const ratio = line.parentLineId === null ? 1 : 2;
      await tx
        .update(workingOrderLines)
        .set({ servedQuantity: served * ratio, servedAt: null })
        .where(eq(workingOrderLines.id, line.id));
      await tx
        .update(ticketItems)
        .set({
          state,
          readyAt: state === "ready" ? at : null,
          queuedAt: at,
          quantity: legacyQuantity ? null : line.quantity - cancelled * ratio,
          awayAt: at,
          madeHere,
        })
        .where(eq(ticketItems.workingOrderLineId, line.id));
    }
  });
  return order;
}

async function expectedSignals(count: number, state: "ready" | "preparing", extras = false) {
  if (count === 0) return [];
  const stations = await inTx(venue, (tx) =>
    tx.select({ id: kitchenStations.id, name: kitchenStations.name }).from(kitchenStations),
  );
  const byStation = (extras ? [extraStationId, venue.stationId] : [venue.stationId]).map((id) => ({
    stationId: id,
    stationName: stations.find((station) => station.id === id)!.name,
    count,
  }));
  byStation.sort((a, b) => a.stationName.localeCompare(b.stationName));
  return [
    ...(state === "ready" ? [{ kind: "ready", byStation }] : []),
    { kind: "long_wait", band: "forgotten" },
  ];
}

describe("A773 no dispatch state — remaining kitchen signals", () => {
  it.each([
    { name: "live food", count: 3 },
    { name: "partly served food", served: 1000, count: 2 },
    { name: "partly cancelled food", cancelled: 1000, count: 2 },
    { name: "partly served and cancelled food", cancelled: 1000, served: 1000, count: 1 },
    { name: "fully served food without a completion stamp", served: 3000, count: 0 },
    { name: "fully cancelled food with a retained ticket", cancelled: 3000, count: 0 },
    { name: "served active remainder", cancelled: 1000, served: 2000, count: 0 },
    { name: "legacy quantity", legacyQuantity: true, served: 1000, count: 2 },
    { name: "fully served legacy quantity", legacyQuantity: true, served: 3000, count: 0 },
    { name: "weighed remaining food", weighed: true, cancelled: 100, served: 100, count: 1 },
    { name: "served weighed remainder", weighed: true, cancelled: 100, served: 250, count: 0 },
    { name: "held food", held: true, count: 0 },
    { name: "made-here food", madeHere: true, count: 0 },
  ])("counts only $name still in service", async ({ count, ...options }) => {
    const order = await fixture(options);
    const before = await snapshot(order.billId);
    const expected = await expectedSignals(count, "ready");

    expect(await signalsOf(order)).toEqual({ bill: expected, table: expected });
    expect(await snapshot(order.billId)).toEqual(before);
  });

  it.each([
    { name: "remaining", cancelled: 1000, served: 1000, count: 1 },
    { name: "finished", cancelled: 1000, served: 2000, count: 0 },
  ])("warns of waiting only for $name preparing food", async ({ count, ...options }) => {
    const order = await fixture({ ...options, state: "preparing" });
    const expected = await expectedSignals(count, "preparing");

    expect(await signalsOf(order)).toEqual({ bill: expected, table: expected });
  });

  it.each([
    { name: "remaining", cancelled: 1000, served: 1000, count: 1 },
    { name: "finished", cancelled: 1000, served: 2000, count: 0 },
  ])(
    "counts $name separately routed extras by their parent dishes",
    async ({ count, ...options }) => {
      const order = await fixture({ ...options, extras: true });
      const before = await snapshot(order.billId);
      const expected = await expectedSignals(count, "ready", true);

      expect(before.lines).toHaveLength(2);
      expect(before.items).toHaveLength(2);
      expect(before.items.map((item) => item.stationId).sort()).toEqual(
        [venue.stationId, extraStationId].sort(),
      );
      expect(await signalsOf(order)).toEqual({ bill: expected, table: expected });
      expect(await snapshot(order.billId)).toEqual(before);
    },
  );
});

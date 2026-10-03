import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenStations,
  locations,
  nowIso,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId } from "@waitron/shared";
import { listStationQueue } from "./working-order.js";
import { dashboardOrderAt } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const LOCALE = "es";

describe("station queue rest of the order", () => {
  it("shows the rest of the order only for an enabled station, with an empty list when none is elsewhere", async () => {
    const db = suite.db;
    await seedTenant(db);
    const locationId = randomUUID();
    await db.insert(locations).values({
      id: locationId,
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    });
    const tillId = randomUUID();
    await db.insert(tills).values({ id: tillId, locationId, name: "Caja 1" });
    const nodeId = await seedNode(db, brandLocationId(locationId));
    const [{ id: stationId }] = await db
      .insert(kitchenStations)
      .values({ locationId, name: "Cocina", isDefault: true })
      .returning({ id: kitchenStations.id });
    const orderId = randomUUID();
    await db.insert(workingOrders).values({
      id: orderId,
      ...dashboardOrderAt(locationId),
      nodeId,
      orderNumber: 1,
      status: "open",
    });
    const ownLineId = randomUUID();
    await db.insert(workingOrderLines).values({
      id: ownLineId,
      workingOrderId: orderId,
      lineNo: 1,
      name: "Staff own",
      kitchenName: "Kitchen own",
      descriptions: { [LOCALE]: "Customer own" },
      quantity: 1000,
      unitPriceGross: 121,
      vatClass: "general",
      lineTotal: 121,
    });
    await db.insert(ticketItems).values({
      nodeId,
      workingOrderId: orderId,
      workingOrderLineId: ownLineId,
      stationId,
      state: "ready",
      firedAt: nowIso(),
    });
    const otherStations = await db
      .insert(kitchenStations)
      .values([
        { locationId: locationId, name: "A Freidora" },
        { locationId: locationId, name: "Z Parrilla" },
      ])
      .returning({ id: kitchenStations.id, name: kitchenStations.name });
    const station = (name: string) => otherStations.find((row) => row.name === name)!.id;
    const cases = [
      {
        no: 2,
        staff: "Staff steak",
        kitchen: "Kitchen steak",
        station: "Z Parrilla",
        state: "ready",
        held: false,
      },
      {
        no: 3,
        staff: "Staff chips",
        kitchen: "Z Kitchen chips",
        station: "A Freidora",
        state: "queued",
        held: true,
      },
      {
        no: 4,
        staff: "Staff sauce",
        kitchen: "A Kitchen sauce",
        station: "A Freidora",
        state: "preparing",
        held: false,
      },
      {
        no: 5,
        staff: "Staff served",
        kitchen: "Kitchen served",
        station: "A Freidora",
        state: "ready",
        held: false,
        served: true,
      },
      {
        no: 6,
        staff: "Staff away",
        kitchen: "Kitchen away",
        station: "A Freidora",
        state: "ready",
        held: false,
        away: true,
      },
      {
        no: 7,
        staff: "Staff made",
        kitchen: "Kitchen made",
        station: "A Freidora",
        state: "ready",
        held: false,
        madeHere: true,
      },
    ] as const;
    const ids = new Map<number, string>();
    for (const item of cases) {
      const lineId = randomUUID();
      await db.insert(workingOrderLines).values({
        id: lineId,
        workingOrderId: orderId,
        lineNo: item.no,
        name: item.staff,
        kitchenName: item.kitchen,
        descriptions: { [LOCALE]: `Customer ${item.no}` },
        quantity: 1000,
        unitPriceGross: 121,
        vatClass: "general",
        lineTotal: 121,
        servedAt: "served" in item ? nowIso() : null,
      });
      const [ticket] = await db
        .insert(ticketItems)
        .values({
          nodeId,
          workingOrderId: orderId,
          workingOrderLineId: lineId,
          stationId: station(item.station),
          state: item.state,
          firedAt: item.held ? null : nowIso(),
          awayAt: "away" in item ? nowIso() : null,
          madeHere: "madeHere" in item,
        })
        .returning({ id: ticketItems.id });
      ids.set(item.no, ticket!.id);
    }
    const ownOnlyOrderId = randomUUID();
    await db.insert(workingOrders).values({
      id: ownOnlyOrderId,
      ...dashboardOrderAt(locationId),
      nodeId,
      orderNumber: 2,
      status: "open",
    });
    const ownOnlyLineId = randomUUID();
    await db.insert(workingOrderLines).values({
      id: ownOnlyLineId,
      workingOrderId: ownOnlyOrderId,
      lineNo: 1,
      name: "Staff own",
      kitchenName: "Kitchen own",
      descriptions: { [LOCALE]: "Customer own" },
      quantity: 1000,
      unitPriceGross: 121,
      vatClass: "general",
      lineTotal: 121,
    });
    await db.insert(ticketItems).values({
      nodeId,
      workingOrderId: ownOnlyOrderId,
      workingOrderLineId: ownOnlyLineId,
      stationId,
      state: "queued",
      firedAt: nowIso(),
    });

    const read = () => withTransaction(db, (tx) => listStationQueue(tx, stationId));
    const disabled = await read();
    expect(disabled).toHaveLength(2);
    for (const group of disabled) expect(group).not.toHaveProperty("elsewhere");

    await db
      .update(kitchenStations)
      .set({ showsRestOfOrder: true })
      .where(eq(kitchenStations.id, stationId));
    const enabled = await read();
    expect(enabled.find((group) => group.orderId === ownOnlyOrderId)?.elsewhere).toEqual([]);
    expect(enabled.find((group) => group.orderId === orderId)?.elsewhere).toEqual([
      {
        id: ids.get(3),
        name: "Z Kitchen chips",
        quantity: "1.000",
        unitName: null,
        unitPrecision: null,
        soldInEach: false,
        stationName: "A Freidora",
        state: "queued",
        held: true,
      },
      {
        id: ids.get(4),
        name: "A Kitchen sauce",
        quantity: "1.000",
        unitName: null,
        unitPrecision: null,
        soldInEach: false,
        stationName: "A Freidora",
        state: "preparing",
        held: false,
      },
      {
        id: ids.get(2),
        name: "Kitchen steak",
        quantity: "1.000",
        unitName: null,
        unitPrecision: null,
        soldInEach: false,
        stationName: "Z Parrilla",
        state: "ready",
        held: false,
      },
    ]);
  });
});

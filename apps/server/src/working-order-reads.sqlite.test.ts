import {
  diningTables,
  kitchenStations,
  locations,
  nowIso,
  parties,
  partyTables,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  locationId as brandLocationId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { TillConfig } from "./till-config.js";
import { listExpoQueue, listStationQueue, listTablesWithState } from "./working-order.js";

/** The three kitchen/floor read models, run against a real migrated venue database. */

const LOCALE = "es";
const MINUTE_MS = 60_000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  resetPerTest: false,
});
let db: Database;
let cfg: TillConfig;
let stationId: string;
let nodeId: Awaited<ReturnType<typeof seedNode>>;
let orderId: string;
let tableId: string;

beforeAll(async () => {
  db = suite.db;
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
  nodeId = await seedNode(db, brandLocationId(locationId));
  [{ id: stationId }] = await db
    .insert(kitchenStations)
    .values({ locationId, name: "Cocina", isDefault: true })
    .returning({ id: kitchenStations.id });

  orderId = randomUUID();
  const [party] = await db
    .insert(parties)
    .values({ openedBy: randomUUID() })
    .returning({ id: parties.id });
  await db
    .insert(workingOrders)
    .values({ id: orderId, tillId, nodeId, orderNumber: 1, status: "open", partyId: party!.id });
  const lineId = randomUUID();
  await db.insert(workingOrderLines).values({
    id: lineId,
    workingOrderId: orderId,
    lineNo: 1,
    name: "Café",
    descriptions: { [LOCALE]: "Café" },
    quantity: 1000,
    unitPriceGross: 121,
    vatClass: "general",
    lineTotal: 121,
  });
  const queuedAt = new Date(Date.now() - 3 * MINUTE_MS).toISOString();
  await db.insert(ticketItems).values({
    nodeId,
    workingOrderId: orderId,
    workingOrderLineId: lineId,
    stationId,
    state: "ready",
    queuedAt,
    firedAt: nowIso(),
  });
  tableId = randomUUID();
  await db.insert(diningTables).values({ id: tableId, locationId, label: "Mesa 1", capacity: 4 });
  await db.insert(partyTables).values({ partyId: party!.id, tableId });

  cfg = {
    tillId: brandTillId(tillId),
    nodeId,
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
});

describe("the kitchen and floor read models on a real migrated venue", () => {
  it("rolls an open tab up onto its table — counts, total and timing band", async () => {
    const [table] = await withTransaction(db, async (tx) => {
      return listTablesWithState(tx, cfg);
    });
    expect(table).toMatchObject({
      id: tableId,
      label: "Mesa 1",
      state: "open-tab",
      hasOpenTab: true,
      pendingToServe: 1,
      // The item is `ready` and the line unserved, so it counts here and not in `enRoute` (no
      // `away_at`).
      readyToServe: 1,
      enRoute: 0,
      pendingDeliveries: 0,
      // Three minutes queued against the station's five-minute warm threshold.
      timingBand: "fresh",
    });
  });

  it("lists the station queue with the item's age classified", async () => {
    const groups = await withTransaction(db, async (tx) => {
      return listStationQueue(tx, stationId);
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]).toMatchObject({ state: "ready", band: "fresh" });
  });

  it("lists the expo queue with the order's open age in whole minutes", async () => {
    const orders = await withTransaction(db, async (tx) => {
      return listExpoQueue(tx, cfg);
    });
    expect(orders).toHaveLength(1);
    // Opened in this suite's own setup, so the floored minute count is 0.
    expect(orders[0]!.openedMinutes).toBe(0);
    expect(orders[0]!.tableLabel).toBe("Mesa 1");
  });
  it("shows the rest of the order only for an enabled station, with an empty list when none is elsewhere", async () => {
    const otherStations = await db
      .insert(kitchenStations)
      .values([
        { locationId: cfg.locationId, name: "A Freidora" },
        { locationId: cfg.locationId, name: "Z Parrilla" },
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
        kitchen: "Kitchen chips",
        station: "A Freidora",
        state: "queued",
        held: true,
      },
      {
        no: 4,
        staff: "Staff sauce",
        kitchen: "Kitchen sauce",
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
    const [baseOrder] = await db
      .select({ tillId: workingOrders.tillId })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId));
    await db.insert(workingOrders).values({
      id: ownOnlyOrderId,
      tillId: baseOrder!.tillId,
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
        name: "Kitchen chips",
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
        name: "Kitchen sauce",
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

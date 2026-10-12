import { floorTodayTables } from "@waitron/db";
import {
  diningTables,
  floorZones,
  kitchenStations,
  locations,
  kitchenTimingDefaults,
  nowIso,
  parties,
  partyTables,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { TillConfig } from "./till-config.js";
import { listTables } from "./tables.js";
import { listExpoQueue, listStationQueue, listTablesWithState } from "./working-order.js";
import { dashboardOrderAt } from "./testing/session-device.js";

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
  await db.insert(kitchenTimingDefaults).values({ locationId });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  [{ id: stationId }] = await db
    .insert(kitchenStations)
    .values({ locationId, name: "Cocina", isDefault: true })
    .returning({ id: kitchenStations.id });

  const orderId = randomUUID();
  const [party] = await db
    .insert(parties)
    .values({ openedBy: randomUUID() })
    .returning({ id: parties.id });
  await db.insert(workingOrders).values({
    id: orderId,
    ...dashboardOrderAt(locationId),
    nodeId,
    orderNumber: 1,
    status: "open",
    partyId: party!.id,
  });
  const lineId = randomUUID();
  await db.insert(workingOrderLines).values({
    id: lineId,
    workingOrderId: orderId,
    lineNo: 1,
    name: "Burger",
    descriptions: { [LOCALE]: "Burger" },
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
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId, name: "Tables" })
    .returning({ id: floorZones.id });
  tableId = randomUUID();
  await db
    .insert(diningTables)
    .values({ id: tableId, locationId, zoneId: zone!.id, label: "Mesa 1" });
  await db.insert(floorTodayTables).values({ tableId: tableId });
  await db.insert(partyTables).values({ partyId: party!.id, tableId });

  cfg = {
    nodeId,
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
});

describe("the kitchen and floor read models on a real migrated venue", () => {
  it("omits missing-today and disabled-zone tables from both floor lists, keeping taken-off tables", async () => {
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Closed", active: false })
      .returning();
    const [normalZone] = await db.select().from(floorZones).where(eq(floorZones.name, "Tables"));
    const [absent, closed, takenOff] = await db
      .insert(diningTables)
      .values([
        { locationId: cfg.locationId, zoneId: normalZone!.id, label: "Absent" },
        { locationId: cfg.locationId, zoneId: zone!.id, label: "Closed" },
        { locationId: cfg.locationId, zoneId: normalZone!.id, label: "Spare" },
      ])
      .returning();
    await db
      .insert(floorTodayTables)
      .values([{ tableId: closed!.id }, { tableId: takenOff!.id, takenOff: true }]);
    await withTransaction(db, async (tx) => {
      const floor = await listTablesWithState(tx, cfg);
      const plain = await listTables(tx, cfg);
      const all = await listTables(tx, cfg, { includeDisabled: true });
      expect(floor.map((t) => t.id).sort()).toEqual([tableId, takenOff!.id].sort());
      expect(plain.map((t) => t.id).sort()).toEqual([tableId, takenOff!.id].sort());
      expect(all.map((t) => t.id).sort()).toEqual([tableId, absent!.id, takenOff!.id].sort());
      expect(all.some((t) => t.id === closed!.id)).toBe(false);
      expect(floor.find((t) => t.id === takenOff!.id)?.today?.takenOff).toBe(true);
    });
    await db.delete(floorTodayTables).where(eq(floorTodayTables.tableId, takenOff!.id));
    await db.delete(diningTables).where(eq(diningTables.id, takenOff!.id));
    await db.delete(floorTodayTables).where(eq(floorTodayTables.tableId, closed!.id));
    await db.delete(diningTables).where(eq(diningTables.id, closed!.id));
    await db.delete(diningTables).where(eq(diningTables.id, absent!.id));
    await db.delete(floorZones).where(eq(floorZones.id, zone!.id));
  });

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

  it("omits a made-here drink from kitchen and floor reads while retaining the burger", async () => {
    const [order] = await db.select({ id: workingOrders.id }).from(workingOrders);
    const [burger] = await db.select({ id: ticketItems.id }).from(ticketItems);
    await db.update(ticketItems).set({ state: "queued" }).where(eq(ticketItems.id, burger!.id));
    const drinkLine = randomUUID();
    await db.insert(workingOrderLines).values({
      id: drinkLine,
      workingOrderId: order!.id,
      lineNo: 2,
      name: "Lager",
      descriptions: { [LOCALE]: "Lager" },
      quantity: 1000,
      unitPriceGross: 121,
      vatClass: "general",
      lineTotal: 121,
    });
    await db.insert(ticketItems).values({
      nodeId: cfg.nodeId,
      workingOrderId: order!.id,
      workingOrderLineId: drinkLine,
      stationId,
      state: "ready",
      madeHere: true,
      queuedAt: new Date(Date.now() - 20 * MINUTE_MS).toISOString(),
      firedAt: nowIso(),
    });

    const [station, expo, floor] = await withTransaction(
      db,
      async (tx) =>
        [
          await listStationQueue(tx, stationId),
          await listExpoQueue(tx, cfg),
          await listTablesWithState(tx, cfg),
        ] as const,
    );
    expect(station.flatMap((group) => group.items).map((item) => item.name)).toEqual(["Burger"]);
    expect(expo).toHaveLength(1);
    expect(expo[0]!.groups.flatMap((group) => group.items).map((item) => item.name)).toEqual([
      "Burger",
    ]);
    expect(floor[0]).toMatchObject({ pendingToServe: 2, readyToServe: 0, timingBand: "fresh" });

    await db
      .update(ticketItems)
      .set({ state: "ready", awayAt: nowIso() })
      .where(eq(ticketItems.id, burger!.id));
    const afterHandover = await withTransaction(db, (tx) => listExpoQueue(tx, cfg));
    expect(afterHandover.map((order) => order.orderId)).not.toContain(order!.id);
  });

  it("removes an order with only a made-here item from expo", async () => {
    const orderId = randomUUID();
    await db.insert(workingOrders).values({
      id: orderId,
      ...dashboardOrderAt(cfg.locationId),
      nodeId: cfg.nodeId,
      orderNumber: 2,
      status: "open",
      deliveryTableId: tableId,
    });
    const lineId = randomUUID();
    await db.insert(workingOrderLines).values({
      id: lineId,
      workingOrderId: orderId,
      lineNo: 1,
      name: "Lager",
      descriptions: { [LOCALE]: "Lager" },
      quantity: 1000,
      unitPriceGross: 121,
      vatClass: "general",
      lineTotal: 121,
    });
    await db.insert(ticketItems).values({
      nodeId: cfg.nodeId,
      workingOrderId: orderId,
      workingOrderLineId: lineId,
      stationId,
      state: "ready",
      madeHere: true,
      queuedAt: nowIso(),
      firedAt: nowIso(),
    });
    const orders = await withTransaction(db, (tx) => listExpoQueue(tx, cfg));
    expect(orders.map((order) => order.orderId)).not.toContain(orderId);
    const [table] = await withTransaction(db, (tx) => listTablesWithState(tx, cfg));
    expect(table).toMatchObject({ pendingDeliveries: 0 });
  });
});

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
  await db
    .insert(workingOrders)
    .values({ id: orderId, tillId, nodeId, orderNumber: 1, status: "open", partyId: party!.id });
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
      tillId: cfg.tillId,
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

import { seedPerson } from "@waitron/db/testing/seed.js";
import { OFF_FLOOR } from "@waitron/db";
import {
  diningTables,
  floorZones,
  kitchenStations,
  nowIso,
  parties,
  partyTables,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import { seedNode, seedVenue, seedWorkingOrder, seedZone } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { listTables } from "./tables.js";
import { listStationQueue, listTablesWithState } from "./working-order.js";
import { readScopedPassBoard } from "./pass-board.js";
import { boardCards, boardItems, boardOrderIds, EVERY } from "./testing/pass-board-probe.js";
import { numberBill } from "./testing/bill-identities.js";
import type { TradingContext } from "./trading-context.js";

/** The three kitchen/floor read models, run against a real migrated venue database. */

const LOCALE = "es";
const MINUTE_MS = 60_000;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  resetPerTest: false,
});
let db: Database;
let cfg: TradingContext;
let stationId: string;
let tableId: string;

beforeAll(async () => {
  db = suite.db;
  await seedVenue(db, {
    name: "Counter",
    invoiceLocales: [LOCALE],
    operationDescription: "In-store sales",
  });
  const nodeId = await seedNode(db);
  [{ id: stationId }] = await db
    .insert(kitchenStations)
    .values({ name: "Kitchen", isDefault: true })
    .returning({ id: kitchenStations.id });

  const orderId = randomUUID();
  const [party] = await db
    .insert(parties)
    .values({ openedBy: await seedPerson(db, { displayName: randomUUID() }) })
    .returning({ id: parties.id });
  await seedWorkingOrder(db, {
    id: orderId,
    deviceId: null,
    nodeId,
    orderNumber: 1,
    status: "open",
    partyId: party!.id,
  });
  await withTransaction(db, (tx) => numberBill(tx, orderId, party!.id));
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
  const zone = await seedZone(db, { name: "Tables" });
  tableId = randomUUID();
  await db.insert(diningTables).values({ id: tableId, zoneId: zone!.id, label: "Table 1" });
  await db.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, tableId));
  await db.insert(partyTables).values({ partyId: party!.id, tableId });

  cfg = {
    nodeId,
    locale: LOCALE,
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
});

describe("the kitchen and floor read models on a real migrated venue", () => {
  it("omits missing-today and disabled-zone tables from both floor lists, keeping taken-off tables", async () => {
    const zone = await seedZone(db, { name: "Closed", active: false });
    const [normalZone] = await db.select().from(floorZones).where(eq(floorZones.name, "Tables"));
    const [absent, closed, takenOff] = await db
      .insert(diningTables)
      .values([
        { zoneId: normalZone!.id, label: "Absent" },
        { zoneId: zone!.id, label: "Closed" },
        { zoneId: normalZone!.id, label: "Spare" },
      ])
      .returning();
    for (const table of [closed!, takenOff!])
      await db
        .update(diningTables)
        .set({ onFloor: true, takenOff: table.id === takenOff!.id })
        .where(eq(diningTables.id, table.id));
    await withTransaction(db, async (tx) => {
      const floor = await listTablesWithState(tx);
      const plain = await listTables(tx, new Date());
      const all = await listTables(tx, new Date(), { includeDisabled: true });
      expect(floor.map((t) => t.id).sort()).toEqual([tableId, takenOff!.id].sort());
      expect(plain.map((t) => t.id).sort()).toEqual([tableId, takenOff!.id].sort());
      expect(all.map((t) => t.id).sort()).toEqual([tableId, absent!.id, takenOff!.id].sort());
      expect(all.some((t) => t.id === closed!.id)).toBe(false);
      expect(floor.find((t) => t.id === takenOff!.id)?.today?.takenOff).toBe(true);
    });
    await db.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, takenOff!.id));
    await db.delete(diningTables).where(eq(diningTables.id, takenOff!.id));
    await db.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, closed!.id));
    await db.delete(diningTables).where(eq(diningTables.id, closed!.id));
    await db.delete(diningTables).where(eq(diningTables.id, absent!.id));
    await db.delete(floorZones).where(eq(floorZones.id, zone!.id));
  });

  it("rolls an open tab up onto its table — counts, total and timing band", async () => {
    const [table] = await withTransaction(db, async (tx) => {
      return listTablesWithState(tx);
    });
    expect(table).toMatchObject({
      id: tableId,
      label: "Table 1",
      state: "open-tab",
      hasOpenTab: true,
      pendingToServe: 1,
      readyToServe: 1,
      pendingDeliveries: 0,
      // Three minutes queued against the station's five-minute warm threshold.
      timingBand: "fresh",
    });
    expect(table).not.toHaveProperty("enRoute");
  });

  it("lists the station queue with the item's age classified", async () => {
    const groups = await withTransaction(db, async (tx) => {
      return listStationQueue(tx, stationId);
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]).toMatchObject({ state: "ready", band: "fresh" });
  });

  it("puts the order on the pass board under its table", async () => {
    const board = await withTransaction(db, (tx) => readScopedPassBoard(tx, EVERY));
    const cards = boardCards(board);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.orders.map((order) => order.tableLabel)).toEqual(["Table 1"]);
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
          await readScopedPassBoard(tx, EVERY),
          await listTablesWithState(tx),
        ] as const,
    );
    expect(station.flatMap((group) => group.items).map((item) => item.name)).toEqual(["Burger"]);
    expect(boardCards(expo)).toHaveLength(1);
    expect(boardItems(expo).map((item) => item.name)).toEqual(["Burger"]);
    expect(floor[0]).toMatchObject({ pendingToServe: 2, readyToServe: 0, timingBand: "fresh" });

    await db.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.id, burger!.id));
    const afterReady = await withTransaction(db, (tx) => readScopedPassBoard(tx, EVERY));
    expect(boardOrderIds(afterReady)).toContain(order!.id);
  });

  it("removes an order with only a made-here item from expo", async () => {
    const orderId = randomUUID();
    await seedWorkingOrder(db, {
      id: orderId,
      deviceId: null,
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
    const board = await withTransaction(db, (tx) => readScopedPassBoard(tx, EVERY));
    expect(boardOrderIds(board)).not.toContain(orderId);
    const [table] = await withTransaction(db, (tx) => listTablesWithState(tx));
    expect(table).toMatchObject({ pendingDeliveries: 0 });
  });
});

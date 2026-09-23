import {
  diningTables,
  kitchenStations,
  locations,
  nowIso,
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
import { beforeAll, describe, expect, it } from "vitest";
import type { TillConfig } from "./till-config.js";
import { listExpoQueue, listStationQueue, listTablesWithState } from "./working-order.js";

/**
 * The three kitchen/floor read models, RUN against a real migrated venue database.
 *
 * They are here because nothing else in this package reaches them on this engine: every suite that
 * exercises `working-order.ts` through a route dies earlier in its own PostgreSQL-shaped fixture,
 * so the storage swap's changes to these three queries had no test running them at all. Each of the
 * three carried SQL this engine refuses — `now()`, `extract(epoch from ...)`, `::` casts, and in
 * `listTablesWithState` a `LEFT JOIN LATERAL`, `json_agg` and `json_build_object` — and every one of
 * those is a PREPARE-time refusal, so a suite that merely reaches the statement is the whole test.
 *
 * What this pins beyond acceptance: the tab roll-up's counts, which is where replacing the two
 * LATERAL joins with grouped derived tables could have changed the answer rather than the syntax.
 */

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

  // One open tab: a table seated with it, one unserved line, one fired ticket item queued three
  // minutes ago — old enough to be past the station's five-minute `warm_after_minutes` default?
  // No: three minutes is inside it, so the band stays `fresh` and the assertion below says so.
  const orderId = randomUUID();
  await db
    .insert(workingOrders)
    .values({ id: orderId, tillId, nodeId, orderNumber: 1, status: "open" });
  const lineId = randomUUID();
  await db.insert(workingOrderLines).values({
    id: lineId,
    workingOrderId: orderId,
    lineNo: 1,
    name: "Café",
    descriptions: { [LOCALE]: "Café" },
    quantity: 1000,
    unitPrice: 100,
    unitPriceGross: 121,
    vatRate: 2100,
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
  await db
    .insert(diningTables)
    .values({ id: tableId, locationId, label: "Mesa 1", capacity: 4, tabId: orderId });

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
      // `away_at`). These two are the aggregates the LATERAL rewrite could have changed.
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
    // Opened in this suite's own setup, so the count is 0 — `openedMinutes` moved out of SQL and
    // is a floored minute count either way.
    expect(orders[0]!.openedMinutes).toBe(0);
    expect(orders[0]!.tableLabel).toBe("Mesa 1");
  });
});

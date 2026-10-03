import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
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
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId as brandLocationId } from "@waitron/shared";
import { readRestOfOrder, restOfOrderQuery } from "./rest-of-order.js";
import { dashboardOrderAt } from "./testing/session-device.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;

beforeAll(() => {
  db = suite.db;
});

describe("rest of the order read", () => {
  it("returns other-station kitchen records in station and line order, excluding hidden and served work", async () => {
    await seedTenant(db);
    const locationId = randomUUID();
    await db.insert(locations).values({
      id: locationId,
      name: "Venue",
      invoiceLocales: ["en"],
      operationDescription: "Service",
    });
    const tillId = randomUUID();
    await db.insert(tills).values({ id: tillId, locationId, name: "Till" });
    const nodeId = await seedNode(db, brandLocationId(locationId));
    const stations = await db
      .insert(kitchenStations)
      .values([
        { locationId, name: "Fryer", isDefault: true },
        { locationId, name: "Grill" },
      ])
      .returning({ id: kitchenStations.id, name: kitchenStations.name });
    const station = (name: string) => stations.find((s) => s.name === name)!.id;
    const orderId = randomUUID();
    const otherOrderId = randomUUID();
    await db.insert(workingOrders).values([
      { id: orderId, ...dashboardOrderAt(locationId), nodeId, orderNumber: 1, status: "open" },
      { id: otherOrderId, ...dashboardOrderAt(locationId), nodeId, orderNumber: 2, status: "open" },
    ]);
    const cases = [
      {
        order: orderId,
        no: 3,
        name: "Staff chips",
        kitchen: "Kitchen chips",
        station: "Fryer",
        state: "preparing",
        held: false,
      },
      {
        order: orderId,
        no: 1,
        name: "Staff fish",
        kitchen: "Kitchen fish",
        station: "Fryer",
        state: "queued",
        held: true,
      },
      {
        order: orderId,
        no: 2,
        name: "Staff burger",
        kitchen: "Kitchen burger",
        station: "Grill",
        state: "ready",
        held: false,
      },
      {
        order: orderId,
        no: 4,
        name: "Made here",
        kitchen: null,
        station: "Fryer",
        state: "ready",
        held: false,
        madeHere: true,
      },
      {
        order: orderId,
        no: 5,
        name: "Away",
        kitchen: null,
        station: "Fryer",
        state: "ready",
        held: false,
        away: true,
      },
      {
        order: orderId,
        no: 6,
        name: "Served",
        kitchen: null,
        station: "Fryer",
        state: "ready",
        held: false,
        served: true,
      },
      {
        order: otherOrderId,
        no: 1,
        name: "Other order",
        kitchen: null,
        station: "Fryer",
        state: "queued",
        held: false,
      },
    ] as const;
    const ids: string[] = [];
    for (const item of cases) {
      const lineId = randomUUID();
      ids.push(lineId);
      await db.insert(workingOrderLines).values({
        id: lineId,
        workingOrderId: item.order,
        lineNo: item.no,
        name: item.name,
        kitchenName: item.kitchen,
        descriptions: { en: `Customer ${item.name}` },
        quantity: 9000,
        unitPriceGross: 100,
        vatClass: "general",
        lineTotal: 100,
        servedAt: "served" in item && item.served ? nowIso() : null,
      });
      await db.insert(ticketItems).values({
        nodeId,
        workingOrderId: item.order,
        workingOrderLineId: lineId,
        stationId: station(item.station),
        state: item.state,
        firedAt: item.held ? null : nowIso(),
        quantity: item.no * 1000,
        madeHere: "madeHere" in item && item.madeHere,
        awayAt: "away" in item && item.away ? nowIso() : null,
      });
    }
    const result = await withTransaction(db, (tx) => readRestOfOrder(tx, [orderId]));
    expect(
      result.get(orderId)?.map(({ name, stationName, quantity, state, held }) => ({
        name,
        stationName,
        quantity,
        state,
        held,
      })),
    ).toEqual([
      {
        name: "Kitchen fish",
        stationName: "Fryer",
        quantity: "1.000",
        state: "queued",
        held: true,
      },
      {
        name: "Kitchen chips",
        stationName: "Fryer",
        quantity: "3.000",
        state: "preparing",
        held: false,
      },
      {
        name: "Kitchen burger",
        stationName: "Grill",
        quantity: "2.000",
        state: "ready",
        held: false,
      },
    ]);
    expect(
      (await withTransaction(db, (tx) => readRestOfOrder(tx, [otherOrderId]))).get(otherOrderId),
    ).toHaveLength(1);
    expect(await withTransaction(db, (tx) => readRestOfOrder(tx, []))).toEqual(new Map());
  });

  it("uses the order index instead of scanning ticket items", async () => {
    const plan = await withTransaction(db, (tx) =>
      tx.execute<{ detail: string }>(
        sql`explain query plan ${restOfOrderQuery(tx, [randomUUID()]).getSQL()}`,
      ),
    );
    const details = plan.rows.map((row) => row.detail);
    expect(details.some((detail) => detail.startsWith("SCAN ticket_items"))).toBe(false);
    expect(details.some((detail) => detail.includes("ticket_items_order_idx"))).toBe(true);
  });
});

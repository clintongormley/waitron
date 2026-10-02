import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  kitchenStations,
  locations,
  products,
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
import { effectiveProductColumns, parentJoin, parentProducts } from "@waitron/catalogue";
import { dishKitchenItems, dishKitchenItemsQuery, onDishesOrTheirExtras } from "./dish-kitchen.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function seed() {
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
      { locationId, name: "Grill" },
      { locationId, name: "Fryer" },
    ])
    .returning({ id: kitchenStations.id, name: kitchenStations.name });
  const station = (name: string) => stations.find((s) => s.name === name)!.id;
  const orderId = randomUUID();
  await db.insert(workingOrders).values({ id: orderId, tillId, nodeId, orderNumber: 1 });
  const ids = {
    burger: randomUUID(),
    chips: randomUUID(),
    cheese: randomUUID(),
    second: randomUUID(),
    secondExtra: randomUUID(),
    empty: randomUUID(),
  };
  const lines = [
    { id: ids.burger, lineNo: 3, name: "Burger", quantity: 2000 },
    { id: ids.chips, lineNo: 1, name: "Chips", quantity: 1000, parentLineId: ids.burger },
    { id: ids.cheese, lineNo: 2, name: "Cheese", quantity: 1000, parentLineId: ids.burger },
    { id: ids.second, lineNo: 4, name: "Second", quantity: 3000 },
    {
      id: ids.secondExtra,
      lineNo: 5,
      name: "Second extra",
      quantity: 500,
      parentLineId: ids.second,
    },
    { id: ids.empty, lineNo: 6, name: "Empty", quantity: 1000 },
  ];
  await db.insert(workingOrderLines).values(
    lines.map((line) => ({
      ...line,
      workingOrderId: orderId,
      descriptions: { en: line.name },
      unitPriceGross: 100,
      vatClass: "general",
      lineTotal: 100,
    })),
  );
  const records = { burger: randomUUID(), chips: randomUUID(), secondExtra: randomUUID() };
  await db.insert(ticketItems).values([
    {
      id: records.burger,
      nodeId,
      workingOrderId: orderId,
      workingOrderLineId: ids.burger,
      stationId: station("Grill"),
      quantity: 1500,
      state: "preparing",
    },
    {
      id: records.chips,
      nodeId,
      workingOrderId: orderId,
      workingOrderLineId: ids.chips,
      stationId: station("Fryer"),
      quantity: null,
    },
    {
      id: records.secondExtra,
      nodeId,
      workingOrderId: orderId,
      workingOrderLineId: ids.secondExtra,
      stationId: station("Fryer"),
      quantity: 400,
    },
  ]);
  return { ids, records, orderId, station };
}

describe("dish kitchen records", () => {
  it("returns own work before extras and a dish served only by an extra", async () => {
    const { ids, records, orderId, station } = await seed();
    const result = await withTransaction(db, (tx) =>
      dishKitchenItems(tx, [ids.burger, ids.second, ids.empty]),
    );
    expect([...result.keys()]).toEqual([ids.burger, ids.second]);
    expect(result.get(ids.burger)).toEqual([
      {
        ticketItemId: records.burger,
        workingOrderLineId: ids.burger,
        dishLineId: ids.burger,
        extra: false,
        workingOrderId: orderId,
        stationId: station("Grill"),
        courseId: null,
        firedAt: null,
        state: "preparing",
        firedQuantity: 1500,
        lineQuantity: 2000,
      },
      {
        ticketItemId: records.chips,
        workingOrderLineId: ids.chips,
        dishLineId: ids.burger,
        extra: true,
        workingOrderId: orderId,
        stationId: station("Fryer"),
        courseId: null,
        firedAt: null,
        state: "queued",
        firedQuantity: 1000,
        lineQuantity: 1000,
      },
    ]);
    expect(result.get(ids.second)).toEqual([
      {
        ticketItemId: records.secondExtra,
        workingOrderLineId: ids.secondExtra,
        dishLineId: ids.second,
        extra: true,
        workingOrderId: orderId,
        stationId: station("Fryer"),
        courseId: null,
        firedAt: null,
        state: "queued",
        firedQuantity: 400,
        lineQuantity: 500,
      },
    ]);
    expect(await withTransaction(db, (tx) => dishKitchenItems(tx, []))).toEqual(new Map());
  });

  it("updates a dish's own and extra records without touching another dish", async () => {
    const { ids, records } = await seed();
    const firedAt = "2026-10-02T10:00:00.000Z";
    await withTransaction(db, (tx) =>
      tx
        .update(ticketItems)
        .set({ firedAt })
        .where(onDishesOrTheirExtras(tx, [ids.burger])),
    );
    const rows = await db
      .select({ id: ticketItems.id, firedAt: ticketItems.firedAt })
      .from(ticketItems);
    expect(new Map(rows.map((r) => [r.id, r.firedAt]))).toEqual(
      new Map([
        [records.burger, firedAt],
        [records.chips, firedAt],
        [records.secondExtra, null],
      ]),
    );
  });

  it("plans all three emitted reads and updates through the parent index", async () => {
    const a = randomUUID(),
      b = randomUUID();
    const queries = await withTransaction(db, async (tx) => [
      dishKitchenItemsQuery(tx, [a, b]),
      tx
        .update(ticketItems)
        .set({ firedAt: "2026-10-02T10:00:00.000Z" })
        .where(onDishesOrTheirExtras(tx, [a, b])),
      tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          descriptions: workingOrderLines.descriptions,
          addAllergens: effectiveProductColumns.allergens,
          dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
        })
        .from(workingOrderLines)
        .leftJoin(products, eq(products.id, workingOrderLines.productId))
        .leftJoin(parentProducts, parentJoin)
        .where(inArray(workingOrderLines.parentLineId, [a, b]))
        .orderBy(workingOrderLines.lineNo),
    ]);
    const plans = async () =>
      Promise.all(
        queries.map(async (query) => {
          const emitted = query.toSQL();
          expect(emitted.sql).toBeTruthy();
          const result = await db.execute<{ detail: string }>(
            sql`explain query plan ${query.getSQL()}`,
          );
          return result.rows.map((row) => row.detail);
        }),
      );
    const indexed = await plans();
    for (const details of indexed)
      expect(details.some((d) => d.includes("USING INDEX working_order_lines_parent_idx"))).toBe(
        true,
      );
    for (const details of indexed.slice(0, 2)) expect(details).toContain("MULTI-INDEX OR");
    db.run(sql`drop index working_order_lines_parent_idx`);
    const unindexed = await plans();
    for (const details of unindexed) {
      expect(details.some((d) => d.includes("working_order_lines_parent_idx"))).toBe(false);
      expect(details.some((d) => d.startsWith("SCAN "))).toBe(true);
    }
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { allocateOrderNumber } from "./allocate-order-number.js";
import type { Database, Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";
import { seedNode, seedVenue, seedWorkingOrder } from "./testing/seed.js";
import { withTransaction } from "./tenancy.js";

let nodeA1 = "";
let nodeA2 = "";

async function seed(db: Database): Promise<void> {
  await seedVenue(db, {
    name: "Fixture Venue A",
    invoiceLocales: ["es"],
  });
  nodeA1 = await seedNode(db);
  nodeA2 = await seedNode(db);
}

async function allocateBill(tx: Transaction, nodeId: string): Promise<number> {
  const orderNumber = await allocateOrderNumber(tx);
  await seedWorkingOrder(tx, { nodeId, orderNumber });
  return orderNumber;
}

describe("allocateOrderNumber", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("a number a bill holds is refused a second time", async () => {
    await seedWorkingOrder(db, { orderNumber: 7 });
    await expect(seedWorkingOrder(db, { orderNumber: 7 })).rejects.toThrow(
      "UNIQUE constraint failed: working_orders.order_number",
    );
    expect((await seedWorkingOrder(db, { orderNumber: 8 })).orderNumber).toBe(8);
  });

  it("allocates 1, then 2, for a node", async () => {
    await withTransaction(db, async (tx) => {
      expect(await allocateBill(tx, nodeA1)).toBe(1);
      expect(await allocateBill(tx, nodeA1)).toBe(2);
    });
  });

  it("numbers never repeat across boxes", async () => {
    const a1 = await withTransaction(db, (tx) => allocateBill(tx, nodeA1));
    const a2 = await withTransaction(db, (tx) => allocateBill(tx, nodeA1));
    const b1 = await withTransaction(db, (tx) => allocateBill(tx, nodeA2));
    const a3 = await withTransaction(db, (tx) => allocateBill(tx, nodeA1));
    expect([a1, a2, b1, a3]).toEqual([1, 2, 3, 4]);
  });

  it("a box's first number follows the highest of any box", async () => {
    await withTransaction(db, (tx) => seedWorkingOrder(tx, { nodeId: nodeA1, orderNumber: 5 }));
    const first = await withTransaction(db, (tx) => allocateBill(tx, nodeA2));
    const second = await withTransaction(db, (tx) => allocateBill(tx, nodeA2));
    expect([first, second]).toEqual([6, 7]);
  });

  it("a box that took back carries on above every number", async () => {
    await withTransaction(db, async (tx) => {
      await seedWorkingOrder(tx, { nodeId: nodeA1, orderNumber: 5 });
      await seedWorkingOrder(tx, { nodeId: nodeA2, orderNumber: 7 });
    });
    expect(await withTransaction(db, (tx) => allocateBill(tx, nodeA1))).toBe(8);
  });

  it("returns the allocated number as a JS number, not a string", async () => {
    const n = await withTransaction(db, (tx) => allocateOrderNumber(tx));
    expect(typeof n).toBe("number");
  });
});

const WRITERS = 20;

describe("allocateOrderNumber under overlapping callers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  async function freshTaxpayerNode(db: Database): Promise<{ nodeId: string }> {
    await seedVenue(db, {
      name: "Fixture Venue",
      invoiceLocales: ["es"],
    });
    const nodeId = await seedNode(db);
    return { nodeId };
  }

  it("hands out distinct numbers to allocators started together", async () => {
    const { nodeId } = await freshTaxpayerNode(suite.db);
    const results = await Promise.all(
      Array.from({ length: WRITERS }, () =>
        withTransaction(suite.db, (tx) => allocateBill(tx, nodeId)),
      ),
    );
    expect(new Set(results).size).toBe(WRITERS);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(WRITERS);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { allocateOrderNumber } from "./allocate-order-number.js";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { workingOrderCounters } from "./schema/working-order-counters.js";
import { useVenueDb } from "./testing/venue-db.js";
import { seedNode, seedVenue } from "./testing/seed.js";
import { withTransaction } from "./tenancy.js";

// One counter row per node; two nodes give the cross-box cases a real second row.
let nodeA1 = "";
let nodeA2 = "";

async function seed(db: Database): Promise<void> {
  await seedVenue(db, {
    name: "Fixture Venue A",
    invoiceLocales: ["es"],
    operationDescription: "Hostelería",
  });
  nodeA1 = await seedNode(db);
  nodeA2 = await seedNode(db);
}

describe("allocateOrderNumber", () => {
  // One migrated database, emptied between tests by the helper's default reset.
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("allocates 1, then 2, for a node", async () => {
    await withTransaction(db, async (tx) => {
      expect(await allocateOrderNumber(tx, nodeA1)).toBe(1);
      expect(await allocateOrderNumber(tx, nodeA1)).toBe(2);
    });
  });

  it("numbers never repeat across boxes", async () => {
    const a1 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    const a2 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    const b1 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA2));
    const a3 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    expect([a1, a2, b1, a3]).toEqual([1, 2, 3, 4]);
  });

  it("a box's first number follows the highest of any box", async () => {
    await withTransaction(db, (tx) =>
      tx.insert(workingOrderCounters).values({ nodeId: nodeA1, nextNumber: 5 }),
    );
    const first = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA2));
    const second = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA2));
    expect([first, second]).toEqual([6, 7]);
  });

  it("a box that took back carries on above every number", async () => {
    await withTransaction(db, (tx) =>
      tx.insert(workingOrderCounters).values([
        { nodeId: nodeA1, nextNumber: 5 },
        { nodeId: nodeA2, nextNumber: 7 },
      ]),
    );
    expect(await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1))).toBe(8);
    const rows = await db
      .select({ nodeId: workingOrderCounters.nodeId, nextNumber: workingOrderCounters.nextNumber })
      .from(workingOrderCounters);
    expect(Object.fromEntries(rows.map((r) => [r.nodeId, r.nextNumber]))).toEqual({
      [nodeA1]: 8,
      [nodeA2]: 7,
    });
  });

  it("returns the allocated number as a JS number, not a string", async () => {
    // A RETURNING expression that produced a decimal would render as a string that compares == 1
    // but not toBe(1), and would reach order_number as text — the same trap
    // allocate-number.test.ts guards for invoice numbers.
    const n = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    expect(typeof n).toBe("number");
  });
});

// The number of allocators started together.
const WRITERS = 20;

/**
 * What the overlapping calls below test is that the venue file's WRITE QUEUE serialises them:
 * `withTransaction` runs each body inside `db.withWriteLock`, so the next caller's transaction does
 * not begin until the previous one has committed. The receipt for the queue itself, with a control
 * in the other direction, is `racePair` in `packages/menu/test/fixtures.ts`.
 */
describe("allocateOrderNumber under overlapping callers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  async function freshTenantNode(db: Database): Promise<{ nodeId: string }> {
    await seedVenue(db, {
      name: "Fixture Venue",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    const nodeId = await seedNode(db);
    return { nodeId };
  }

  it("hands out distinct numbers to allocators started together", async () => {
    const { nodeId } = await freshTenantNode(suite.db);
    const results = await Promise.all(
      Array.from({ length: WRITERS }, () =>
        withTransaction(suite.db, (tx) => allocateOrderNumber(tx, nodeId)),
      ),
    );
    expect(new Set(results).size).toBe(WRITERS);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(WRITERS);
  });
});

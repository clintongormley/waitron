// LOSS, from the storage swap: every `asAppUser` wrapper here was the point of the case it sat in
// — the allocator is the first writer of `working_order_counters`, so running it as the non-owner
// role was what showed the INSERT and the ON CONFLICT UPDATE both passed that table's grants.
// SQLite has no roles and no grants (`packages/db/src/testing/roles.ts`), so nothing here says
// anything about privileges any more.
import { beforeEach, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { allocateOrderNumber } from "./allocate-order-number.js";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { locations, tenants } from "./schema/tenants.js";
import { useVenueDb } from "./testing/venue-db.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { withTransaction } from "./tenancy.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

// One counter per node. Two nodes give the independence test a real second
// key — the property the park path depends on is that one register's
// held-order numbering never disturbs another's.
let nodeA1 = "";
let nodeA2 = "";

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      name: "Fixture Location A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  nodeA1 = await seedNode(db, brandLocationId(LOCATION_A));
  nodeA2 = await seedNode(db, brandLocationId(LOCATION_A));
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

  it("numbers each node independently", async () => {
    const a1 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    const a2 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA1));
    // nodeA2's counter is untouched by nodeA1's two allocations: it starts at 1.
    const b1 = await withTransaction(db, (tx) => allocateOrderNumber(tx, nodeA2));
    expect([a1, a2, b1]).toEqual([1, 2, 1]);
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
 * WHAT THIS BLOCK NOW SHOWS, AND WHAT IT NO LONGER DOES.
 *
 * On PostgreSQL it opened `WRITERS` separate connections, asserted they were distinct backend
 * PROCESSES (`pg_backend_pid`), and raced them at one node's counter — a read-then-write allocator
 * handed the same number out twice there. That whole shape is gone: SQLite has one connection per
 * file and no backend to have a pid, so `suite.pg.connect()` has no counterpart and the
 * distinct-pid guard cannot be written at all.
 *
 * What the overlapping calls below test instead is that the venue file's WRITE QUEUE serialises
 * them: `withTransaction` runs each body inside `db.withWriteLock`, and
 * `packages/store/src/write-queue.ts` issues `begin immediate` and `commit` around it, so the next
 * caller's transaction does not begin until the previous one has committed. Twenty distinct,
 * contiguous numbers is what that produces. The receipt for the queue itself, with a control in the
 * other direction, is `racePair` in `packages/catalogue/test/fixtures.ts`.
 */
describe("allocateOrderNumber under overlapping callers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  // A FRESH location + node per case, leaving the rows independent of any other test's.
  // `working_order_counters` reaches append-only fiscal tables by foreign key, so the PostgreSQL
  // version could not wipe it between tests; the same shape is kept here. The taxpayer row is a
  // singleton, so `seedTenant` only makes sure it is there.
  async function freshTenantNode(db: Database): Promise<{ nodeId: string }> {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Fixture Location",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      })
      .returning({ id: locations.id });
    const nodeId = await seedNode(db, brandLocationId(location!.id));
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

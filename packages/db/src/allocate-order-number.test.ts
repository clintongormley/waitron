import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { allocateOrderNumber } from "./allocate-order-number.js";
import type { Database } from "./client.js";
import { locations, tenants } from "./schema/tenants.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";
import { seedNode } from "./testing/seed.js";
import { withTenant } from "./tenancy.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

// One counter per (tenant, node). Two nodes of the SAME tenant give the
// independence test a real second key without a second tenant — the property
// the park path depends on is that one register's held-order numbering never
// disturbs another's.
let nodeA1 = "";
let nodeA2 = "";

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  nodeA1 = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeA2 = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
}

describeEachTarget("allocateOrderNumber", (target) => {
  let db: Database;

  beforeEach(async () => {
    // target.create() (testing/harness.ts) returns a freshly migrated, empty
    // database per test, so no truncate is needed — the same reasoning
    // allocate-number.test.ts records for dropping its own no-op truncate.
    db = await target.create();
    await seed(db);
  });

  // Guarded, per the package convention: without it the pg Pool a postgres
  // target opens per test is left open when the container stops at
  // describe-level teardown, surfacing as an unhandled FATAL 57P01 rejection
  // rather than a test failure.
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("allocates 1, then 2, for a (tenant, node)", async () => {
    // Run under the non-owner app role so the INSERT and the ON CONFLICT UPDATE
    // both pass the counter's WITH CHECK and its SELECT/INSERT/UPDATE grants —
    // the allocator is the first writer of this table (Task 1's deferred Minor).
    await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      expect(await allocateOrderNumber(tx, TENANT_A, nodeA1)).toBe(1);
      expect(await allocateOrderNumber(tx, TENANT_A, nodeA1)).toBe(2);
    });
  });

  it("numbers each (tenant, node) independently", async () => {
    const a1 = await withTenant(db, TENANT_A, (tx) => allocateOrderNumber(tx, TENANT_A, nodeA1));
    const a2 = await withTenant(db, TENANT_A, (tx) => allocateOrderNumber(tx, TENANT_A, nodeA1));
    // nodeA2's counter is untouched by nodeA1's two allocations: it starts at 1.
    const b1 = await withTenant(db, TENANT_A, (tx) => allocateOrderNumber(tx, TENANT_A, nodeA2));
    expect([a1, a2, b1]).toEqual([1, 2, 1]);
  });

  it("returns the allocated number as a JS number, not a string", async () => {
    // next_number is integer, which node-postgres renders as a number. A widening
    // to bigint, or a RETURNING expression producing numeric, would render as a
    // string that compares == 1 but not toBe(1) and would reach order_number as
    // text — the same trap allocate-number.test.ts guards for invoice numbers.
    const n = await withTenant(db, TENANT_A, (tx) => allocateOrderNumber(tx, TENANT_A, nodeA1));
    expect(typeof n).toBe("number");
  });
});

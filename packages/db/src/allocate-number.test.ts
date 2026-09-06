// Real PostgreSQL checks app_user allocation grants and competing backends.
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  AppError,
  locationId as brandLocationId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import { allocateInvoiceNumber } from "./allocate-number.js";
import type { Database } from "./client.js";
import { invoiceSeries } from "./schema/series.js";
import { locations, tenants, tills } from "./schema/tenants.js";
import { describeEachTarget } from "./testing/harness.js";
import { asAppUser } from "./testing/roles.js";
import { seedNode } from "./testing/seed.js";
import { withTenant } from "./tenancy.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const UNKNOWN_SERIES = "00000000-0000-4000-8000-000000000000";

// A series is keyed on its NODE since the node-id rekey (2026-08-03); seed() creates one node per
// tenant and makeSeries points a series at it. The tills stay seeded because sales still ring on a
// till, but invoice_series no longer carries till_id.
let nodeA1 = "";

async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA1 = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  await seedNode(db, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
}

async function makeSeries(
  db: Database,
  values: { tenantId: string; nodeId: string; code: string; nextNumber?: number },
): Promise<string> {
  const [row] = await db
    .insert(invoiceSeries)
    .values({ ...values, purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  return row.id;
}

describeEachTarget("allocateInvoiceNumber", (target) => {
  let db: Database;

  beforeEach(async () => {
    // No truncate before seed(): target.create() (testing/harness.ts) already
    // returns a freshly migrated, empty database per test, so the truncate
    // this beforeEach used to run was always a no-op. Removed rather than
    // kept as harmless boilerplate: Task 8 added sales/sale_lines/tenders,
    // which are append-only and reachable by FK cascade from tenants, and
    // TRUNCATE ... CASCADE fires the BEFORE TRUNCATE trigger on every table it
    // cascades into, not only the one named in the statement — verified live.
    // A `truncate table tenants cascade` here would now fail this hook on
    // every test in the file with "table sales is append-only: TRUNCATE is
    // not permitted", for a statement that was never doing anything to begin
    // with.
    db = await target.create();
    await seed(db);
  });

  // This package's convention (see tenancy.test.ts): without it, a pg Pool
  // per test is left open when the postgres target's container stops at
  // describe-level teardown, and it surfaces as an unhandled FATAL 57P01
  // rejection rather than a test failure.
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("returns the starting number on the first allocation", async () => {
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const n = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(n).toBe(1);
  });

  it("honours a starting number other than 1", async () => {
    // A venue migrating from another system continues its existing numbering.
    // Hardcoding a start of 1 would silently restart the numbering and produce
    // duplicate numbers against records the tax authority already holds.
    const seriesId = await makeSeries(db, {
      tenantId: TENANT_A,
      nodeId: nodeA1,
      code: "FA",
      nextNumber: 5000,
    });
    const first = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    const second = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect([first, second]).toEqual([5000, 5001]);
  });

  it("increases strictly across successive allocations", async () => {
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const allocated: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      allocated.push(await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId)));
    }
    expect(allocated).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a number as a JS number, not a string", async () => {
    // `next_number` is integer, which node-postgres renders as a number — but
    // a widening of the column to bigint, or a RETURNING expression that
    // produces numeric, would render as a string instead. An unconverted "1"
    // compares equal to 1 under == but not under toBe, and would reach the
    // invoice number column as text.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const n = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(typeof n).toBe("number");
  });

  it("returns the number to the series when the transaction rolls back", async () => {
    // Allocation is transactional, so an abort un-does it and no gap appears.
    // This is correct: the regulation requires strictly-increasing and
    // never-reused numbering and *permits* gaps without requiring them, so a
    // returned number satisfies it. Asserting `2` here would be asserting that
    // the counter escaped its transaction, which is the behaviour this task
    // deliberately does not implement.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    let allocated = 0;
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        allocated = await allocateInvoiceNumber(tx, seriesId);
        // Stands in for every abort: a failed write, a crashed process, a
        // declined card after the number was taken.
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow(/deliberate rollback/);
    expect(allocated).toBe(1);

    const next = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(next).toBe(1);
  });

  it("hands out no number twice across interleaved aborts and commits", async () => {
    // The property the regulation actually requires: never reused **once
    // used**. A rolled-back allocation was never used — nothing was recorded
    // under it and no receipt bearing it exists — so handing it out again is
    // not reuse. What must never happen is two *committed* sales sharing a
    // number, and that is enforced by UNIQUE (tenant_id, series_id,
    // invoice_number) on `sales`, which Task 8 creates and Task 16 exercises
    // against the live write path.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const committed: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const abort = i % 2 === 0;
      await withTenant(db, TENANT_A, async (tx) => {
        const n = await allocateInvoiceNumber(tx, seriesId);
        if (abort) throw new Error("abort");
        committed.push(n);
      }).catch(() => undefined);
    }
    // Three commits, three consecutive numbers, no duplicates. The aborted
    // allocations left nothing behind and consumed nothing.
    expect(committed).toEqual([1, 2, 3]);
    expect(new Set(committed).size).toBe(committed.length);
  });

  it("allocates independently for two series on the same node", async () => {
    // One node, N series, one chain. The two counters must not interfere, and
    // neither may be derived from the other.
    const fa = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const ra = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "RA" });
    const a1 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, fa));
    const b1 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, ra));
    const a2 = await withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, fa));
    expect([a1, b1, a2]).toEqual([1, 1, 2]);
  });

  it("allocates as the app role", async () => {
    // The application never runs as owner. If the column-scoped
    // GRANT UPDATE (next_number) is missing, allocation works in every test
    // that skips asAppUser and fails only in production — the exact shape of a
    // suite that asserts nothing.
    const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
    const n = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return allocateInvoiceNumber(tx, seriesId);
    });
    expect(n).toBe(1);
  });

  it("throws series.not_found for an unknown series", async () => {
    const error = await withTenant(db, TENANT_A, (tx) =>
      allocateInvoiceNumber(tx, UNKNOWN_SERIES),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("series.not_found");
    expect((error as AppError).params).toEqual({ seriesId: UNKNOWN_SERIES });
  });

  it.runIf(target.name === "postgres")(
    "hands out distinct numbers to twenty concurrent allocators",
    async () => {
      // PGlite cannot run this: concurrent queries serialise onto one backend,
      // so a read-then-write implementation passes there by accident. Running
      // it on PGlite would be worse than skipping it — a green result that
      // means nothing. Real Postgres only, per the Global Constraint.
      const seriesId = await makeSeries(db, { tenantId: TENANT_A, nodeId: nodeA1, code: "FA" });
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          withTenant(db, TENANT_A, (tx) => allocateInvoiceNumber(tx, seriesId)),
        ),
      );
      expect(new Set(results).size).toBe(20);
      expect(Math.min(...results)).toBe(1);
      expect(Math.max(...results)).toBe(20);
    },
  );
});

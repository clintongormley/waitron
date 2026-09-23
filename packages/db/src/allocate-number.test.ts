// LOSS, from the storage swap: the "allocates as the app role" case below used to run the
// allocation as the non-owner `app_user` on a real PostgreSQL, and its whole point was the
// COLUMN-SCOPED `grant update (next_number)` — without that grant, allocation worked in every test
// that skipped the role switch and failed only in production. SQLite has no roles and no grants
// (`packages/db/src/testing/roles.ts`), so that case now duplicates the first one and is deleted.
// Nothing states which privileges this allocation needed.
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { allocateInvoiceNumber } from "./allocate-number.js";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { invoiceSeries } from "./schema/series.js";
import { locations, tenants, tills } from "./schema/tenants.js";
import { useVenueDb } from "./testing/venue-db.js";
import { seedNode } from "./testing/seed.js";
import { withTransaction } from "./tenancy.js";

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
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA1 = await seedNode(db, brandLocationId(LOCATION_A));
  await seedNode(db, brandLocationId(LOCATION_B));
}

async function makeSeries(
  db: Database,
  values: { nodeId: string; code: string; nextNumber?: number },
): Promise<string> {
  const [row] = await db
    .insert(invoiceSeries)
    .values({ ...values, purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  return row.id;
}

describe("allocateInvoiceNumber", () => {
  // One migrated database, emptied between tests by the helper's default reset — what the per-test
  // `target.create()` this replaces bought, without building a fresh file each time.
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("returns the starting number on the first allocation", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const n = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(n).toBe(1);
  });

  it("honours a starting number other than 1", async () => {
    // A venue migrating from another system continues its existing numbering.
    // Hardcoding a start of 1 would silently restart the numbering and produce
    // duplicate numbers against records the tax authority already holds.
    const seriesId = await makeSeries(db, {
      nodeId: nodeA1,
      code: "FA",
      nextNumber: 5000,
    });
    const first = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    const second = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect([first, second]).toEqual([5000, 5001]);
  });

  it("increases strictly across successive allocations", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const allocated: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      allocated.push(await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId)));
    }
    expect(allocated).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a number as a JS number, not a string", async () => {
    // `next_number` is integer, which node-postgres renders as a number — but
    // a widening of the column to bigint, or a RETURNING expression that
    // produces numeric, would render as a string instead. An unconverted "1"
    // compares equal to 1 under == but not under toBe, and would reach the
    // invoice number column as text.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const n = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(typeof n).toBe("number");
  });

  it("returns the number to the series when the transaction rolls back", async () => {
    // Allocation is transactional, so an abort un-does it and no gap appears.
    // This is correct: the regulation requires strictly-increasing and
    // never-reused numbering and *permits* gaps without requiring them, so a
    // returned number satisfies it. Asserting `2` here would be asserting that
    // the counter escaped its transaction, which is the behaviour this task
    // deliberately does not implement.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    let allocated = 0;
    await expect(
      withTransaction(db, async (tx) => {
        allocated = await allocateInvoiceNumber(tx, seriesId);
        // Stands in for every abort: a failed write, a crashed process, a
        // declined card after the number was taken.
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow(/deliberate rollback/);
    expect(allocated).toBe(1);

    const next = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(next).toBe(1);
  });

  it("hands out no number twice across interleaved aborts and commits", async () => {
    // The property the regulation actually requires: never reused **once
    // used**. A rolled-back allocation was never used — nothing was recorded
    // under it and no receipt bearing it exists — so handing it out again is
    // not reuse. What must never happen is two *committed* sales sharing a
    // number, and that is enforced by UNIQUE (series_id,
    // invoice_number) on `sales`, which Task 8 creates and Task 16 exercises
    // against the live write path.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const committed: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const abort = i % 2 === 0;
      await withTransaction(db, async (tx) => {
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
    const fa = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const ra = await makeSeries(db, { nodeId: nodeA1, code: "RA" });
    const a1 = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, fa));
    const b1 = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, ra));
    const a2 = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, fa));
    expect([a1, b1, a2]).toEqual([1, 1, 2]);
  });

  it("throws series.not_found for an unknown series", async () => {
    const error = await withTransaction(db, (tx) =>
      allocateInvoiceNumber(tx, UNKNOWN_SERIES),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("series.not_found");
    expect((error as AppError).params).toEqual({ seriesId: UNKNOWN_SERIES });
  });

  it("hands out distinct numbers to twenty allocators started together", async () => {
    // WHAT THIS CASE NOW SHOWS, AND WHAT IT NO LONGER DOES. On PostgreSQL it ran on the real
    // container only, because twenty allocators on twenty backends could genuinely collide and a
    // read-then-write allocator handed the same number out twice; on PGlite every query landed on
    // one backend, so a pass there meant nothing and the case was skipped.
    //
    // SQLite admits one writer per file and has no row locks, so the collision this guarded
    // against cannot arise: `withTransaction` runs each body inside the venue file's write queue
    // (`packages/store/src/write-queue.ts`), which issues `begin immediate` and `commit` around it,
    // so the next caller's transaction does not start until the previous one has committed. What
    // twenty overlapping calls test HERE is that the queue actually serialises them — twenty
    // distinct, contiguous numbers — and not that a lock holds under contention. The receipt for
    // the queue itself, with a control in the other direction, is `racePair` in
    // `packages/catalogue/test/fixtures.ts`.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId)),
      ),
    );
    expect(new Set(results).size).toBe(20);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(20);
  });
});

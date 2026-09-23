import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { CORE_MIGRATIONS } from "../migrations.js";
import { TRIGGER_ABORT } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { dailyCloses, type DailyCloseSnapshot } from "./daily-closes.js";
import { locations, tenants } from "./tenants.js";

// The headline assertion is that `daily_closes` refuses a rewrite: the append-only triggers
// `@waitron/store` installs for every table a module declared `appendOnly()`
// (`packages/store/src/append-only.ts`), which `useVenueDb` installs from `CORE_MIGRATIONS`'
// own `appendOnlyTables` list.
//
// THREE LOSSES, from the storage swap:
//  - the PostgreSQL version's refusal was a LAYERED proof, on the grounds that a trigger nobody
//    has seen fire is a comment, not a backstop. There is only one layer left and the refusal
//    below is simply the trigger's.
//  - the TRUNCATE case is deleted. SQLite has no `TRUNCATE` statement and no trigger event for
//    `DROP TABLE`, so the statement-level trigger that blocked a table-wide wipe has no counterpart
//    at all (`packages/store/src/append-only.ts` says so in its own words). What a caller that can
//    issue DDL may still do to this table is refused by nothing. The DELETE case below is what this
//    engine offers in its place, and it is a narrower claim.
//  - the snapshot column was `jsonb` and is now `text` in JSON mode, so the read-back below goes
//    through Drizzle's decoding rather than a `->>` path expression the database evaluates.

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
// The counting actor recorded in `closed_by` — an identity person id, plain uuid, no FK.
const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

// Captured at seed time — the node id the inserts below need as the foreign-key target.
let nodeA = "";

// A minimal-but-real snapshot document: `close` is the VAT-exact computeDailyClose output (owned by
// @waitron/reporting, opaque `unknown` here) and `cashReconciliation` is the per-till/per-node
// variance block. Stored verbatim; the readback below proves the column round-trips a nested value.
function snapshot(nodeVariance: string): DailyCloseSnapshot {
  return {
    close: { vat: { taxTotal: "12.35" }, cash: {}, counts: { sales: 3, corrections: 0, voids: 0 } },
    cashReconciliation: {
      byTill: [
        {
          tillId: "dddddddd-0000-4000-8000-000000000001",
          openingFloat: "50.00",
          payouts: "0.00",
          countedCash: "173.45",
          cashTakings: "123.45",
          cashVariance: nodeVariance,
        },
      ],
      nodeVariance,
    },
  };
}

describe("frozen daily close schema (append-only triggers, columns, FK)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hosteleria",
      },
    ]);
    nodeA = await seedNode(db, brandLocationId(LOCATION_A));
  });

  // The Drizzle builder rather than raw SQL: `id` and `closed_at` are `$defaultFn` columns Drizzle
  // applies CLIENT-side, so a raw `insert` reaches neither and the row is refused NOT NULL. The
  // column LIST the PostgreSQL version pinned by writing raw SQL is still pinned, by the builder
  // refusing to compile a field the table does not declare.
  function insertClose(opts: { businessDay: string; sequenceNo: number; variance?: string }) {
    return withTransaction(suite.db, (tx) =>
      tx.insert(dailyCloses).values({
        nodeId: nodeA,
        businessDay: opts.businessDay,
        sequenceNo: opts.sequenceNo,
        prevEntryHash: "",
        entryHash: "A".repeat(64),
        closedBy: CLOSED_BY,
        snapshot: snapshot(opts.variance ?? "0.00"),
      }),
    );
  }

  it("writes and reads back a daily_closes row (the column list, and the snapshot document)", async () => {
    // The positive control for the trigger rejections below: without a write that SUCCEEDS, a
    // rejection could equally mean the table is unreachable. It also pins that the nested snapshot
    // round-trips.
    await insertClose({ businessDay: "2026-08-01", sequenceNo: 1, variance: "1.23" });
    const [row] = await withTransaction(suite.db, (tx) =>
      tx
        .select()
        .from(dailyCloses)
        .where(and(eq(dailyCloses.nodeId, nodeA), eq(dailyCloses.businessDay, "2026-08-01"))),
    );
    expect(row?.sequenceNo).toBe(1);
    expect(row?.prevEntryHash).toBe("");
    expect(row?.entryHash).toBe("A".repeat(64));
    expect(row?.closedBy).toBe(CLOSED_BY);
    expect(row?.snapshot.cashReconciliation.nodeVariance).toBe("1.23");
  });

  it("rejects an UPDATE of daily_closes, via the append-only trigger", async () => {
    await insertClose({ businessDay: "2026-08-04", sequenceNo: 4 });
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx
          .update(dailyCloses)
          .set({ entryHash: "C".repeat(64) })
          .where(eq(dailyCloses.businessDay, "2026-08-04")),
      ),
    );
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe("daily_closes is append-only");
  });

  it("rejects a DELETE of daily_closes, via the append-only trigger", async () => {
    await insertClose({ businessDay: "2026-08-05", sequenceNo: 5 });
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.delete(dailyCloses).where(eq(dailyCloses.businessDay, "2026-08-05")),
      ),
    );
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe("daily_closes is append-only");
  });
});

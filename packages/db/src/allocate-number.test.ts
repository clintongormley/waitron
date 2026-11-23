import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { allocateInvoiceNumber, nextInvoiceNumberOf } from "./allocate-number.js";
import type { Database, Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { invoiceSeries } from "./schema/series.js";
import { useVenueDb } from "./testing/venue-db.js";
import { seedInvoiceNumber, seedNode, seedVenue } from "./testing/seed.js";
import { withTransaction } from "./tenancy.js";

const UNKNOWN_SERIES = "00000000-0000-4000-8000-000000000000";

let nodeA1 = "";

async function seed(db: Database): Promise<void> {
  await seedVenue(db, {
    name: "Fixture Venue A",
    invoiceLocales: ["es", "ca"],
  });
  nodeA1 = await seedNode(db);
  await seedVenueSettings(db, {
    name: "Fixture Venue B",
    invoiceLocales: ["es"],
  });
  await seedBusinessDay(db, {});
  await seedNode(db);
}

async function makeSeries(db: Database, values: { nodeId: string; code: string }): Promise<string> {
  const [row] = await db
    .insert(invoiceSeries)
    .values({ ...values, purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  return row.id;
}

async function allocateAndRecord(tx: Transaction, seriesId: string): Promise<number> {
  const number = await allocateInvoiceNumber(tx, seriesId);
  await seedInvoiceNumber(tx, { nodeId: nodeA1, seriesId }, number);
  return number;
}

describe("allocateInvoiceNumber", () => {
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

  it("continues numbering after the highest recorded sale", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    await withTransaction(db, (tx) => seedInvoiceNumber(tx, { nodeId: nodeA1, seriesId }, 4999));
    const first = await withTransaction(db, (tx) => allocateAndRecord(tx, seriesId));
    const second = await withTransaction(db, (tx) => allocateAndRecord(tx, seriesId));
    expect([first, second]).toEqual([5000, 5001]);
  });

  it("reads each series' next number beside its code in a select", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    await makeSeries(db, { nodeId: nodeA1, code: "RA" });
    await withTransaction(db, async (tx) => {
      for (const number of [1, 2, 3])
        await seedInvoiceNumber(tx, { nodeId: nodeA1, seriesId }, number);
    });

    const query = db
      .select({ code: invoiceSeries.code, next: nextInvoiceNumberOf(invoiceSeries.id) })
      .from(invoiceSeries)
      .orderBy(invoiceSeries.code);
    expect(query.toSQL().sql).toContain('"sales"."series_id" = "invoice_series"."id"');
    expect(await query).toEqual([
      { code: "FA", next: 4 },
      { code: "RA", next: 1 },
    ]);

    const series = alias(invoiceSeries, "s");
    const aliased = db
      .select({ code: series.code, next: nextInvoiceNumberOf(series.id) })
      .from(series)
      .orderBy(series.code);
    expect(aliased.toSQL().sql).toContain('"sales"."series_id" = "s"."id"');
    expect(await aliased).toEqual([
      { code: "FA", next: 4 },
      { code: "RA", next: 1 },
    ]);
  });

  it("reads the next number without updating the series", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      expect(await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId))).toBe(1);
      const statements = prepare.mock.calls.map(([statement]) => statement);
      expect(statements.filter((statement) => statement.includes('"invoice_series"'))).toEqual([
        expect.stringMatching(/^select .* from "invoice_series"/s),
      ]);
    } finally {
      prepare.mockRestore();
    }
  });

  it("keeps invoice numbering in sales without a stored series counter", () => {
    expect(
      db.all(sql`select name from pragma_table_info('invoice_series') where name = 'next_number'`),
    ).toEqual([]);
  });

  it("increases strictly across successive allocations", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const allocated: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      allocated.push(await withTransaction(db, (tx) => allocateAndRecord(tx, seriesId)));
    }
    expect(allocated).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a number as a JS number, not a string", async () => {
    // An unconverted "1" compares equal to 1 under == but not under toBe, and
    // would reach the invoice number column as text.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const n = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(typeof n).toBe("number");
  });

  it("returns the number to the series when the transaction rolls back", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    let allocated = 0;
    await expect(
      withTransaction(db, async (tx) => {
        allocated = await allocateAndRecord(tx, seriesId);
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow(/deliberate rollback/);
    expect(allocated).toBe(1);

    const next = await withTransaction(db, (tx) => allocateInvoiceNumber(tx, seriesId));
    expect(next).toBe(1);
  });

  it("hands out no number twice across interleaved aborts and commits", async () => {
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const committed: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const abort = i % 2 === 0;
      const write = withTransaction(db, async (tx) => {
        const number = await allocateAndRecord(tx, seriesId);
        if (abort) throw new Error("abort");
        return number;
      });
      if (abort) {
        await expect(write).rejects.toThrow("abort");
      } else {
        committed.push(await write);
      }
    }
    // Three commits, three consecutive numbers, no duplicates. The aborted
    // allocations left nothing behind and consumed nothing.
    expect(committed).toEqual([1, 2, 3]);
    expect(new Set(committed).size).toBe(committed.length);
  });

  it("allocates independently for two series on the same node", async () => {
    const fa = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const ra = await makeSeries(db, { nodeId: nodeA1, code: "RA" });
    const a1 = await withTransaction(db, (tx) => allocateAndRecord(tx, fa));
    const b1 = await withTransaction(db, (tx) => allocateAndRecord(tx, ra));
    const a2 = await withTransaction(db, (tx) => allocateAndRecord(tx, fa));
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
    // `withTransaction` runs each body inside the venue file's write queue
    // (`packages/store/src/write-queue.ts`), so what twenty overlapping calls test here is that the
    // queue serialises them — twenty distinct, contiguous numbers — and not that a lock holds under
    // contention. The receipt for the queue itself, with a control in the other direction, is
    // `racePair` in `packages/menu/test/fixtures.ts`.
    const seriesId = await makeSeries(db, { nodeId: nodeA1, code: "FA" });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTransaction(db, (tx) => allocateAndRecord(tx, seriesId)),
      ),
    );
    expect(new Set(results).size).toBe(20);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(20);
  });
});

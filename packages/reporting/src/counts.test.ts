import { beforeEach, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCloseCounts } from "./counts.js";
import type { CloseCounts, DailyCloseInput } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const noon = new Date("2026-08-04T10:00:00Z").toISOString();
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function input(overrides: Partial<DailyCloseInput> = {}): DailyCloseInput {
  return {
    nodeId: venue.nodeId,
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
}
function run(overrides: Partial<DailyCloseInput> = {}): Promise<CloseCounts> {
  return withTransaction(suite.db, async (tx) => {
    return computeCloseCounts(tx, input(overrides));
  });
}
const line = { vatRate: "21.00", lineTotal: "10.00" };

describe("computeCloseCounts", () => {
  it("counts sales, corrections and voids", async () => {
    const s1 = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon,
      total: "12.10",
      lines: [line],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noon,
      total: "12.10",
      lines: [line],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: noon,
      total: "-1.21",
      correctsSaleId: s1,
      lines: [{ vatRate: "21.00", lineTotal: "-1.00" }],
    });
    await seedVoid(suite.db, { saleId: s1 }, noon);
    // s1 is voided the same day → not in sales count; s2 remains; the corrective counts; one void.
    expect(await run()).toEqual({ sales: 1, corrections: 1, voids: 1 });
  });

  it("counts a sale on its issue day and a later void on the void's day", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon,
      total: "12.10",
      lines: [line],
    });
    await seedVoid(suite.db, { saleId: s }, new Date("2026-08-05T10:00:00Z").toISOString());
    expect(await run()).toEqual({ sales: 1, corrections: 0, voids: 0 });
    expect(await run({ businessDay: "2026-08-05" })).toEqual({
      sales: 0,
      corrections: 0,
      voids: 1,
    });
  });

  it("excludes an F3 substitute from the sales count", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon,
      total: "12.10",
      lines: [line],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noon,
      total: "12.10",
      lines: [line],
    });
    await seedSubstitution(suite.db, {
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    expect(await run()).toEqual({ sales: 1, corrections: 0, voids: 0 });
  });

  it.each([
    ["one node", () => venue.nodeId],
    ["the whole venue", () => undefined],
  ])("finds %s's voids by a range search on voided_at, not a scan", async (_label, nodeId) => {
    const plan = await withTransaction(suite.db, async (tx) => {
      const statements: SQL[] = [];
      const recording = new Proxy(tx, {
        get: (target, key, receiver) =>
          key === "execute"
            ? (query: SQL) => {
                statements.push(query);
                return target.execute(query);
              }
            : Reflect.get(target, key, receiver),
      }) as Transaction;
      await computeCloseCounts(recording, input({ nodeId: nodeId() }));
      const voidCount = statements.find((q) =>
        new SQLiteSyncDialect().sqlToQuery(q).sql.includes("sv.voided_at"),
      );
      return tx.execute<{ detail: string }>(sql`explain query plan ${voidCount!}`);
    });
    const details = plan.rows.map((r) => r.detail);
    expect(details).toContain(
      "SEARCH sv USING INDEX sale_voids_voided_at_idx (voided_at>? AND voided_at<?)",
    );
    expect(details.some((d) => d.startsWith("SCAN"))).toBe(false);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ sales: 0, corrections: 0, voids: 0 });
  });
});

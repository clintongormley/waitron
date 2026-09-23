import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, tenders, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedSale, seedTender, seedTill, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCashUp } from "./cash-up.js";
import type { CashUp, DailyCloseInput, TenderMethod } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const DAY = "2026-08-04";
const settledNoon = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function run(overrides: Partial<DailyCloseInput> = {}): Promise<CashUp> {
  const input: DailyCloseInput = {
    nodeId: venue.nodeId,
    businessDay: DAY,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
  return withTransaction(suite.db, async (tx) => {
    return computeCashUp(tx, input);
  });
}
// Helper: a settled sale with tenders. Returns nothing; each test seeds its own.
async function saleWithTenders(
  inv: number,
  tenderRows: Array<{
    method: TenderMethod;
    amount: string;
    tipAmount?: string;
    settledAt: string;
  }>,
): Promise<void> {
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber: inv,
    issuedAt: settledNoon,
    total: "100.00",
    lines: [{ vatRate: "21.00", lineTotal: "82.64" }],
  });
  for (const t of tenderRows) await seedTender(suite.db, { saleId }, t);
}

describe("computeCashUp", () => {
  it("cashTakings counts only cash-method amounts, incl. cash tips", async () => {
    await saleWithTenders(1, [
      { method: "cash", amount: "50.00", tipAmount: "5.00", settledAt: settledNoon },
      { method: "card", amount: "70.00", tipAmount: "0.00", settledAt: settledNoon },
    ]);
    const cash = await run();
    expect(cash.byTill).toHaveLength(1);
    expect(cash.byTill[0]!.cashTakings).toBe("50.00");
    expect(cash.byTill[0]!.byMethod).toEqual([
      { method: "card", amount: "70.00", tip: "0.00" },
      { method: "cash", amount: "50.00", tip: "5.00" },
    ]);
    expect(cash).toMatchObject({ tenderTotal: "120.00", tipTotal: "5.00" });
  });

  it("breaks down by till", async () => {
    const till2 = await seedTill(suite.db, venue.locationId);
    await saleWithTenders(1, [{ method: "cash", amount: "30.00", settledAt: settledNoon }]);
    const s2 = await seedSale(
      suite.db,
      { ...venue, tillId: till2 },
      {
        invoiceNumber: 2,
        issuedAt: settledNoon,
        total: "40.00",
        lines: [{ vatRate: "10.00", lineTotal: "36.36" }],
      },
    );
    await seedTender(
      suite.db,
      { saleId: s2 },
      { method: "card", amount: "40.00", settledAt: settledNoon },
    );
    const cash = await run();
    expect(cash.byTill.map((t) => t.tillId).sort()).toEqual([venue.tillId, till2].sort());
    expect(cash).toMatchObject({ tenderTotal: "70.00", tipTotal: "0.00" });
  });

  it("buckets by settlement day + cutover: a 01:30-local tender belongs to the prior day", async () => {
    await saleWithTenders(1, [
      {
        method: "cash",
        amount: "10.00",
        settledAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      },
    ]);
    expect((await run({ businessDay: "2026-08-04" })).byTill).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byTill).toHaveLength(1);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ byTill: [], tenderTotal: "0.00", tipTotal: "0.00" });
  });

  it("reads the money columns as counts of whole cents, summed then converted once", async () => {
    // Written straight to the table as INTEGERS, past `seedTender`'s own decimalToCents, so this
    // pins what the column holds rather than what the fixture does with it. 12345 + 5 = 12350 cents
    // is 123.50, and 250 + 0 = 250 cents is 2.50. A query that read the column as euros would
    // report "12350.00" and "250.00".
    //
    // Through the table definition rather than in raw SQL, which is a conversion and not a
    // loosening: `tenders.id` is supplied by `$defaultFn(newId)` in JavaScript on this engine, so a
    // raw INSERT naming no id is refused `NOT NULL constraint failed`. The values are still the raw
    // integer counts, which is what this case is about.
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: settledNoon,
      total: "123.50",
      lines: [{ vatRate: "21.00", lineTotal: "102.07" }],
    });
    await suite.db.insert(tenders).values([
      { saleId, method: "cash", amount: 12345, tipAmount: 250, settledAt: settledNoon },
      { saleId, method: "cash", amount: 5, tipAmount: 0, settledAt: settledNoon },
    ]);
    const cash = await run();
    expect(cash.byTill[0]!.byMethod).toEqual([{ method: "cash", amount: "123.50", tip: "2.50" }]);
    expect(cash.byTill[0]!.cashTakings).toBe("123.50");
    expect(cash).toMatchObject({ tenderTotal: "123.50", tipTotal: "2.50" });
  });

  it("excludes another node's tenders", async () => {
    const other = await seedVenue(suite.db);
    const s = await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: settledNoon,
      total: "10.00",
      lines: [{ vatRate: "21.00", lineTotal: "8.26" }],
    });
    await seedTender(
      suite.db,
      { saleId: s },
      { method: "cash", amount: "10.00", settledAt: settledNoon },
    );
    expect((await run()).byTill).toEqual([]);
  });
});

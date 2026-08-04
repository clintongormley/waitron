import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedTender, seedTill, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCashUp } from "./cash-up.js";
import type { CashUp, DailyCloseInput, TenderMethod } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const DAY = "2026-08-04";
const settledNoon = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function run(overrides: Partial<DailyCloseInput> = {}): Promise<CashUp> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    businessDay: DAY,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeCashUp(tx, input);
  });
}
// Helper: a settled sale with tenders. Returns nothing; each test seeds its own.
async function saleWithTenders(
  inv: number,
  tenderRows: Array<{ method: TenderMethod; amount: string; tipAmount?: string; settledAt: string }>,
): Promise<void> {
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber: inv,
    issuedAt: settledNoon,
    total: "100.00",
    lines: [{ vatRate: "21.00", lineTotal: "82.64" }],
  });
  for (const t of tenderRows) await seedTender(suite.db, { tenantId: venue.tenantId, saleId }, t);
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
    const till2 = await seedTill(suite.db, venue.tenantId, venue.locationId);
    await saleWithTenders(1, [{ method: "cash", amount: "30.00", settledAt: settledNoon }]);
    const s2 = await seedSale(
      suite.db,
      { ...venue, tillId: till2 },
      { invoiceNumber: 2, issuedAt: settledNoon, total: "40.00", lines: [{ vatRate: "10.00", lineTotal: "36.36" }] },
    );
    await seedTender(suite.db, { tenantId: venue.tenantId, saleId: s2 }, { method: "card", amount: "40.00", settledAt: settledNoon });
    const cash = await run();
    expect(cash.byTill.map((t) => t.tillId).sort()).toEqual([venue.tillId, till2].sort());
    expect(cash).toMatchObject({ tenderTotal: "70.00", tipTotal: "0.00" });
  });

  it("buckets by settlement day + cutover: a 01:30-local tender belongs to the prior day", async () => {
    await saleWithTenders(1, [
      { method: "cash", amount: "10.00", settledAt: new Date("2026-08-03T23:30:00Z").toISOString() },
    ]);
    expect((await run({ businessDay: "2026-08-04" })).byTill).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byTill).toHaveLength(1);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ byTill: [], tenderTotal: "0.00", tipTotal: "0.00" });
  });

  it("excludes another node's tenders", async () => {
    const other = await seedVenue(suite.db);
    const s = await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: settledNoon,
      total: "10.00",
      lines: [{ vatRate: "21.00", lineTotal: "8.26" }],
    });
    await seedTender(suite.db, { tenantId: other.tenantId, saleId: s }, { method: "cash", amount: "10.00", settledAt: settledNoon });
    expect((await run()).byTill).toEqual([]);
  });
});

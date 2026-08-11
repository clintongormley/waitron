import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNodeAndSeries, seedSale, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatSummaryForPeriod } from "./vat-summary.js";
import type { PeriodVatInput, VatSummary } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
const TZ = "Europe/Madrid";
const FROM = "2026-08-04";
const TO = "2026-08-05";

// Noon Madrid on a given business day (Madrid is UTC+2 in August; 10:00Z = 12:00 local). With a
// 05:00 cutover that instant lands squarely on `day`'s business day.
const noon = (day: string): string => new Date(`${day}T10:00:00Z`).toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(overrides: Partial<PeriodVatInput> = {}): Promise<VatSummary> {
  const input: PeriodVatInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    fromBusinessDay: FROM,
    toBusinessDay: TO,
    timeZone: TZ,
    dayCutover: "05:00",
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeVatSummaryForPeriod(tx, input);
  });
}

describe("computeVatSummaryForPeriod", () => {
  it("sums two sales on DIFFERENT business days both inside the range", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon("2026-08-04"),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noon("2026-08-05"),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const vat = await run(); // [08-04, 08-05]
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "200.00", tax: "42.00" }]);
    expect(vat).toMatchObject({ baseTotal: "200.00", taxTotal: "42.00", grossTotal: "242.00" });
  });

  it("excludes a sale on a day outside the range", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon("2026-08-04"),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noon("2026-08-06"), // one day past `TO`
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });

  it("rounds tax PER INVOICE across the range, not on the summed base", async () => {
    // Two 0.03 @ 21% invoices on DIFFERENT days, at a boundary where the groupings DISAGREE:
    //   per invoice: 0.03 * 21% = 0.0063 → 0.01 each → 0.02 total
    //   summed base: 0.06 * 21% = 0.0126 → 0.01 total
    // The filed per-invoice figures sum to 0.02; a summed-base recompute would give 0.01.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon("2026-08-04"),
      total: "0.04",
      lines: [{ vatRate: "21.00", lineTotal: "0.03" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noon("2026-08-05"),
      total: "0.04",
      lines: [{ vatRate: "21.00", lineTotal: "0.03" }],
    });
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "0.06", tax: "0.02" }]);
  });

  it("buckets by the cutover at a range edge", async () => {
    // 2026-08-03T23:30Z = 01:30 Madrid on 08-04; with a 05:00 cutover it is business day 08-03.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    // [08-04, 08-05] excludes business day 08-03:
    expect(
      (await run({ fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-05" })).byRate,
    ).toEqual([]);
    // [08-03, 08-04] includes it:
    expect(
      (await run({ fromBusinessDay: "2026-08-03", toBusinessDay: "2026-08-04" })).byRate,
    ).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });

  it("aggregates all the tenant's nodes when nodeId is omitted, and one when present", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noon("2026-08-04"),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noon("2026-08-04"),
        total: "242.00",
        lines: [{ vatRate: "21.00", lineTotal: "200.00" }],
      },
    );
    const oneDay = { fromBusinessDay: "2026-08-04", toBusinessDay: "2026-08-04" };
    // nodeId omitted → both nodes: 100 + 200 = 300.
    expect((await run({ ...oneDay, nodeId: undefined })).byRate).toEqual([
      { rate: "21.00", base: "300.00", tax: "63.00" },
    ]);
    // nodeId = node A → only 100.00, node B's 200.00 excluded.
    expect((await run(oneDay)).byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });

  it("returns zeros for an empty range", async () => {
    expect(await run()).toEqual({
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
      grossTotal: "0.00",
    });
  });

  it("throws a plain Error on an invalid time zone", async () => {
    await expect(run({ timeZone: "Mars/Olympus" })).rejects.toThrow(/time zone/i);
  });

  it("throws a plain Error on an invalid fromBusinessDay", async () => {
    await expect(run({ fromBusinessDay: "2026-8-4" })).rejects.toThrow(/business day/i);
  });

  it("throws a plain Error when from is after to", async () => {
    await expect(
      run({ fromBusinessDay: "2026-08-05", toBusinessDay: "2026-08-04" }),
    ).rejects.toThrow(/on or before/i);
  });
});

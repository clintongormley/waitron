import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedSale, seedSubstitution, seedVenue, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatSummary } from "./vat-summary.js";
import type { DailyCloseInput } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
const DAY = "2026-08-04";
const TZ = "Europe/Madrid";

// Two instants that both fall on 2026-08-04 local (Madrid is UTC+2 in August). 10:00Z = 12:00 local.
const noonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(overrides: Partial<DailyCloseInput> = {}): Promise<import("./types.js").VatSummary> {
  const input: DailyCloseInput = {
    tenantId: venue.tenantId,
    nodeId: venue.nodeId,
    businessDay: DAY,
    timeZone: TZ,
    dayCutover: "05:00",
    ...overrides,
  };
  return withTenant(suite.db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return computeVatSummary(tx, input);
  });
}

describe("computeVatSummary", () => {
  it("sums one rate", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
    expect(vat).toMatchObject({ baseTotal: "100.00", taxTotal: "21.00", grossTotal: "121.00" });
  });

  it("groups multiple rates, one line each", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "231.00",
      lines: [
        { vatRate: "21.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "100.00" },
      ],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([
      { rate: "10.00", base: "100.00", tax: "10.00" },
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
    expect(vat).toMatchObject({ baseTotal: "200.00", taxTotal: "31.00", grossTotal: "231.00" });
  });

  it("nets a correction's negative lines into the rate", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "-6.05",
      correctsSaleId: original,
      lines: [{ vatRate: "21.00", lineTotal: "-5.00" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "95.00", tax: "19.95" }]);
  });

  it("excludes a voided sale", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: s }, noonUtc);
    expect((await run()).byRate).toEqual([]);
  });

  it("excludes an F3-canje substitute but keeps the substituted ticket", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSubstitution(suite.db, {
      tenantId: venue.tenantId,
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    // Only the ticket's 100.00 base, not doubled by the F3.
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });

  it("rounds tax per invoice, not on the summed base", async () => {
    // A base that rounds up asserts the per-invoice contract directly: 0.05 at 21% = 0.0105 → 0.01.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "0.06",
      lines: [{ vatRate: "21.00", lineTotal: "0.05" }],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "0.05", tax: "0.01" }]);
  });

  it("buckets by issuance and the cutover: 01:30 local belongs to the prior business day", async () => {
    // 2026-08-04 01:30 Madrid = 2026-08-03T23:30Z. With a 05:00 cutover it is business day 08-03.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run({ businessDay: "2026-08-04" })).byRate).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byRate).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
      grossTotal: "0.00",
    });
  });

  it("excludes another node's sales", async () => {
    const other = await seedVenue(suite.db); // different tenant+node
    await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run()).byRate).toEqual([]); // our node has nothing
  });
});

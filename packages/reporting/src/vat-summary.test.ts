import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import {
  seedNodeAndSeries,
  seedSale,
  seedSubstitution,
  seedVenue,
  seedVoid,
} from "../test/fixtures.js";
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

  it("rounds tax PER INVOICE, not on the summed base", async () => {
    // Two invoices, same rate, at a rounding boundary where the two groupings DISAGREE:
    //   per invoice: 0.03 * 21% = 0.0063 → 0.01 each → 0.02 total
    //   summed base: 0.06 * 21% = 0.0126 → 0.01 total
    // Asserting 0.02 fails if the query grouped by rate only rather than by (sale, rate) — the
    // load-bearing per-invoice rounding of design §4/§D6. A single-invoice case cannot tell them apart.
    for (const invoiceNumber of [1, 2]) {
      await seedSale(suite.db, venue, {
        invoiceNumber,
        issuedAt: noonUtc,
        total: "0.04",
        lines: [{ vatRate: "21.00", lineTotal: "0.03" }],
      });
    }
    const vat = await run();
    expect(vat.byRate).toEqual([{ rate: "21.00", base: "0.06", tax: "0.02" }]);
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

  it("excludes another tenant's sales (RLS + the tenant predicate)", async () => {
    const other = await seedVenue(suite.db); // a different tenant entirely
    await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    expect((await run()).byRate).toEqual([]); // our tenant has nothing
  });

  it("excludes another node in the SAME tenant (the node predicate, which RLS does not enforce)", async () => {
    // RLS scopes by tenant only, so a second node under our own tenant is NOT hidden — only
    // `s.node_id = ${input.nodeId}` excludes it. Dropping that predicate would count 300.00, not 100.00.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const nodeB = await seedNodeAndSeries(suite.db, venue);
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: noonUtc,
        total: "242.00",
        lines: [{ vatRate: "21.00", lineTotal: "200.00" }],
      },
    );
    // Close runs for the venue's node A — only its 100.00, never node B's 200.00.
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });

  it("reports the filed difference-method tax exactly for catalogue sales", async () => {
    // A gross-inclusive catalogue sale files its cuota by the DIFFERENCE method (gross − base), which
    // can land a rounding céntimo away from round(base × rate). We file such a desglose directly and
    // assert the summary returns THAT figure, not the multiplicative recompute the old sale_lines
    // query produced (21.00 and 5.00 below).
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "176.00",
      lines: [
        { vatRate: "21.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "50.00" },
      ],
      vatBreakdown: [
        { rate: "21.00", base: "100.00", tax: "20.99" }, // multiplicative would be 21.00
        { rate: "10.00", base: "50.00", tax: "5.01" }, // multiplicative would be 5.00
      ],
    });
    const vat = await run();
    expect(vat.byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.01" },
      { rate: "21.00", base: "100.00", tax: "20.99" },
    ]);
    expect(vat).toMatchObject({ baseTotal: "150.00", taxTotal: "26.00", grossTotal: "176.00" });
  });

  it("nets a correction's negative filed breakdown into the rate", async () => {
    // Both original and correction file difference-method cuotas. The filed net (18.89) differs from
    // the multiplicative net the old query gave (21.00 − 2.10 = 18.90), so this fails until the
    // summary reads the filed breakdown.
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "120.99",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: noonUtc,
      total: "-12.10",
      correctsSaleId: original,
      lines: [{ vatRate: "21.00", lineTotal: "-10.00" }],
      vatBreakdown: [{ rate: "21.00", base: "-10.00", tax: "-2.10" }],
    });
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "90.00", tax: "18.89" }]);
  });

  it("still matches a direct-method sale (default buildVatBreakdown-shaped breakdown)", async () => {
    // Regression: with no override the fixture derives base × rate — the direct method — so the
    // summary must equal it. Non-round base to exercise the per-invoice rounding on the read path.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: noonUtc,
      total: "40.33",
      lines: [{ vatRate: "21.00", lineTotal: "33.33" }],
    });
    expect((await run()).byRate).toEqual([{ rate: "21.00", base: "33.33", tax: "7.00" }]);
  });
});

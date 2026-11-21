import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addDecimal, decimal, subtractDecimal, toScale } from "@waitron/shared";
import type { Decimal, SaleId } from "@waitron/shared";
import {
  at,
  seedNodeAndSeries,
  seedPurchaseInvoice,
  seedSale,
  seedSubstitution,
  seedVenueWithSeries,
  seedVoid,
  TICKET,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatReturn } from "./vat-return.js";
import { vatMovements } from "./vat-movements.js";
import { computeVatCorrections } from "./vat-corrections.js";
import type { LiquidationPeriod } from "./period.js";
import type { VatReturn } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

// A civil-August instant; with the default offset 0 the filed date is 2026-08-04.
const augNoonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});

function run(opts: { year: number; month: number }): Promise<VatReturn> {
  return runPeriod({ kind: "month", month: opts.month }, { year: opts.year });
}

function runPeriod(period: LiquidationPeriod, opts: { year?: number } = {}): Promise<VatReturn> {
  return withTransaction(suite.db, async (tx) => {
    return computeVatReturn(tx, { year: opts.year ?? 2026, period });
  });
}

describe("computeVatReturn", () => {
  it("aggregates the filed difference-method breakdown across two nodes, exactly", async () => {
    // Menu (gross-inclusive) sales file cuotas by the DIFFERENCE method, which can land a céntimo
    // away from round(base × rate). The 303 aggregate must sum the FILED per-invoice cuotas, never
    // re-round on the monthly base. Two nodes, both counted (no node predicate).
    const nodeB = await seedNodeAndSeries(suite.db);
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
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
    await seedSale(
      suite.db,
      { ...venue, nodeId: nodeB.nodeId, seriesId: nodeB.seriesId },
      {
        invoiceNumber: 1,
        issuedAt: augNoonUtc,
        total: "120.99",
        lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
        vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
      },
    );
    const ret = await run({ year: 2026, month: 8 });
    expect(ret.byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.01" },
      { rate: "21.00", base: "200.00", tax: "41.98" }, // two nodes' filed 20.99 + 20.99, NOT round(200 × 21%) = 42.00
    ]);
    // taxTotal is the summed filed cuotas (46.99), not round(Σ base × rate) (47.00).
    expect(ret).toMatchObject({
      year: 2026,
      period: { kind: "month", month: 8 },
      baseTotal: "250.00",
      taxTotal: "46.99",
    });
    // The 303 has no gross box — VatReturn omits grossTotal.
    expect("grossTotal" in ret).toBe(false);
  });

  it("nets a correction's negative filed breakdown down", async () => {
    const original = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "120.99",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: augNoonUtc,
      total: "-12.10",
      correctsSaleId: original,
      lines: [{ vatRate: "21.00", lineTotal: "-10.00" }],
      vatBreakdown: [{ rate: "21.00", base: "-10.00", tax: "-2.10" }],
    });
    const ret = await run({ year: 2026, month: 8 });
    expect(ret.byRate).toEqual([{ rate: "21.00", base: "90.00", tax: "18.89" }]);
  });

  describe("a sale replaced by a corrective by replacement", () => {
    const ticket = { total: "12.10", lines: [{ vatRate: "10.00", lineTotal: "11.00" }] };

    async function replace(originalAt: string, replacementAt: string): Promise<void> {
      const original = await seedSale(suite.db, venue, {
        invoiceNumber: 1,
        issuedAt: originalAt,
        ...ticket,
      });
      await seedSale(suite.db, venue, {
        invoiceNumber: 2,
        issuedAt: replacementAt,
        correctsSaleId: original,
        replacesOriginal: true,
        ...ticket,
      });
    }

    it("counts it once in a quarter holding both", async () => {
      await replace(augNoonUtc, new Date("2026-09-10T10:00:00Z").toISOString());
      const ret = await runPeriod({ kind: "quarter", quarter: 3 });
      expect(ret.byRate).toEqual([{ rate: "10.00", base: "11.00", tax: "1.10" }]);
      expect(ret).toMatchObject({ baseTotal: "11.00", taxTotal: "1.10" });
    });

    it("counts it in the original's period, not the replacement's", async () => {
      await replace(
        new Date("2026-12-31T10:00:00Z").toISOString(),
        new Date("2027-01-05T10:00:00Z").toISOString(),
      );
      const q4 = await runPeriod({ kind: "quarter", quarter: 4 }, { year: 2026 });
      expect(q4.byRate).toEqual([{ rate: "10.00", base: "11.00", tax: "1.10" }]);
      const q1 = await runPeriod({ kind: "quarter", quarter: 1 }, { year: 2027 });
      expect(q1.byRate).toEqual([]);
      expect(q1).toMatchObject({ baseTotal: "0.00", taxTotal: "0.00" });
    });
  });

  describe("a sale replaced with the day it really happened", () => {
    const ticket = { total: "12.10", lines: [{ vatRate: "10.00", lineTotal: "11.00" }] };
    const stampedMarch2 = new Date("2026-03-02T10:00:00Z").toISOString();

    async function replace(
      replacementAt: string,
      supplyDay?: string,
    ): Promise<{ replacement: SaleId }> {
      const original = await seedSale(suite.db, venue, {
        invoiceNumber: 1,
        issuedAt: stampedMarch2,
        ...ticket,
      });
      const replacement = await seedSale(suite.db, venue, {
        invoiceNumber: 2,
        issuedAt: replacementAt,
        correctsSaleId: original,
        replacesOriginal: true,
        ...(supplyDay === undefined ? {} : { supplyDay }),
        ...ticket,
      });
      return { replacement };
    }

    it("counts it in neither month: it moved to February after February ended", async () => {
      await replace(new Date("2026-03-10T10:00:00Z").toISOString(), "2026-02-28");

      const february = await run({ year: 2026, month: 2 });
      expect(february.byRate).toEqual([]);
      expect(february).toMatchObject({ baseTotal: "0.00", taxTotal: "0.00" });
      const march = await run({ year: 2026, month: 3 });
      expect(march.byRate).toEqual([]);
      expect(march).toMatchObject({ baseTotal: "0.00", taxTotal: "0.00" });
    });

    it("keeps it in its stamped period when the replacement names no day", async () => {
      await replace(new Date("2026-04-05T10:00:00Z").toISOString());

      const march = await run({ year: 2026, month: 3 });
      expect(march.byRate).toEqual([{ rate: "10.00", base: "11.00", tax: "1.10" }]);
      const february = await run({ year: 2026, month: 2 });
      expect(february.byRate).toEqual([]);
      const april = await run({ year: 2026, month: 4 });
      expect(april.byRate).toEqual([]);
    });

    it("counts a later refund of the replacement in neither month: both are corrections of February", async () => {
      const { replacement } = await replace(
        new Date("2026-03-10T10:00:00Z").toISOString(),
        "2026-02-28",
      );
      await seedSale(suite.db, venue, {
        invoiceNumber: 3,
        issuedAt: new Date("2026-03-20T10:00:00Z").toISOString(),
        total: "-5.50",
        correctsSaleId: replacement,
        lines: [{ vatRate: "10.00", lineTotal: "-5.00" }],
      });

      const february = await run({ year: 2026, month: 2 });
      expect(february.byRate).toEqual([]);
      const march = await run({ year: 2026, month: 3 });
      expect(march.byRate).toEqual([]);
    });
  });

  it("counts a sale issued after its sale day's period in neither period", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-04-01T10:00:00Z").toISOString(),
      supplyDay: "2026-03-31",
      total: "12.10",
      lines: [{ vatRate: "10.00", lineTotal: "11.00" }],
    });

    const q1 = await runPeriod({ kind: "quarter", quarter: 1 });
    expect(q1.byRate).toEqual([]);
    const q2 = await runPeriod({ kind: "quarter", quarter: 2 });
    expect(q2.byRate).toEqual([]);
    expect(q2).toMatchObject({ baseTotal: "0.00", taxTotal: "0.00" });
  });

  it("excludes a voided sale", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedVoid(suite.db, { saleId: s }, augNoonUtc);
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([]);
  });

  it("keeps a sale voided in a LATER month in its own month, and the void in neither month", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedVoid(suite.db, { saleId: s }, new Date("2026-09-10T10:00:00Z").toISOString());
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
    expect((await run({ year: 2026, month: 9 })).byRate).toEqual([]);
    expect((await runPeriod({ kind: "quarter", quarter: 3 })).byRate).toEqual([]);
  });

  it("excludes an F3-canje substitute but keeps the substituted ticket", async () => {
    const ticket = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const f3 = await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedSubstitution(suite.db, {
      substitutionSaleId: f3,
      substitutedSaleId: ticket,
    });
    // Only the ticket's 100.00 base, not doubled by the F3.
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
  });

  it("buckets by the filed civil issue date, not the operational business day", async () => {
    // Madrid is UTC+2 in August (offset +120). A sale issued 2026-08-01 00:30 LOCAL = 2026-07-31
    // 22:30Z: its filed fecha de expedición (civil-local date via the snapshot offset) is 2026-08-01,
    // so it belongs to AUGUST — even though a 05:00 business-day cutover would put it in July's
    // operational day. Its mirror at 2026-07-31 23:30 local = 2026-07-31 21:30Z is filed 2026-07-31,
    // so it belongs to JULY. The 303 buckets on the civil date, not the cutover.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: new Date("2026-07-31T22:30:00Z").toISOString(),
      issuedOffsetMinutes: 120,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: new Date("2026-07-31T21:30:00Z").toISOString(),
      issuedOffsetMinutes: 120,
      total: "55.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00" }],
      vatBreakdown: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
    });
    // August's return has the civil-August sale only.
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
    // July's return has the civil-July mirror only.
    expect((await run({ year: 2026, month: 7 })).byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00" },
    ]);
  });

  it("computes the deducible side and the net result (devengado − deducible)", async () => {
    // Output: a 21% sale, cuota 21.00. Input: a régimen-general 21% received invoice (cuota 15.00) and
    // a 10% capital-goods one (cuota 4.00) → deducible total 19.00; result = 21.00 − 19.00 = 2.00. An
    // equivalence-surcharge invoice is seeded too and must NOT reduce the result (it is off the 303).
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-02",
      total: "86.43",
      lines: [{ rate: "21.00", base: "71.43", tax: "15.00" }],
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P2",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-03",
      total: "44.00",
      lines: [{ rate: "10.00", base: "40.00", tax: "4.00", kind: "capital" }],
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "RE",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-04",
      total: "121.00",
      regime: "equivalence_surcharge",
      lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });

    const ret = await run({ year: 2026, month: 8 });
    expect(ret.taxTotal).toBe("21.00"); // devengado (output)
    expect(ret.deductible.byRate).toEqual([
      { rate: "10.00", base: "40.00", tax: "4.00", kind: "capital" },
      { rate: "21.00", base: "71.43", tax: "15.00", kind: "ordinary" },
    ]);
    expect(ret.deductible.baseTotal).toBe("111.43");
    expect(ret.deductible.taxTotal).toBe("19.00");
    expect(ret.result).toBe("2.00"); // 21.00 − 19.00, the equivalence-surcharge invoice excluded
  });

  it("throws on a month outside 1..12 or a non-integer month", async () => {
    await expect(run({ year: 2026, month: 0 })).rejects.toThrow();
    await expect(run({ year: 2026, month: 13 })).rejects.toThrow();
    await expect(run({ year: 2026, month: 8.5 })).rejects.toThrow();
  });

  it("throws on a non-integer year", async () => {
    await expect(run({ year: 2026.5, month: 8 })).rejects.toThrow();
  });

  it("throws a plain validation Error on a year outside the 4-digit range, not a silent-empty 303", async () => {
    // A mistyped year would match no sales and return a plausible but EMPTY 303, the quiet, worse
    // direction for a fiscal filing, so it is refused before any query.
    await expect(run({ year: 226, month: 8 })).rejects.toThrow(/year must be/);
    await expect(run({ year: 20226, month: 8 })).rejects.toThrow(/year must be/);
    await expect(run({ year: 0, month: 8 })).rejects.toThrow(/year must be/);
  });

  it("returns zeros for an empty month", async () => {
    // No sales and no received invoices: both sides empty, and the result 0.00 − 0.00.
    expect(await run({ year: 2026, month: 3 })).toEqual({
      year: 2026,
      period: { kind: "month", month: 3 },
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
      deductible: { byRate: [], baseTotal: "0.00", taxTotal: "0.00" },
      result: "0.00",
    });
  });
});

describe("computeVatReturn — quarterly", () => {
  it("Q1 sums January, February and March (byRate + totals + result)", async () => {
    // Three sales spread across Q1's civil months (Jan/Feb/Mar) and one general 21% purchase received
    // 2026-02-20, all inside Q1. Offset 0 → the filed fecha de expedición is the UTC calendar date;
    // noon keeps it unambiguous.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-01-15T12:00:00Z",
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-02-15T12:00:00Z",
      total: "55.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00" }],
      vatBreakdown: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-03-31T12:00:00Z",
      total: "242.00",
      lines: [{ vatRate: "21.00", lineTotal: "200.00" }],
      vatBreakdown: [{ rate: "21.00", base: "200.00", tax: "42.00" }],
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P1",
      issuedOn: "2026-02-19",
      receivedOn: "2026-02-20",
      total: "96.80",
      lines: [{ rate: "21.00", base: "80.00", tax: "16.80", kind: "ordinary" }],
    });
    const q1 = await runPeriod({ kind: "quarter", quarter: 1 });
    expect(q1.period).toEqual({ kind: "quarter", quarter: 1 });
    // devengado: 21% base 300.00 cuota 63.00 ; 10% base 50.00 cuota 5.00 ; total cuota 68.00
    expect(q1.taxTotal).toBe("68.00");
    expect(q1.baseTotal).toBe("350.00");
    // deducible: 21% ordinary cuota 16.80 ; result = 68.00 − 16.80 = 51.20
    expect(q1.deductible.taxTotal).toBe("16.80");
    expect(q1.result).toBe("51.20");
  });
});

describe("computeVatReturn — annual + period boundaries", () => {
  it("the annual period sums the whole civil year and excludes adjacent years", async () => {
    // Four 21% sales at the civil-year edges: the two 2026 ones are in, the 2025/2027 ones out. The
    // year filter is the half-open [2026-01-01, 2027-01-01) in periodDateFilter. Offset 0 → filed date
    // is the UTC calendar date.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-01-01T12:00:00Z",
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-12-31T12:00:00Z",
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2027-01-01T12:00:00Z", // next year — excluded
      total: "1208.79",
      lines: [{ vatRate: "21.00", lineTotal: "999.00" }],
      vatBreakdown: [{ rate: "21.00", base: "999.00", tax: "209.79" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 4,
      issuedAt: "2025-12-31T12:00:00Z", // prior year — excluded
      total: "1208.79",
      lines: [{ vatRate: "21.00", lineTotal: "999.00" }],
      vatBreakdown: [{ rate: "21.00", base: "999.00", tax: "209.79" }],
    });
    const y = await runPeriod({ kind: "year" });
    expect(y.period).toEqual({ kind: "year" });
    expect(y.taxTotal).toBe("42.00"); // only the two 2026 sales; 2025/2027 excluded
  });

  it("the Q1/Q2 boundary buckets 31 Mar into Q1 and 1 Apr into Q2", async () => {
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-03-31T12:00:00Z",
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-04-01T12:00:00Z",
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    const q1 = await runPeriod({ kind: "quarter", quarter: 1 });
    const q2 = await runPeriod({ kind: "quarter", quarter: 2 });
    expect(q1.taxTotal).toBe("21.00"); // 31 Mar only — 1 Apr belongs to Q2
    expect(q2.taxTotal).toBe("21.00"); // 1 Apr only — 31 Mar belongs to Q1
  });
});

describe("computeVatReturn — quarter equals the sum of its months when nothing is corrected after its month", () => {
  it("Q2 equals the merged sum of April, May and June when nothing is corrected after its month (exactness inherited)", async () => {
    // A spread across Q2's three civil months at mixed rates, deliberately including cuotas the DIFFERENCE
    // method lands a céntimo off round(base × rate): two difference-method sales (20.99 / 21.01 on a 21%
    // base 100.00) and a difference-method purchase (41.99, not 42.00, on a 21% base 200.00). The quarter
    // aggregate must equal the byte-for-byte addDecimal sum of the three monthly aggregates — because
    // both sum the FILED per-invoice cuotas over the same rows, never re-rounding round(Σ base × rate).
    // That holds only when nothing is corrected after its month: a later correction is in no month's
    // return but can be in the quarter's.
    // Offset 0 → filed date = UTC date.
    // April sales.
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: "2026-04-10T12:00:00Z",
      total: "120.99",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "20.99" }], // difference-method: not 21.00
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 2,
      issuedAt: "2026-04-20T12:00:00Z",
      total: "55.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00" }],
      vatBreakdown: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
    });
    // May sales.
    await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: "2026-05-15T12:00:00Z",
      total: "242.00",
      lines: [{ vatRate: "21.00", lineTotal: "200.00" }],
      vatBreakdown: [{ rate: "21.00", base: "200.00", tax: "42.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 4,
      issuedAt: "2026-05-25T12:00:00Z",
      total: "33.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00" }],
      vatBreakdown: [{ rate: "10.00", base: "30.00", tax: "3.00" }],
    });
    // June sales.
    await seedSale(suite.db, venue, {
      invoiceNumber: 5,
      issuedAt: "2026-06-05T12:00:00Z",
      total: "26.00",
      lines: [{ vatRate: "4.00", lineTotal: "25.00" }],
      vatBreakdown: [{ rate: "4.00", base: "25.00", tax: "1.00" }],
    });
    await seedSale(suite.db, venue, {
      invoiceNumber: 6,
      issuedAt: "2026-06-30T12:00:00Z",
      total: "121.02",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      // Difference-method, rounded UP (Apr's went down to 20.99): the two 21% base-100.00 filed cuotas
      // sum to 42.01, so the quarter's 21% cuota is 84.01 ≠ round(400.00 × 21%) = 84.00 — a
      // re-rounding on the quarter base would break the taxTotal assertion below, not just pass it.
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.02" }],
    });
    // Purchases (all general → deductible), one per month, incl. the difference-method 41.99.
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P-APR",
      issuedOn: "2026-04-11",
      receivedOn: "2026-04-12",
      total: "241.99",
      lines: [{ rate: "21.00", base: "200.00", tax: "41.99", kind: "ordinary" }], // not 42.00
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P-MAY",
      issuedOn: "2026-05-17",
      receivedOn: "2026-05-18",
      total: "110.00",
      lines: [{ rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" }],
    });
    await seedPurchaseInvoice(suite.db, {
      supplierInvoiceNumber: "P-JUN",
      issuedOn: "2026-06-19",
      receivedOn: "2026-06-20",
      total: "60.50",
      lines: [{ rate: "21.00", base: "50.00", tax: "10.50", kind: "ordinary" }],
    });

    const apr = await runPeriod({ kind: "month", month: 4 });
    const may = await runPeriod({ kind: "month", month: 5 });
    const jun = await runPeriod({ kind: "month", month: 6 });
    const q2 = await runPeriod({ kind: "quarter", quarter: 2 });

    // Σ of the three months' cuota totals (addDecimal, exact) == the quarter's cuota total, byte-for-byte.
    const sumTax = addDecimal(addDecimal(apr.taxTotal, may.taxTotal), jun.taxTotal);
    expect(q2.taxTotal).toBe(sumTax);
    const sumDed = addDecimal(
      addDecimal(apr.deductible.taxTotal, may.deductible.taxTotal),
      jun.deductible.taxTotal,
    );
    expect(q2.deductible.taxTotal).toBe(sumDed);
    expect(q2.result).toBe(subtractDecimal(sumTax, sumDed));
  });
});

describe("computeVatReturn — a period counts what belongs to it and was made by its last day", () => {
  let nextNumber: number;
  beforeEach(() => {
    nextNumber = 1;
  });

  const Q1: LiquidationPeriod = { kind: "quarter", quarter: 1 };
  const Q2: LiquidationPeriod = { kind: "quarter", quarter: 2 };
  const TEN = [{ rate: "10.00", base: "10.00", tax: "1.00" }];

  async function sale(
    issuedDay: string,
    opts: Partial<Omit<Parameters<typeof seedSale>[2], "invoiceNumber" | "issuedAt">> = {},
  ): Promise<SaleId> {
    return seedSale(suite.db, venue, {
      total: "11.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
      ...opts,
      invoiceNumber: nextNumber++,
      issuedAt: at(issuedDay),
    });
  }

  async function quarters(): Promise<[VatReturn["byRate"], VatReturn["byRate"]]> {
    return [(await runPeriod(Q1)).byRate, (await runPeriod(Q2)).byRate];
  }

  it("A: a later correction leaves the ended quarter as it was and is not in its own quarter's return", async () => {
    const ticket = await sale("2026-02-10");
    expect(await quarters()).toEqual([TEN, []]);
    await sale("2026-05-10", {
      correctsSaleId: ticket,
      total: "-5.50",
      lines: [{ vatRate: "10.00", lineTotal: "-5.00" }],
    });
    expect(await quarters()).toEqual([TEN, []]);
  });

  it("B: a replacement naming an earlier quarter leaves that quarter as it was", async () => {
    const ticket = await sale("2026-04-01");
    expect(await quarters()).toEqual([[], TEN]);
    await sale("2026-05-10", {
      correctsSaleId: ticket,
      replacesOriginal: true,
      supplyDay: "2026-03-31",
    });
    expect(await quarters()).toEqual([[], []]);
  });

  it("C: a later void leaves the ended quarter as it was", async () => {
    const ticket = await sale("2026-02-10");
    expect(await quarters()).toEqual([TEN, []]);
    await seedVoid(suite.db, { saleId: ticket }, at("2026-05-10"));
    expect(await quarters()).toEqual([TEN, []]);
  });

  it("D: a ticket issued after its quarter for a day in it leaves that quarter as it was", async () => {
    expect(await quarters()).toEqual([[], []]);
    await sale("2026-04-01", { supplyDay: "2026-03-31" });
    expect(await quarters()).toEqual([[], []]);
  });

  describe("a TICKET replaced with an earlier quarter's day, then voided", () => {
    async function replaced(): Promise<{ original: SaleId; replacement: SaleId }> {
      const original = await sale("2026-04-01", TICKET);
      const replacement = await sale("2026-04-10", {
        ...TICKET,
        correctsSaleId: original,
        replacesOriginal: true,
        supplyDay: "2026-03-31",
      });
      return { original, replacement };
    }

    async function q2Corrections() {
      const movements = await withTransaction(suite.db, (tx) =>
        vatMovements(tx, { year: 2026, period: Q2 }),
      );
      return movements
        .filter((m) => m.madeDay >= "2026-04-01" && m.belongsDay < "2026-04-01")
        .map((m) => [m.madeDay, m.belongsDay, m.tax]);
    }

    it("V: voiding the original changes no quarter's return and lists both steps as corrections", async () => {
      const { original } = await replaced();
      expect(await quarters()).toEqual([[], []]);
      await seedVoid(suite.db, { saleId: original }, at("2026-05-10"));
      expect(await quarters()).toEqual([[], []]);
      expect(await q2Corrections()).toEqual([
        ["2026-04-10", "2026-03-31", "1.10"],
        ["2026-05-10", "2026-03-31", "-1.10"],
      ]);
    });

    it("R: voiding the replacement changes nothing", async () => {
      const { replacement } = await replaced();
      expect(await quarters()).toEqual([[], []]);
      const before = await q2Corrections();
      await seedVoid(suite.db, { saleId: replacement }, at("2026-05-10"));
      expect(await quarters()).toEqual([[], []]);
      expect(await q2Corrections()).toEqual(before);
    });
  });

  it("E: gives no line for a sale and its full corrective in the same quarter", async () => {
    const ticket = await sale("2026-02-10");
    await sale("2026-03-10", {
      correctsSaleId: ticket,
      total: "-11.00",
      lines: [{ vatRate: "10.00", lineTotal: "-10.00" }],
    });
    const q1 = await runPeriod(Q1);
    expect(q1.byRate).toEqual([]);
    expect(q1).toMatchObject({ baseTotal: "0.00", taxTotal: "0.00" });
  });

  it("keeps a rate line whose base nets to zero while its VAT does not", async () => {
    const ticket = await sale("2026-02-10", {
      total: "120.99",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
    });
    await sale("2026-03-10", {
      correctsSaleId: ticket,
      total: "-121.00",
      lines: [{ vatRate: "21.00", lineTotal: "-100.00" }],
      vatBreakdown: [{ rate: "21.00", base: "-100.00", tax: "-21.00" }],
    });
    expect((await runPeriod(Q1)).byRate).toEqual([{ rate: "21.00", base: "0.00", tax: "-0.01" }]);
  });

  it("counts every movement of a year once: in its quarter's return or a later quarter's corrections", async () => {
    // Ordinary invoices at two rates, one with a later correction and a correction of that.
    const mixed = await sale("2026-01-15", {
      total: "176.00",
      lines: [
        { vatRate: "21.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "50.00" },
      ],
    });
    const refund = await sale("2026-05-02", {
      correctsSaleId: mixed,
      total: "-24.20",
      lines: [{ vatRate: "21.00", lineTotal: "-20.00" }],
    });
    await sale("2026-08-02", {
      correctsSaleId: refund,
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    // A late ticket, and a late ticket later replaced with yet another day.
    await sale("2026-04-01", { supplyDay: "2026-03-31" });
    const lateReplaced = await sale("2026-07-01", { supplyDay: "2026-06-30" });
    await sale("2026-07-20", {
      correctsSaleId: lateReplaced,
      replacesOriginal: true,
      supplyDay: "2026-06-29",
    });
    // A replacement with a day, then its original voided; a replacement without one.
    const voidedReplaced = await sale("2026-07-01");
    await sale("2026-07-05", {
      correctsSaleId: voidedReplaced,
      replacesOriginal: true,
      supplyDay: "2026-06-30",
    });
    await seedVoid(suite.db, { saleId: voidedReplaced }, at("2026-11-03"));
    const undated = await sale("2026-02-20");
    await sale("2026-04-20", { correctsSaleId: undated, replacesOriginal: true });
    // Voids in the same quarter and in a later one.
    await seedVoid(suite.db, { saleId: await sale("2026-09-01") }, at("2026-09-02"));
    await seedVoid(suite.db, { saleId: await sale("2026-09-03") }, at("2026-10-02"));
    // A payment on account and its table's invoice, across the night the third quarter ends.
    const advance = await sale("2026-09-30", {
      total: "55.00",
      lines: [{ vatRate: "10.00", lineTotal: "50.00", advanceRole: "payment_on_account" }],
    });
    await sale("2026-10-01", {
      total: "55.00",
      lines: [
        { vatRate: "10.00", lineTotal: "100.00" },
        { vatRate: "10.00", lineTotal: "-50.00", advanceRole: "deduction", deductsSaleId: advance },
      ],
    });
    // An exchange invoice, which counts nothing.
    const exchanged = await sale("2026-11-10");
    const exchange = await sale("2026-11-11");
    await seedSubstitution(suite.db, {
      substitutionSaleId: exchange,
      substitutedSaleId: exchanged,
    });
    // A December invoice corrected in January of the next year.
    const december = await sale("2026-12-10");
    await sale("2027-01-12", {
      correctsSaleId: december,
      total: "-5.50",
      lines: [{ vatRate: "10.00", lineTotal: "-5.00" }],
    });

    const net = new Map<string, { base: Decimal; tax: Decimal }>();
    const add = (line: { rate: string; base: string; tax: string }, sign: 1 | -1 = 1) => {
      const now = net.get(line.rate) ?? { base: decimal("0.00"), tax: decimal("0.00") };
      const apply = sign === 1 ? addDecimal : subtractDecimal;
      net.set(line.rate, {
        base: apply(now.base, decimal(line.base)),
        tax: apply(now.tax, decimal(line.tax)),
      });
    };
    const corrected: Record<string, string[][]> = {};
    for (const [year, quarter] of [
      [2026, 1],
      [2026, 2],
      [2026, 3],
      [2026, 4],
      [2027, 1],
    ] as const) {
      const period: LiquidationPeriod = { kind: "quarter", quarter };
      if (year === 2026) for (const line of (await runPeriod(period)).byRate) add(line);
      const corrections = await withTransaction(suite.db, (tx) =>
        computeVatCorrections(tx, { year, period }),
      );
      for (const row of corrections.rows) add(row);
      corrected[corrections.madeIn] = corrections.rows.map((row) => [
        row.madeDay,
        `${row.invoice.seriesCode}/${row.invoice.number}`,
        row.kind,
        row.belongsTo,
        row.rate,
        row.direction,
        row.base,
        row.tax,
      ]);
    }
    expect(corrected).toEqual({
      "2026-1T": [],
      "2026-2T": [
        ["2026-04-01", "A/4", "issued_late", "2026-1T", "10.00", "addition", "10.00", "1.00"],
        ["2026-05-02", "A/2", "correction", "2026-1T", "21.00", "reduction", "-20.00", "-4.20"],
      ],
      "2026-3T": [
        ["2026-07-01", "A/5", "issued_late", "2026-2T", "10.00", "addition", "10.00", "1.00"],
        ["2026-07-05", "A/8", "date_moved_in", "2026-2T", "10.00", "addition", "10.00", "1.00"],
        ["2026-07-20", "A/6", "date_moved_out", "2026-2T", "10.00", "reduction", "-10.00", "-1.00"],
        ["2026-07-20", "A/6", "date_moved_in", "2026-2T", "10.00", "addition", "10.00", "1.00"],
        ["2026-08-02", "A/3", "correction", "2026-1T", "21.00", "addition", "10.00", "2.10"],
      ],
      "2026-4T": [
        ["2026-10-02", "A/12", "void", "2026-3T", "10.00", "reduction", "-10.00", "-1.00"],
        ["2026-11-03", "A/7", "void", "2026-2T", "10.00", "reduction", "-10.00", "-1.00"],
      ],
      "2027-1T": [
        ["2027-01-12", "A/18", "correction", "2026-4T", "10.00", "reduction", "-5.00", "-0.50"],
      ],
    });
    const year = await withTransaction(suite.db, (tx) =>
      vatMovements(tx, { year: 2026, period: { kind: "year" } }),
    );
    for (const m of year) add(m, -1);
    for (const [rate, line] of net) {
      expect([rate, toScale(line.base, 2), toScale(line.tax, 2)]).toEqual([rate, "0.00", "0.00"]);
    }
    expect(year.length).toBeGreaterThan(10);
  });
});

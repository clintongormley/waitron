import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleId } from "@waitron/shared";
import { seedSale, seedVenueWithSeries, seedVoid } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatCorrections } from "./vat-corrections.js";
import type { LiquidationPeriod } from "./period.js";
import type { VatCorrections } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
let nextNumber: number;

beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
  nextNumber = 1;
});

const Q2: LiquidationPeriod = { kind: "quarter", quarter: 2 };
const Q3: LiquidationPeriod = { kind: "quarter", quarter: 3 };

function at(day: string, time = "10:00:00"): string {
  return new Date(`${day}T${time}Z`).toISOString();
}

function corrections(period: LiquidationPeriod, year = 2026): Promise<VatCorrections> {
  return withTransaction(suite.db, (tx) => computeVatCorrections(tx, { year, period }));
}

/** A one-rate ticket: 10% on 11.00, VAT 1.10. */
const TICKET = { total: "12.10", lines: [{ vatRate: "10.00", lineTotal: "11.00" }] };

async function sale(
  issuedDay: string,
  opts: Omit<Parameters<typeof seedSale>[2], "invoiceNumber" | "issuedAt" | "total" | "lines"> & {
    total?: string;
    lines?: Parameters<typeof seedSale>[2]["lines"];
  } = {},
): Promise<SaleId> {
  return seedSale(suite.db, venue, {
    ...TICKET,
    ...opts,
    invoiceNumber: nextNumber++,
    issuedAt: at(issuedDay),
  });
}

describe("computeVatCorrections", () => {
  it("lists a ticket's date moved in August as a reduction for the second quarter and an addition for the first", async () => {
    // Stamped 1 April, really 31 March; the replacement naming 31 March is made in August.
    const ticket = await sale("2026-04-01");
    await sale("2026-08-12", {
      correctsSaleId: ticket,
      replacesOriginal: true,
      supplyDay: "2026-03-31",
    });
    const made = {
      madeDay: "2026-08-12",
      invoice: { seriesCode: "A", number: 2, issueDate: "2026-08-12" },
      corrects: { seriesCode: "A", number: 1, issueDate: "2026-04-01" },
      rate: "10.00",
    };
    expect(await corrections(Q3)).toEqual({
      rows: [
        {
          ...made,
          kind: "date_moved_out",
          belongsTo: "2026-2T",
          base: "-11.00",
          tax: "-1.10",
          direction: "reduction",
        },
        {
          ...made,
          kind: "date_moved_in",
          belongsTo: "2026-1T",
          base: "11.00",
          tax: "1.10",
          direction: "addition",
        },
      ],
      summary: [
        { belongsTo: "2026-1T", rate: "10.00", direction: "addition", base: "11.00", tax: "1.10" },
        {
          belongsTo: "2026-2T",
          rate: "10.00",
          direction: "reduction",
          base: "-11.00",
          tax: "-1.10",
        },
      ],
    });
  });

  it("lists a ticket issued in April for a March sale as an addition for the first quarter (#3398)", async () => {
    await sale("2026-04-01", { supplyDay: "2026-03-31" });
    expect(await corrections(Q2)).toEqual({
      rows: [
        {
          madeDay: "2026-04-01",
          kind: "issued_late",
          invoice: { seriesCode: "A", number: 1, issueDate: "2026-04-01" },
          corrects: null,
          belongsTo: "2026-1T",
          rate: "10.00",
          base: "11.00",
          tax: "1.10",
          direction: "addition",
        },
      ],
      summary: [
        { belongsTo: "2026-1T", rate: "10.00", direction: "addition", base: "11.00", tax: "1.10" },
      ],
    });
  });

  it("splits a late table's invoice by the sign of each rate line's base", async () => {
    // The advance taken off left the 10% line negative.
    const advance = await sale("2026-03-20", {
      total: "33.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00", advanceRole: "payment_on_account" }],
    });
    await sale("2026-04-02", {
      supplyDay: "2026-03-31",
      total: "13.20",
      lines: [
        { vatRate: "10.00", lineTotal: "20.00" },
        { vatRate: "10.00", lineTotal: "-30.00", advanceRole: "deduction", deductsSaleId: advance },
        { vatRate: "21.00", lineTotal: "20.00" },
      ],
    });
    const result = await corrections(Q2);
    expect(result.rows.map((r) => [r.rate, r.base, r.tax, r.direction])).toEqual([
      ["10.00", "-10.00", "-1.00", "reduction"],
      ["21.00", "20.00", "4.20", "addition"],
    ]);
    expect(result.summary).toEqual([
      {
        belongsTo: "2026-1T",
        rate: "10.00",
        direction: "reduction",
        base: "-10.00",
        tax: "-1.00",
      },
      { belongsTo: "2026-1T", rate: "21.00", direction: "addition", base: "20.00", tax: "4.20" },
    ]);
  });

  it("splits a corrective with one line up and one down into an addition and a reduction", async () => {
    const original = await sale("2026-03-10", {
      total: "36.30",
      lines: [
        { vatRate: "10.00", lineTotal: "11.00" },
        { vatRate: "21.00", lineTotal: "20.00" },
      ],
    });
    await sale("2026-05-05", {
      correctsSaleId: original,
      total: "-0.10",
      lines: [
        { vatRate: "10.00", lineTotal: "5.00" },
        { vatRate: "21.00", lineTotal: "-5.00" },
      ],
    });
    const result = await corrections(Q2);
    expect(result.rows.map((r) => [r.kind, r.belongsTo, r.rate, r.direction])).toEqual([
      ["correction", "2026-1T", "10.00", "addition"],
      ["correction", "2026-1T", "21.00", "reduction"],
    ]);
    expect(result.rows[0]!.corrects).toEqual({
      seriesCode: "A",
      number: 1,
      issueDate: "2026-03-10",
    });
    expect(result.summary).toEqual([
      { belongsTo: "2026-1T", rate: "10.00", direction: "addition", base: "5.00", tax: "0.50" },
      {
        belongsTo: "2026-1T",
        rate: "21.00",
        direction: "reduction",
        base: "-5.00",
        tax: "-1.05",
      },
    ]);
  });

  it("decides a line whose base is zero by the sign of its VAT", async () => {
    const original = await sale("2026-03-10");
    await sale("2026-05-05", {
      correctsSaleId: original,
      total: "-0.01",
      lines: [{ vatRate: "10.00", lineTotal: "0.00" }],
      vatBreakdown: [{ rate: "10.00", base: "0.00", tax: "-0.01" }],
    });
    expect((await corrections(Q2)).rows.map((r) => r.direction)).toEqual(["reduction"]);
  });

  it("leaves out a rate line whose base and VAT are both zero", async () => {
    const original = await sale("2026-03-10");
    await sale("2026-05-05", {
      correctsSaleId: original,
      total: "-1.10",
      lines: [
        { vatRate: "10.00", lineTotal: "-1.00" },
        { vatRate: "21.00", lineTotal: "0.00" },
      ],
      vatBreakdown: [
        { rate: "10.00", base: "-1.00", tax: "-0.10" },
        { rate: "21.00", base: "0.00", tax: "0.00" },
      ],
    });
    const result = await corrections(Q2);
    expect(result.rows.map((r) => [r.rate, r.direction])).toEqual([["10.00", "reduction"]]);
    expect(result.summary).toEqual([
      { belongsTo: "2026-1T", rate: "10.00", direction: "reduction", base: "-1.00", tax: "-0.10" },
    ]);
  });

  it("lists a cross-month correction for the month it was made in, not for its quarter", async () => {
    const april = await sale("2026-04-10");
    await sale("2026-05-05", {
      correctsSaleId: april,
      total: "-12.10",
      lines: [{ vatRate: "10.00", lineTotal: "-11.00", quantity: "-1.000" }],
    });
    expect(await corrections({ kind: "month", month: 5 })).toEqual({
      rows: [
        {
          madeDay: "2026-05-05",
          kind: "correction",
          invoice: { seriesCode: "A", number: 2, issueDate: "2026-05-05" },
          corrects: { seriesCode: "A", number: 1, issueDate: "2026-04-10" },
          belongsTo: "2026-04",
          rate: "10.00",
          base: "-11.00",
          tax: "-1.10",
          direction: "reduction",
        },
      ],
      summary: [
        {
          belongsTo: "2026-04",
          rate: "10.00",
          direction: "reduction",
          base: "-11.00",
          tax: "-1.10",
        },
      ],
    });
    expect(await corrections(Q2)).toEqual({ rows: [], summary: [] });
  });

  it("lists, for a year, a void of the previous year's invoice", async () => {
    const december = await sale("2025-12-20");
    await seedVoid(suite.db, { saleId: december }, at("2026-01-15"));
    expect(await corrections({ kind: "year" })).toEqual({
      rows: [
        {
          madeDay: "2026-01-15",
          kind: "void",
          invoice: { seriesCode: "A", number: 1, issueDate: "2025-12-20" },
          corrects: null,
          belongsTo: "2025",
          rate: "10.00",
          base: "-11.00",
          tax: "-1.10",
          direction: "reduction",
        },
      ],
      summary: [
        { belongsTo: "2025", rate: "10.00", direction: "reduction", base: "-11.00", tax: "-1.10" },
      ],
    });
  });

  it("sums the summary by belongs-to, rate and direction, sorted by belongs-to, rate, reductions first", async () => {
    const lastYear = await sale("2025-11-10");
    const january = await sale("2026-01-10", {
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
    });
    // A later quarter first, so the order is the sort's, not the rows'.
    const may = await sale("2026-05-02");
    const june = await sale("2026-06-01");
    await seedVoid(suite.db, { saleId: may }, at("2026-07-03"));
    await sale("2026-07-04", {
      correctsSaleId: january,
      total: "2.42",
      lines: [{ vatRate: "21.00", lineTotal: "2.00" }],
    });
    await sale("2026-07-05", {
      correctsSaleId: january,
      total: "1.21",
      lines: [{ vatRate: "21.00", lineTotal: "1.00" }],
    });
    await sale("2026-07-06", {
      correctsSaleId: january,
      total: "-6.05",
      lines: [{ vatRate: "21.00", lineTotal: "-5.00" }],
    });
    await sale("2026-07-07", {
      correctsSaleId: lastYear,
      total: "8.56",
      lines: [
        { vatRate: "10.00", lineTotal: "4.00" },
        { vatRate: "4.00", lineTotal: "4.00" },
      ],
    });
    // In the second quarter the reduction is made first; in the first, an addition.
    await sale("2026-07-09", {
      correctsSaleId: june,
      total: "1.10",
      lines: [{ vatRate: "10.00", lineTotal: "1.00" }],
    });
    expect((await corrections(Q3)).summary).toEqual([
      { belongsTo: "2025-4T", rate: "4.00", direction: "addition", base: "4.00", tax: "0.16" },
      { belongsTo: "2025-4T", rate: "10.00", direction: "addition", base: "4.00", tax: "0.40" },
      { belongsTo: "2026-1T", rate: "21.00", direction: "reduction", base: "-5.00", tax: "-1.05" },
      { belongsTo: "2026-1T", rate: "21.00", direction: "addition", base: "3.00", tax: "0.63" },
      { belongsTo: "2026-2T", rate: "10.00", direction: "reduction", base: "-11.00", tax: "-1.10" },
      { belongsTo: "2026-2T", rate: "10.00", direction: "addition", base: "1.00", tax: "0.10" },
    ]);
  });

  it("leaves out what was made in the period for it, and what was made before it", async () => {
    const march = await sale("2026-03-10");
    await sale("2026-03-20", {
      correctsSaleId: march,
      total: "-12.10",
      lines: [{ vatRate: "10.00", lineTotal: "-11.00", quantity: "-1.000" }],
    });
    const april = await sale("2026-04-10");
    await seedVoid(suite.db, { saleId: april }, at("2026-05-01"));
    expect(await corrections(Q2)).toEqual({ rows: [], summary: [] });
  });

  it("is empty for a period with nothing in it", async () => {
    expect(await corrections(Q2)).toEqual({ rows: [], summary: [] });
  });

  it("refuses a bad period", async () => {
    await expect(corrections(Q2, 99)).rejects.toThrow(/year must be/);
  });
});

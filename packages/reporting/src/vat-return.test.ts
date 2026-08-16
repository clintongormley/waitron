import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import {
  seedNodeAndSeries,
  seedPurchaseInvoice,
  seedSale,
  seedSubstitution,
  seedVenue,
  seedVoid,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatReturn } from "./vat-return.js";
import type { VatReturn } from "./types.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;

// A civil-August instant with the default offset 0 (12:00 local Madrid = 10:00Z, but the offset is
// irrelevant here since we only need the filed date to be 2026-08-04 either way).
const augNoonUtc = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(opts: { year: number; month: number; tenantId?: TenantId }): Promise<VatReturn> {
  const tenantId = opts.tenantId ?? venue.tenantId;
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return computeVatReturn(tx, { tenantId, year: opts.year, month: opts.month });
  });
}

describe("computeVatReturn", () => {
  it("aggregates the filed difference-method breakdown across two nodes, exactly", async () => {
    // Catalogue (gross-inclusive) sales file cuotas by the DIFFERENCE method, which can land a céntimo
    // away from round(base × rate). The 303 aggregate must sum the FILED per-invoice cuotas, never
    // re-round on the monthly base. Two nodes of the same tenant, both counted (no node predicate).
    const nodeB = await seedNodeAndSeries(suite.db, venue);
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
      tenantId: venue.tenantId,
      year: 2026,
      month: 8,
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

  it("excludes a voided sale", async () => {
    const s = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: augNoonUtc,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedVoid(suite.db, { tenantId: venue.tenantId, saleId: s }, augNoonUtc);
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([]);
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
      tenantId: venue.tenantId,
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
    // so it belongs to JULY. The 303 buckets on the civil date, not the cutover (spec §4, D4).
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
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "P1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-02",
      total: "86.43",
      lines: [{ rate: "21.00", base: "71.43", tax: "15.00" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "P2",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-03",
      total: "44.00",
      lines: [{ rate: "10.00", base: "40.00", tax: "4.00", kind: "capital" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
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
    // A mistyped year make_date still accepts (226 AD, 20226 AD) would otherwise match no sales and
    // return a plausible-but-EMPTY 303 — the quiet, worse direction for a fiscal filing. A year
    // make_date rejects (0) surfaces as a raw Postgres error mid-query, not the plain `reporting:`
    // Error. Both must be caught as a validation throw BEFORE any query — hence the pinned message.
    await expect(run({ year: 226, month: 8 })).rejects.toThrow(/year must be/);
    await expect(run({ year: 20226, month: 8 })).rejects.toThrow(/year must be/);
    await expect(run({ year: 0, month: 8 })).rejects.toThrow(/year must be/);
  });

  it("returns zeros for an empty month", async () => {
    // Extended for the deducible side (#89 slice B): with no sales AND no received invoices, the
    // deducible aggregate is empty and the result is 0.00 − 0.00. The devengado fields
    // (byRate/baseTotal/taxTotal) keep their #76 shape and values.
    expect(await run({ year: 2026, month: 3 })).toEqual({
      tenantId: venue.tenantId,
      year: 2026,
      month: 3,
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
      deductible: { byRate: [], baseTotal: "0.00", taxTotal: "0.00" },
      result: "0.00",
    });
  });
});

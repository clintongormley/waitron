import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { seedPurchaseInvoice, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeInputVat } from "./input-vat.js";
import type { InputVatReturn } from "./types.js";

// PGlite for the deterministic arithmetic (per-(rate,kind) Σ, received_on bucketing, regime and
// deductible_proportion handling), read under the app_user role — where FORCE RLS IS live (verified:
// a foreign tenant's rows are invisible under `asAppUser`, count 0). The explicit `p.tenant_id`
// predicate is a SEPARATE, belt-and-suspenders scoping; it is proven on its own in the last test by
// reading under the RAW superuser connection (no asAppUser), where RLS is bypassed so the predicate is
// the only thing scoping the query. The read under the real non-superuser app_user role against a real
// Postgres with FORCE RLS live is proven in input-vat.rls.test.ts.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenue(suite.db);
});

function run(opts: { year: number; month: number; tenantId?: TenantId }): Promise<InputVatReturn> {
  const tenantId = opts.tenantId ?? venue.tenantId;
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return computeInputVat(tx, {
      tenantId,
      year: opts.year,
      period: { kind: "month", month: opts.month },
    });
  });
}

describe("computeInputVat", () => {
  it("sums the filed per-invoice tax exactly, never round(Σ base × rate)", async () => {
    // Two received invoices whose supplier filed a difference-method cuota: 20.99, not
    // round(100 × 21%) = 21.00. The deducible aggregate must sum the FILED cuotas (20.99 + 20.99 =
    // 41.98), never re-round on the monthly base (which would give round(200 × 21%) = 42.00) — the
    // exactness rule inherited from the output side (#76/#66).
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "A1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-03",
      total: "120.99",
      lines: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "A2",
      issuedOn: "2026-08-02",
      receivedOn: "2026-08-04",
      total: "120.99",
      lines: [{ rate: "21.00", base: "100.00", tax: "20.99" }],
    });
    const ret = await run({ year: 2026, month: 8 });
    expect(ret.byRate).toEqual([{ rate: "21.00", base: "200.00", tax: "41.98", kind: "ordinary" }]);
    expect(ret).toMatchObject({
      tenantId: venue.tenantId,
      year: 2026,
      period: { kind: "month", month: 8 },
      baseTotal: "200.00",
      taxTotal: "41.98",
    });
  });

  it("splits ordinary and capital-goods lines (casilla 28/29 vs 30/31)", async () => {
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "B1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "363.00",
      lines: [
        { rate: "21.00", base: "200.00", tax: "42.00" },
        { rate: "21.00", base: "100.00", tax: "21.00", kind: "capital" },
      ],
    });
    const ret = await run({ year: 2026, month: 8 });
    // ordinary before capital at the same rate (casilla-order, not alphabetical).
    expect(ret.byRate).toEqual([
      { rate: "21.00", base: "200.00", tax: "42.00", kind: "ordinary" },
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "capital" },
    ]);
    expect(ret.baseTotal).toBe("300.00");
    expect(ret.taxTotal).toBe("63.00");
  });

  it("excludes equivalence-surcharge regime invoices (non-deductible, off the 303)", async () => {
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "RE1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "121.00",
      regime: "equivalence_surcharge",
      lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "GEN1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-06",
      total: "55.00",
      lines: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
    });
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00", kind: "ordinary" },
    ]);
  });

  it("buckets by received_on (the deduction period), not issued_on", async () => {
    // Received in July → deduct in July, even though issued in August; and vice versa.
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "JUL",
      issuedOn: "2026-08-02",
      receivedOn: "2026-07-31",
      total: "121.00",
      lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "AUG",
      issuedOn: "2026-07-30",
      receivedOn: "2026-08-01",
      total: "55.00",
      lines: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
    });
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00", kind: "ordinary" },
    ]);
    expect((await run({ year: 2026, month: 7 })).byRate).toEqual([
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
    ]);
  });

  it("applies deductible_proportion per invoice (the prorrata seam), scaling only the tax", async () => {
    // Spec §6/§9: the base is reported in full; only the deductible cuota is scaled by the proportion.
    // 42.00 × 50% = 21.00.
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "P1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "242.00",
      deductibleProportion: "50.00",
      lines: [{ rate: "21.00", base: "200.00", tax: "42.00" }],
    });
    expect((await run({ year: 2026, month: 8 })).byRate).toEqual([
      { rate: "21.00", base: "200.00", tax: "21.00", kind: "ordinary" },
    ]);
  });

  it("returns zeros for a month with no received invoices", async () => {
    expect(await run({ year: 2026, month: 3 })).toEqual({
      tenantId: venue.tenantId,
      year: 2026,
      period: { kind: "month", month: 3 },
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
    });
  });

  it("scopes to the explicit tenant predicate under a superuser (RLS-bypassed) connection", async () => {
    // Read WITHOUT asAppUser — the raw PGlite superuser connection, where RLS is bypassed (the probe
    // that established this reads a foreign tenant's rows here). So the explicit `p.tenant_id`
    // predicate is the ONLY thing scoping the query, and removing it leaks the other tenant's 4% line
    // (prove-by-deletion). The RLS half — the same read under a real non-superuser app_user role — is
    // proven in input-vat.rls.test.ts.
    const other = await seedVenue(suite.db);
    await seedPurchaseInvoice(suite.db, other, {
      supplierInvoiceNumber: "OTHER",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "1040.00",
      lines: [{ rate: "4.00", base: "1000.00", tax: "40.00" }],
    });
    await seedPurchaseInvoice(suite.db, venue, {
      supplierInvoiceNumber: "MINE",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "121.00",
      lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
    });
    const ret = await withTenant(suite.db, venue.tenantId, (tx) =>
      computeInputVat(tx, {
        tenantId: venue.tenantId,
        year: 2026,
        period: { kind: "month", month: 8 },
      }),
    );
    expect(ret.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }]);
  });

  it("throws a plain validation Error on an out-of-range month or year", async () => {
    await expect(run({ year: 2026, month: 0 })).rejects.toThrow(/month must be/);
    await expect(run({ year: 2026, month: 13 })).rejects.toThrow(/month must be/);
    await expect(run({ year: 226, month: 8 })).rejects.toThrow(/year must be/);
  });
});

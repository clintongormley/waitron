import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { seedSale, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeVatReturn } from "./vat-return.js";
import type { VatReturn } from "./types.js";

// Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable (the
// package's vitest `globalSetup` throws when Docker is absent rather than degrading to a skip). The
// modelo 303 aggregate
// (`computeVatReturn`) is tenant-wide: it drops the node predicate (spec §4/D5), so RLS and the
// explicit `s.tenant_id` predicate inside `aggregateVatByRate` are the ONLY scoping across nodes.
// PGlite runs every connection as a superuser and serialises onto ONE backend (CLAUDE.md §4), so it
// BYPASSES row-level security entirely — a cross-tenant isolation proof on PGlite would pass whether
// or not RLS exists, a FALSE pass. The deterministic arithmetic (per-rate Σ, civil-date bucketing,
// corrections/voids/F3 exclusions) lives in `vat-return.test.ts` on PGlite, where it belongs. This
// suite exercises the read under the real non-superuser `app_user` role with FORCE ROW LEVEL
// SECURITY active, which no PGlite suite can.
//
// PROVE-BY-DELETION (CLAUDE.md §1, done by hand, not left in the tree): with the explicit
// `and s.tenant_id = ${scope.tenantId}` predicate temporarily removed from `aggregateVatByRate`
// (`vat-summary.ts`), `pnpm --filter @waitron/reporting test vat-return.rls` STILL passed —
// tenant B's sales stayed invisible to tenant A's return. That proves the RLS layer is
// independently live here: the tenant-isolation policy (`tenant_id = current_tenant_id()`, seeded
// with A's `app.tenant_id` GUC by `withTenant`) does the scoping on its own under `app_user`. The
// predicate is NOT redundant, though: under a BYPASSRLS/superuser connection — which every PGlite
// suite in this package uses — RLS does nothing and ONLY the explicit predicate scopes the query.
// So both layers are load-bearing, each in the environment the other cannot cover; this suite pins
// the RLS half, the PGlite suites pin the predicate half.

const suite = useTemplateDb({ template: "core" });

// Two FRESH tenants (seedVenue mints a new tenant/node/series each call), each with a month of
// August 2026 sales at DELIBERATELY disjoint rates so any cross-tenant leak is loud: only B files a
// 4%-rate line, and the two 21% bases differ, so if B bled into A's return the exact-equality
// assertions below would show a stray 4.00 line and an inflated 21.00 base. Offset 0 throughout, so
// the filed fecha de expedición equals the UTC calendar date (the civil-date bucketing is proven in
// vat-return.test.ts; here we only need both months to land in August).
let venueA: SeededVenue;
let venueB: SeededVenue;

beforeAll(async () => {
  // Seed as admin (superuser bypasses RLS), the same way record-daily-close.rls.test.ts seeds.
  venueA = await seedVenue(suite.admin);
  venueB = await seedVenue(suite.admin);

  // Tenant A: 21% (two sales, base 100 + 200) and 10% (base 50). No 4% line.
  await seedSale(suite.admin, venueA, {
    invoiceNumber: 1,
    issuedAt: new Date("2026-08-04T10:00:00Z").toISOString(),
    total: "121.00",
    lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    vatBreakdown: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
  });
  await seedSale(suite.admin, venueA, {
    invoiceNumber: 2,
    issuedAt: new Date("2026-08-11T10:00:00Z").toISOString(),
    total: "55.00",
    lines: [{ vatRate: "10.00", lineTotal: "50.00" }],
    vatBreakdown: [{ rate: "10.00", base: "50.00", tax: "5.00" }],
  });
  await seedSale(suite.admin, venueA, {
    invoiceNumber: 3,
    issuedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    total: "242.00",
    lines: [{ vatRate: "21.00", lineTotal: "200.00" }],
    vatBreakdown: [{ rate: "21.00", base: "200.00", tax: "42.00" }],
  });

  // Tenant B: a 4% line (base 1000) and a 21% line with a base A never files (500). Both are B's
  // signature — neither may ever appear in A's return.
  await seedSale(suite.admin, venueB, {
    invoiceNumber: 1,
    issuedAt: new Date("2026-08-05T10:00:00Z").toISOString(),
    total: "1040.00",
    lines: [{ vatRate: "4.00", lineTotal: "1000.00" }],
    vatBreakdown: [{ rate: "4.00", base: "1000.00", tax: "40.00" }],
  });
  await seedSale(suite.admin, venueB, {
    invoiceNumber: 2,
    issuedAt: new Date("2026-08-15T10:00:00Z").toISOString(),
    total: "605.00",
    lines: [{ vatRate: "21.00", lineTotal: "500.00" }],
    vatBreakdown: [{ rate: "21.00", base: "500.00", tax: "105.00" }],
  });
});

/** Runs `computeVatReturn` under the real non-superuser `app_user` role with `tenantId`'s RLS GUC —
 * the exact shape the reporting reads use in production. */
function run(tenantId: TenantId, year: number, month: number): Promise<VatReturn> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return computeVatReturn(tx, { tenantId, year, period: { kind: "month", month } });
  });
}

describe("computeVatReturn cross-tenant isolation under real RLS", () => {
  it("reads as a non-superuser role without BYPASSRLS (so RLS actually applies)", async () => {
    // THE LOAD-BEARING GUARD, the analogue of record-daily-close.rls.test.ts's "distinct backends"
    // test. If `asAppUser` did not drop to a role that RLS binds — a superuser or a BYPASSRLS role —
    // the isolation below would be enforced by the explicit predicate alone and the RLS half would be
    // untested theatre. This asserts the read really runs where RLS is live.
    const facts = await withTenant(suite.admin, venueA.tenantId, async (tx) => {
      await asAppUser(tx);
      const { rows } = await tx.execute<{ role: string; super: boolean; bypass: boolean }>(sql`
        select current_user as role,
               (select rolsuper from pg_roles where rolname = current_user) as super,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
      return rows[0]!;
    });
    expect(facts.role).toBe("app_user");
    expect(facts.super).toBe(false);
    expect(facts.bypass).toBe(false);
  });

  it("returns ONLY tenant A's sales — tenant B's base/tax never appear", async () => {
    const ret = await run(venueA.tenantId, 2026, 8);
    // Exactly A's two rates: B's 4% line and B's 21% base (500) are absent, and the 21% base is
    // A's 100+200 = 300, not 300+500. Any RLS leak would corrupt one of these.
    expect(ret.byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00" },
      { rate: "21.00", base: "300.00", tax: "63.00" },
    ]);
    expect(ret).toMatchObject({
      tenantId: venueA.tenantId,
      year: 2026,
      period: { kind: "month", month: 8 },
      baseTotal: "350.00",
      taxTotal: "68.00",
    });
    // B's signature 4%-rate line must never cross the tenant boundary.
    expect(ret.byRate.some((line) => line.rate === "4.00")).toBe(false);
  });

  it("returns ONLY tenant B's sales — the isolation holds in both directions", async () => {
    const ret = await run(venueB.tenantId, 2026, 8);
    expect(ret.byRate).toEqual([
      { rate: "4.00", base: "1000.00", tax: "40.00" },
      { rate: "21.00", base: "500.00", tax: "105.00" },
    ]);
    expect(ret).toMatchObject({
      tenantId: venueB.tenantId,
      year: 2026,
      period: { kind: "month", month: 8 },
      baseTotal: "1500.00",
      taxTotal: "145.00",
    });
  });
});

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { seedPurchaseInvoice, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeInputVat } from "./input-vat.js";
import type { InputVatReturn } from "./types.js";

// Real PostgreSQL via Testcontainers — deliberately NOT skipped when Docker is unavailable. The
// deducible aggregate (`computeInputVat`) is tenant-wide: RLS and the explicit `p.tenant_id` predicate
// are the ONLY scoping across nodes. This suite exercises the read under the real non-superuser
// `app_user` role with FORCE ROW LEVEL SECURITY active, which no PGlite superuser connection can. The
// deterministic arithmetic and the predicate-under-superuser proof live in input-vat.test.ts; this
// suite pins the RLS half. Mirrors vat-return.rls.test.ts.
//
// PROVE-BY-DELETION (CLAUDE.md §1, done by hand, not left in the tree): with the explicit
// `and p.tenant_id = ${input.tenantId}` predicate temporarily removed from `computeInputVat`, this
// suite STILL passed — tenant B's invoices stayed invisible to tenant A's aggregate, because the
// purchase-invoice tenant-isolation policy (proven independently in
// packages/purchasing/src/purchase-invoices.rls.test.ts) does the scoping on its own under app_user.
// The predicate is NOT redundant, though: under a superuser/BYPASSRLS connection — which the PGlite
// suite uses for its predicate test — RLS does nothing and only the explicit predicate scopes. Both
// layers are load-bearing, each in the environment the other cannot cover.
const suite = useTemplateDb({ template: "core" });

let venueA: SeededVenue;
let venueB: SeededVenue;

beforeAll(async () => {
  // Seed as admin (superuser bypasses RLS). Disjoint signatures so any leak is loud: only B files a
  // 4% line, and A's rates/bases are its own.
  venueA = await seedVenue(suite.admin);
  venueB = await seedVenue(suite.admin);

  await seedPurchaseInvoice(suite.admin, venueA, {
    supplierInvoiceNumber: "A-1",
    issuedOn: "2026-08-01",
    receivedOn: "2026-08-03",
    total: "121.00",
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
  });
  await seedPurchaseInvoice(suite.admin, venueA, {
    supplierInvoiceNumber: "A-2",
    issuedOn: "2026-08-05",
    receivedOn: "2026-08-06",
    total: "55.00",
    lines: [{ rate: "10.00", base: "50.00", tax: "5.00", kind: "capital" }],
  });
  await seedPurchaseInvoice(suite.admin, venueB, {
    supplierInvoiceNumber: "B-1",
    issuedOn: "2026-08-02",
    receivedOn: "2026-08-04",
    total: "1040.00",
    lines: [{ rate: "4.00", base: "1000.00", tax: "40.00" }],
  });
});

function run(tenantId: TenantId): Promise<InputVatReturn> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return computeInputVat(tx, { tenantId, year: 2026, period: { kind: "month", month: 8 } });
  });
}

describe("computeInputVat cross-tenant isolation under real RLS", () => {
  it("reads as a non-superuser role without BYPASSRLS (so RLS actually applies)", async () => {
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

  it("returns ONLY tenant A's deducible — tenant B's 4% line never appears", async () => {
    const ret = await run(venueA.tenantId);
    expect(ret.byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00", kind: "capital" },
      { rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" },
    ]);
    expect(ret.taxTotal).toBe("26.00");
    expect(ret.byRate.some((line) => line.rate === "4.00")).toBe(false);
  });

  it("returns ONLY tenant B's deducible — the isolation holds in both directions", async () => {
    const ret = await run(venueB.tenantId);
    expect(ret.byRate).toEqual([{ rate: "4.00", base: "1000.00", tax: "40.00", kind: "ordinary" }]);
    expect(ret.taxTotal).toBe("40.00");
  });
});

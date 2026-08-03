import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { invoiceSeries } from "./series.js";
import { saleVoids } from "./sale-voids.js";
import { saleLines, sales, tenders } from "./sales.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
let seriesB = "";
// sales.node_id is NOT NULL since the node-id rekey (2026-08-03); a node per tenant keeps the
// composite (tenant_id, node_id) → nodes FK satisfied.
let nodeA = "";
let nodeB = "";

/**
 * Mirrors sales.test.ts's identical seed/saleValues/recordCompleteSale helpers. Those are that
 * file's own private fixtures (not exported — see @waitron/db's index.ts barrel comment on what
 * this package's testing surface actually re-exports), and this file needs the same two-tenant
 * sale-then-void shape sales.test.ts's "hides another tenant's sale from the app role" test uses,
 * so the pattern is reproduced here rather than invented anew.
 */
async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeB = await seedNode(db, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_A, nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const [b] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_B, nodeId: nodeB, code: "FB", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
  seriesB = b.id;
}

function saleValues(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    tillId: TILL_A1,
    nodeId: nodeA,
    seriesId: seriesA,
    invoiceNumber: 1,
    issuedAt: AT,
    issuedOffsetMinutes: 120,
    total: "1.00",
    locale: "es",
    invoiceLocales: ["es", "ca"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded" as const,
    ...overrides,
  };
}

/** Writes a sale — header, line and a covering tender — in one transaction. Mirrors sales.test.ts's
 * recordCompleteSale, trimmed to the single-tender case this file needs. Since 0012 the coverage
 * check no longer fires at sale COMMIT (it moved to the sale_settlements INSERT), so this shape is
 * no longer forced; the tender covers the sale anyway (amount = total, no tip). */
async function recordCompleteSale(
  db: Database,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    const [sale] = await tx.insert(sales).values(saleValues(overrides)).returning({ id: sales.id });
    await tx.insert(saleLines).values({
      tenantId: (overrides.tenantId as string) ?? TENANT_A,
      saleId: sale.id,
      lineNo: 1,
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: "1.000",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
    });
    await tx.insert(tenders).values({
      tenantId: (overrides.tenantId as string) ?? TENANT_A,
      saleId: sale.id,
      method: "card",
      amount: "1.00",
      settledAt: AT,
    });
    return sale.id;
  });
}

describeEachTarget("sale_voids — tenant isolation", (target) => {
  let db: Database;
  let voidIdA = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    const saleIdA = await recordCompleteSale(db);
    const saleIdB = await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      nodeId: nodeB,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const [voidA] = await db
      .insert(saleVoids)
      .values({ tenantId: TENANT_A, saleId: saleIdA, reason: "Wrong table", voidedAt: AT })
      .returning({ id: saleVoids.id });
    voidIdA = voidA.id;
    await db
      .insert(saleVoids)
      .values({ tenantId: TENANT_B, saleId: saleIdB, reason: "Wrong table", voidedAt: AT });
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("hides another tenant's sale void from the app role", async () => {
    // M1 (whole-branch review): sale_voids carries ENABLE + FORCE ROW LEVEL
    // SECURITY plus a tenant_isolation policy, and immutability.test.ts's
    // auto-discovered flag guard already asserts both booleans are set. But
    // that guard only checks the flags exist — a too-permissive predicate
    // (`USING (true)`, or a mistyped column) would pass it while leaking every
    // tenant's voids across the app role. Only a functional read, from a
    // second tenant's row, proves the predicate itself is doing the
    // filtering. Mirrors sales.test.ts's "hides another tenant's sale from
    // the app role".
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: saleVoids.id }).from(saleVoids);
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(voidIdA);
  });
});

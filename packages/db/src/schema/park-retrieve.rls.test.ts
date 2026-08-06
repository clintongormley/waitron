import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: the headline assertion here is that
// `working_order_counters` is FORCE-RLS + tenant-isolated, and PGlite connects as a superuser that
// bypasses FORCE ROW LEVEL SECURITY unconditionally — so a PGlite pass would be a false pass
// (CLAUDE.md §4). The constraint assertions (UNIQUE, FK) would pass on either target; they ride
// along on the one container this suite already needs for the RLS check.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const BOGUS_PRODUCT = "99999999-9999-4999-8999-999999999999";
const AT = "2026-07-20T19:20:30+00:00";
// Café solo / Cafè sol is this package's placeholder description (orders.test.ts, sales.test.ts):
// the trigger checks description KEYS against the venue's invoice_locales, and these two literals
// already pass english-only.ts's SPANISH_WORDS guard where "linea"/"venta" would not.
const DESCRIPTIONS_A = JSON.stringify({ es: "Café solo", ca: "Cafè sol" });

// Captured at seed time — the ids the raw inserts below need for tenant-consistent FKs.
let nodeA = "";
let seriesA = "";
let productA = "";

function insertSaleSql(opts: {
  invoiceNumber: number;
  workingOrderId: string;
}): ReturnType<typeof sql> {
  // Raw insert (not the drizzle `sales` object) so the RED phase fails on "column working_order_id
  // does not exist" — the real cause — rather than on a TypeScript shape mismatch.
  return sql`insert into sales (
      tenant_id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes,
      total, locale, invoice_locales, fiscal_backend, fiscal_state, working_order_id
    ) values (
      ${TENANT_A}, ${TILL_A1}, ${nodeA}, ${seriesA}, ${opts.invoiceNumber}, ${AT}, 120,
      '1.00', 'es', array['es','ca']::text[], 'verifactu', 'recorded', ${opts.workingOrderId}
    )`;
}

async function openOrder(admin: Database, orderNumber: number): Promise<string> {
  const result = await admin.execute<{ id: string }>(
    sql`insert into working_orders (tenant_id, till_id, order_number, status, opened_at)
        values (${TENANT_A}, ${TILL_A1}, ${orderNumber}, 'open', ${AT}) returning id`,
  );
  return result.rows[0]!.id;
}

describe("park & retrieve schema", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The park & retrieve schema suite requires a running Docker daemon. It cannot be " +
          "skipped: PGlite runs every connection as a superuser, which bypasses the FORCE ROW " +
          "LEVEL SECURITY this suite exists to prove on working_order_counters.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    // Restates this package's own vitest hookTimeout (120s), which the helper's 60s default would
    // otherwise narrow — the figure covers pulling the Postgres image on a cold runner.
    timeoutMs: 120_000,
  });

  // Common scaffolding seeded once as the owner (superuser bypasses RLS — pure setup). Registered
  // after the helper's own hook, which vitest runs first; if it throws this one never runs, so
  // `suite.admin` is never read unstarted (verified pattern, provisioner-role.rls.test.ts).
  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
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
    await admin.insert(tills).values([
      { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
      { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
    ]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const [series] = await admin
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, nodeId: nodeA, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesA = series.id;
    const [catalogue] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli" })
      .returning({ id: catalogues.id });
    const [product] = await admin
      .insert(products)
      .values({
        tenantId: TENANT_A,
        catalogueId: catalogue.id,
        descriptions: { es: "Café solo", ca: "Cafè sol" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = product.id;
  });

  it("hides another tenant's working_order_counter from the app role", async () => {
    // Seed the counter as the owner (superuser bypasses RLS). Tenant A's app role then sees it and
    // tenant B's does not — the tenant-isolation policy filtering reads. The positive read (A sees
    // 1) is load-bearing: without it, B's 0 could equally mean "app_user has no access at all",
    // proving nothing about isolation. FORCE itself is asserted structurally by the inmutabilidad
    // guard (fiscal-verifactu), which reads relforcerowsecurity; this proves the POLICY works.
    await suite.admin.execute(
      sql`insert into working_order_counters (tenant_id, node_id, next_number)
          values (${TENANT_A}, ${nodeA}, 5)`,
    );
    const seenByA = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ n: string }>(sql`select count(*)::text as n from working_order_counters`);
    });
    expect(seenByA.rows[0]?.n).toBe("1");

    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ n: string }>(sql`select count(*)::text as n from working_order_counters`);
    });
    expect(seenByB.rows[0]?.n).toBe("0");
  });

  it("rejects two sales sharing a working_order_id (the sale idempotency key)", async () => {
    // Two sales that both try to file against one parked order — the double-submit the
    // UNIQUE(tenant_id, working_order_id) prevents. Distinct invoice numbers so the collision is on
    // sales_working_order_id_key, not on sales_series_invoice_number_key.
    const wo = await openOrder(suite.admin, 10);
    await suite.admin.execute(insertSaleSql({ invoiceNumber: 100, workingOrderId: wo }));
    const error = await captureError(() =>
      suite.admin.execute(insertSaleSql({ invoiceNumber: 101, workingOrderId: wo })),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("accepts a draft line with a real product and rejects one pointing at a missing product", async () => {
    const wo = await openOrder(suite.admin, 11);
    // Positive control: a valid, tenant-consistent product_id is accepted — so the rejection below
    // is the FK biting, not the line being malformed for some other reason.
    await suite.admin.execute(
      sql`insert into working_order_lines
        (tenant_id, working_order_id, line_no, product_id, descriptions,
         quantity, unit_price, vat_rate, line_total)
        values (${TENANT_A}, ${wo}, 1, ${productA}, ${DESCRIPTIONS_A}::jsonb,
         '1.000', '1.00', '10.00', '1.00')`,
    );
    // Negative: a product_id with no products row is refused 23503. The BEFORE triggers
    // (require_open_parent, check_locales) pass first — open parent, matching locales — so the row
    // reaches the composite (tenant_id, product_id) → products FK, which is what rejects it.
    const error = await captureError(() =>
      suite.admin.execute(
        sql`insert into working_order_lines
          (tenant_id, working_order_id, line_no, product_id, descriptions,
           quantity, unit_price, vat_rate, line_total)
          values (${TENANT_A}, ${wo}, 2, ${BOGUS_PRODUCT}, ${DESCRIPTIONS_A}::jsonb,
           '1.000', '1.00', '10.00', '1.00')`,
      ),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("gives products a UNIQUE(tenant_id, id) — the composite FK target for draft lines", async () => {
    // The unique products.product_id draft lines reference is a composite (tenant_id, id) UNIQUE,
    // not the bare id PK: it is what makes working_order_lines_product_fk tenant-consistent. Read
    // the constraint definition directly rather than trusting that the FK's mere existence implies
    // its shape.
    const result = await suite.admin.execute<{ def: string }>(
      sql`select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'products'::regclass and conname = 'products_tenant_id_key'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.def).toBe("UNIQUE (tenant_id, id)");
  });
});

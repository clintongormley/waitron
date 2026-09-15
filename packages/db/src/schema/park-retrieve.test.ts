import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { usePgliteDb } from "../testing/lifecycle.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, products } from "./catalogue.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const BOGUS_PRODUCT = "99999999-9999-4999-8999-999999999999";
const AT = "2026-07-20T19:20:30+00:00";
// Café solo / Cafè sol is this package's placeholder description (orders.test.ts, sales.test.ts):
// the trigger checks description KEYS against the venue's invoice_locales, and these two literals
// already pass english-only.ts's SPANISH_WORDS guard where `linea`/`venta` would not.
const DESCRIPTIONS_A = JSON.stringify({ es: "Café solo", ca: "Cafè sol" });

// Captured at seed time — the ids the raw inserts below need as foreign-key targets.
let nodeA = "";
let seriesA = "";
let productA = "";

function insertSaleSql(opts: {
  invoiceNumber: number;
  workingOrderId: string;
}): ReturnType<typeof sql> {
  // Raw insert (not the drizzle `sales` object) so the RED phase fails on "column working_order_id
  // does not exist" — the real cause — rather than on a TypeScript shape mismatch.
  return sql`insert into sales (till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, working_order_id) values (${TILL_A1}, ${nodeA}, ${seriesA}, ${opts.invoiceNumber}, ${AT}, 120,
      '1.00', '[]'::jsonb, 'es', array['es','ca']::text[], 'verifactu', 'recorded', ${opts.workingOrderId}
    )`;
}

async function openOrder(admin: Database, orderNumber: number): Promise<string> {
  const result = await admin.execute<{ id: string }>(
    sql`insert into working_orders (till_id, order_number, status, opened_at) values (${TILL_A1}, ${orderNumber}, 'open', ${AT}) returning id`,
  );
  return result.rows[0]!.id;
}

describe("park & retrieve schema", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    const admin = suite.db;
    await admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const [series] = await admin
      .insert(invoiceSeries)
      .values({ nodeId: nodeA, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesA = series.id;
    const [catalogue] = await admin
      .insert(catalogues)
      .values({ name: "Deli" })
      .returning({ id: catalogues.id });
    const [product] = await admin
      .insert(products)
      .values({
        catalogueId: catalogue.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = product.id;
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from working_order_lines`);
    // Keep the parked order referenced by the append-only sale; remove unreferenced draft orders.
    await suite.db.execute(sql`delete from working_orders
      where id not in (select working_order_id from sales where working_order_id is not null)`);
  });

  it("rejects two sales sharing a working_order_id (the sale idempotency key)", async () => {
    // Two sales that both try to file against one parked order — the double-submit the
    // UNIQUE(working_order_id) prevents. Distinct invoice numbers so the collision is on
    // sales_working_order_id_key, not on sales_series_invoice_number_key.
    const wo = await openOrder(suite.db, 10);
    await suite.db.execute(insertSaleSql({ invoiceNumber: 100, workingOrderId: wo }));
    const error = await captureError(() =>
      suite.db.execute(insertSaleSql({ invoiceNumber: 101, workingOrderId: wo })),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("accepts a draft line with a real product and rejects one pointing at a missing product", async () => {
    const wo = await openOrder(suite.db, 11);
    // Positive control: a product_id naming a real row is accepted — so the rejection below
    // is the FK biting, not the line being malformed for some other reason.
    await suite.db.execute(
      sql`insert into working_order_lines (working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${wo}, 1, ${productA}, 'Café solo', ${DESCRIPTIONS_A}::jsonb,
         '1.000', '1.00', '1.10', '10.00', '1.00')`,
    );
    // Negative: a product_id with no products row is refused 23503. The BEFORE triggers
    // (require_open_parent, check_locales) pass first — open parent, matching locales — so the row
    // reaches the (product_id) → products FK, which is what rejects it.
    const error = await captureError(() =>
      suite.db.execute(
        sql`insert into working_order_lines (working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${wo}, 2, ${BOGUS_PRODUCT}, 'Café solo', ${DESCRIPTIONS_A}::jsonb,
           '1.000', '1.00', '1.10', '10.00', '1.00')`,
      ),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("points a draft line's product_id at the products primary key", async () => {
    // Read the constraint definition directly rather than trusting that the foreign key's mere
    // existence implies its shape.
    const result = await suite.db.execute<{ def: string }>(
      sql`select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'working_order_lines'::regclass
            and conname = 'working_order_lines_product_fk'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.def).toBe(
      "FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT",
    );
  });
});

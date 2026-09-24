import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { refusalOn } from "../constraint-target.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, products } from "./catalogue.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const BOGUS_PRODUCT = "99999999-9999-4999-8999-999999999999";
const AT = "2026-07-20T19:20:30+00:00";
// The trigger checks description KEYS against the venue's invoice_locales (es, ca).
const DESCRIPTIONS_A = JSON.stringify({ es: "Café solo", ca: "Cafè sol" });

let nodeA = "";
let seriesA = "";
let productA = "";

function insertSaleSql(opts: {
  invoiceNumber: number;
  workingOrderId: string;
}): ReturnType<typeof sql> {
  // `id` is named explicitly because `sales.id` is `$defaultFn(newId)` — a JavaScript generator
  // rather than a SQL DEFAULT, which a raw insert never reaches.
  return sql`insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, working_order_id) values (${randomUUID()}, ${TILL_A1}, ${nodeA}, ${seriesA}, ${opts.invoiceNumber}, ${AT}, 120,
      100, '[]', 'es', '["es","ca"]', 'verifactu', 'recorded', ${opts.workingOrderId}
    )`;
}

// `id` is supplied for the reason {@link insertSaleSql} records.
async function openOrder(admin: Database, orderNumber: number): Promise<string> {
  const result = await admin.execute<{ id: string }>(
    sql`insert into working_orders (id, till_id, order_number, status, opened_at) values (${randomUUID()}, ${TILL_A1}, ${orderNumber}, 'open', ${AT}) returning id`,
  );
  return result.rows[0]!.id;
}

describe("park & retrieve schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    const admin = suite.db;
    await admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(admin, brandLocationId(LOCATION_A));
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
        unitPrice: 100,
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
    // Distinct invoice numbers so the collision is on the working_order_id index, not on the
    // (series_id, invoice_number) one.
    const wo = await openOrder(suite.db, 10);
    await suite.db.execute(insertSaleSql({ invoiceNumber: 100, workingOrderId: wo }));
    const error = await captureError(() =>
      suite.db.execute(insertSaleSql({ invoiceNumber: 101, workingOrderId: wo })),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "sales", columns: ["working_order_id"] }),
    ).toBe(true);
  });

  it("accepts a draft line with a real product and rejects one pointing at a missing product", async () => {
    const wo = await openOrder(suite.db, 11);
    // Positive control: a product_id naming a real row is accepted — so the rejection below
    // is the FK biting, not the line being malformed for some other reason.
    await suite.db.execute(
      sql`insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${randomUUID()}, ${wo}, 1, ${productA}, 'Café solo', ${DESCRIPTIONS_A},
         1000, 100, 110, 1000, 100)`,
    );
    // Read back to pin the insert's scales: a `1` and a `10` would be accepted and mean a
    // thousandth of a unit at a hundredth of a percent. Cast to text so the assertion does not
    // turn on how the driver renders the integer.
    const stored = await suite.db.execute<{ quantity: string; vat_rate: string }>(
      sql`select cast(quantity as text) as quantity, cast(vat_rate as text) as vat_rate
            from working_order_lines where working_order_id = ${wo} and line_no = 1`,
    );
    expect(stored.rows).toEqual([{ quantity: "1000", vat_rate: "1000" }]);
    // A foreign-key refusal names no key, so the positive control above carries WHICH key: it is
    // the same insert with a real `product_id`, differing otherwise only in line number.
    const error = await captureError(() =>
      suite.db.execute(
        sql`insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${randomUUID()}, ${wo}, 2, ${BOGUS_PRODUCT}, 'Café solo', ${DESCRIPTIONS_A},
           1000, 100, 110, 1000, 100)`,
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("points a draft line's product_id at the products primary key", async () => {
    // Pins the key's shape, not its name: SQLite stores no foreign-key name.
    const result = await suite.db.execute<{
      from: string;
      table: string;
      to: string;
      on_delete: string;
    }>(
      sql`select "from", "table", "to", on_delete
            from pragma_foreign_key_list('working_order_lines') where "from" = 'product_id'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      from: "product_id",
      table: "products",
      to: "id",
      on_delete: "RESTRICT",
    });
  });
});

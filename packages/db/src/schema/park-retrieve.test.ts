import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, products } from "./catalogue.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

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
  //
  // Three things the engine changed, none of which touches what the case asserts. `'[]'::jsonb`
  // and `array['es','ca']::text[]` are both refused at prepare here — `unrecognized token: ":"`
  // and `near "['es','ca']": syntax error` respectively (node v26.7.0, `node:sqlite`): SQLite has
  // no cast operator and no array literal. Both columns are TEXT holding JSON now, so the values
  // go in as the JSON strings they store. And `id` is named explicitly, because `sales.id` is
  // `$defaultFn(newId)` — a JavaScript generator rather than a SQL DEFAULT, which a raw insert
  // never reaches.
  return sql`insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, working_order_id) values (${randomUUID()}, ${TILL_A1}, ${nodeA}, ${seriesA}, ${opts.invoiceNumber}, ${AT}, 120,
      100, '[]', 'es', '["es","ca"]', 'verifactu', 'recorded', ${opts.workingOrderId}
    )`;
}

// `id` is supplied here for the reason {@link insertSaleSql} records: it is a `$defaultFn`
// generator on this engine, so a raw insert that omits it is refused
// `NOT NULL constraint failed: working_orders.id` — which is what took both of the first two cases
// down before this change (measured on this suite).
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
      sql`insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${randomUUID()}, ${wo}, 1, ${productA}, 'Café solo', ${DESCRIPTIONS_A},
         1000, 100, 110, 1000, 100)`,
    );
    // ... and it is stored at the scale the insert meant: a quantity counts whole thousandths
    // and a rate whole basis points, so a `1` and a `10` here are accepted and mean a thousandth
    // of a unit at a hundredth of a percent. Read as text so the assertion does not turn on how
    // the driver renders each of the two integer widths — `cast(x as text)` for the `x::text` this
    // was written as, because SQLite has no cast OPERATOR but does have the standard cast
    // EXPRESSION. The `::jsonb` casts on the two inserts above are simply gone: `descriptions` is
    // TEXT holding JSON and `DESCRIPTIONS_A` is already the JSON string it stores.
    const stored = await suite.db.execute<{ quantity: string; vat_rate: string }>(
      sql`select cast(quantity as text) as quantity, cast(vat_rate as text) as vat_rate
            from working_order_lines where working_order_id = ${wo} and line_no = 1`,
    );
    expect(stored.rows).toEqual([{ quantity: "1000", vat_rate: "1000" }]);
    // Negative: a product_id with no products row is refused 23503. The BEFORE triggers
    // (require_open_parent, check_locales) pass first — open parent, matching locales — so the row
    // reaches the (product_id) → products FK, which is what rejects it.
    const error = await captureError(() =>
      suite.db.execute(
        sql`insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total) values (${randomUUID()}, ${wo}, 2, ${BOGUS_PRODUCT}, 'Café solo', ${DESCRIPTIONS_A},
           1000, 100, 110, 1000, 100)`,
      ),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("points a draft line's product_id at the products primary key", async () => {
    // Read the foreign key's shape directly rather than trusting that its mere existence implies
    // it.
    //
    // WHAT THIS CASE LOST. It used to read `pg_get_constraintdef(oid)` out of `pg_constraint`,
    // selecting the row BY CONSTRAINT NAME (`working_order_lines_product_fk`) and comparing the
    // rendered definition string. None of that exists here: `pg_constraint` is not a table on this
    // engine, and the statement was refused before that even mattered — `unrecognized token: ":"`,
    // from the `::regclass` cast (node v26.7.0, `node:sqlite`).
    //
    // `pragma_foreign_key_list` is the replacement. It reports the referencing column, the
    // referenced table and column, and the delete action — every part of the definition string
    // this case compared — but it does NOT report a constraint NAME, because a SQLite foreign key
    // has none: drizzle's generator emits a bare `FOREIGN KEY (…) REFERENCES …(…)` clause, which
    // is what `sqlite_master` holds for this table. So the name pin is gone and the shape pin
    // stays, and the read is now filtered by the referencing column instead.
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

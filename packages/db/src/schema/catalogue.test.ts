// WHAT THE COLUMN-SHAPE CASES BELOW LOST, because every loss is something that used to be checked
// and now cannot be.
//
// They read PostgreSQL's `information_schema.columns`, which does not exist on this engine — run
// as written, each one dies with `no such table: information_schema.columns` (measured on this
// suite, node v26.7.0). The replacement is `pragma_table_info`, following
// `packages/payments/src/migrations.test.ts`, and one fact did not survive the move: the column
// TYPE no longer separates a `jsonb` column from a plain `text` one. Dumped from this package's
// own migrated database, `pragma_table_info('products')` gives `type` `TEXT` for `name`,
// `customer_name`, `allergens`, `image` and all three `diet*` columns alike, and the statement
// `sqlite_master` holds for the table declares every one of them `text` too — so neither the
// catalogue nor the DDL text can tell them apart. `packages/db/src/schema/columns.ts` says the
// same thing from the other end: a json column is `text(name, { mode: "json" })`.
//
// So `data_type: "jsonb"` and `data_type: "text"` are gone from the assertions below. What is
// still checked, and what still fails if it breaks: that the column EXISTS, that it is nullable or
// NOT NULL (`pragma_table_info`'s `notnull`, 1 or 0, replacing `is_nullable`'s 'NO'/'YES'), and —
// in the `descriptions` case — that a column is ABSENT.
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { catalogues } from "./catalogue.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

// Each case gets empty mutable fixture tables while sharing the migrated database.
afterEach(async () => {
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from catalogues`);
  await suite.db.execute(sql`delete from tenants`);
});

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/**
 * One row of `pragma_table_info`, the two columns these cases read. `notnull` is 1 for a NOT NULL
 * column and 0 otherwise. A `type` rather than an `interface` so it satisfies `db.execute`'s
 * `Record<string, unknown>` row constraint, as `packages/payments/src/migrations.test.ts` does.
 */
type ColumnRow = { name: string; notnull: number };

/** `pragma_table_info` for `table`, the replacement for a scan of `information_schema.columns`. */
async function columnsOf(db: Database, table: string): Promise<ColumnRow[]> {
  return rows<ColumnRow>(db, sql`select name, "notnull" from pragma_table_info(${table})`);
}

describe("catalogue — menu, taxonomy and priced items", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("rejects a bad pricing_unit and a bad vat_class, each on its own CHECK", async () => {
    // Seed the real FK parent FIRST so the two INSERTs below reach the CHECK constraints instead of
    // tripping products' catalogue_id foreign key. The previous version of this test inserted
    // gen_random_uuid() for the key, so it threw 23503 (FK violation) whether or not the CHECKs
    // existed — and it never exercised an invalid vat_class at all. (F1, whole-branch review.)
    const [catalogue] = await db
      .insert(catalogues)
      .values({ name: "Deli" })
      .returning({ id: catalogues.id });

    // Bad pricing_unit, VALID vat_class → only products_pricing_unit_ck can fire.
    const pricingError = await captureError(() =>
      db.execute(
        sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class) values (${catalogue.id}, 'Fixture', 'bogus', 100, 'general')`,
      ),
    );
    expect(pgErrorCode(pricingError)).toBe("23514");
    expect(pgErrorMessage(pricingError)).toMatch(/products_pricing_unit_ck/);

    // Bad vat_class, VALID pricing_unit → only products_vat_class_ck can fire.
    const vatError = await captureError(() =>
      db.execute(
        sql`insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class) values (${catalogue.id}, 'Fixture', 'each', 100, 'bogus')`,
      ),
    );
    expect(pgErrorCode(vatError)).toBe("23514");
    expect(pgErrorMessage(vatError)).toMatch(/products_vat_class_ck/);
  });

  it("has a snapshot category column on both line tables and catalogue_id on locations", async () => {
    // `pragma_table_info` takes ONE table, so the single cross-table scan becomes three reads and
    // the "three rows came back" count becomes three named presence checks — which says more, not
    // less: the old count of 3 would also have been satisfied by the wrong three rows.
    const present = async (table: string, column: string) =>
      (await columnsOf(db, table)).some((c) => c.name === column);
    expect(await present("sale_lines", "category")).toBe(true);
    expect(await present("working_order_lines", "category")).toBe(true);
    expect(await present("locations", "catalogue_id")).toBe(true);
  });

  it("products carries a plain-text name and a nullable customer_name jsonb, and no descriptions", async () => {
    const cols = (await columnsOf(db, "products"))
      .filter((c) => ["name", "customer_name", "descriptions"].includes(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    // A two-entry list, so `descriptions` being ABSENT is still what the assertion turns on — the
    // half of this case that the type loss does not touch.
    expect(cols).toEqual([
      { name: "customer_name", notnull: 0 },
      { name: "name", notnull: 1 },
    ]);
  });

  it("products carries a nullable allergens jsonb column", async () => {
    const col = (await columnsOf(db, "products")).find((c) => c.name === "allergens");
    expect(col).toEqual({ name: "allergens", notnull: 0 });
  });

  it("products carries the three nullable diet jsonb columns", async () => {
    const cols = (await columnsOf(db, "products"))
      .filter((c) => ["diet_derivation", "diet_override", "diet"].includes(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(cols).toEqual([
      { name: "diet", notnull: 0 },
      { name: "diet_derivation", notnull: 0 },
      { name: "diet_override", notnull: 0 },
    ]);
  });

  it("products carries a nullable image text column", async () => {
    // The image column is a path REFERENCE (a content-addressed filename), never bytes — nullable
    // because a product legitimately has no photo (distinct from allergens' null, which is a
    // PENDING state that the code reads; image null just means "no picture").
    const col = (await columnsOf(db, "products")).find((c) => c.name === "image");
    expect(col).toEqual({ name: "image", notnull: 0 });
  });
});

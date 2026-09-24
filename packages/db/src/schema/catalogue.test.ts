// What the column-shape cases do NOT check: a column's type. On this engine a json column and a
// plain text one both report `TEXT`, so the cases check only that a column exists, whether it is
// NOT NULL, and, in the `descriptions` case, that a column is absent.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CHECK_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { catalogues } from "./catalogue.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from catalogues`);
  await suite.db.execute(sql`delete from tenants`);
});

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** A `type` rather than an `interface` so it satisfies `db.execute`'s row constraint. */
type ColumnRow = { name: string; notnull: number };

/** In the shape a `ts` column stores, so the raw inserts write a row the write path could have. */
const AT = "2026-07-20T19:20:30.000Z";

async function columnsOf(db: Database, table: string): Promise<ColumnRow[]> {
  return rows<ColumnRow>(db, sql`select name, "notnull" from pragma_table_info(${table})`);
}

describe("catalogue — menu, taxonomy and priced items", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("rejects a bad pricing_unit and a bad vat_class, each on its own CHECK", async () => {
    // A real parent row, so the INSERTs below reach the CHECKs rather than the foreign key.
    const [catalogue] = await db
      .insert(catalogues)
      .values({ name: "Deli" })
      .returning({ id: catalogues.id });

    // `id` and the timestamps are named because their defaults are `$defaultFn` generators a raw
    // insert never reaches; raw SQL because the TypeScript type rejects the values under test.
    const insertProduct = (pricingUnit: string, vatClass: string): ReturnType<typeof sql> =>
      sql`insert into products (id, catalogue_id, name, pricing_unit, unit_price, vat_class, created_at, updated_at) values (${randomUUID()}, ${catalogue.id}, 'Fixture', ${pricingUnit}, 100, ${vatClass}, ${AT}, ${AT})`;

    // Bad pricing_unit, VALID vat_class → only products_pricing_unit_ck can fire.
    const pricingError = await captureError(() => db.execute(insertProduct("bogus", "general")));
    expect(isRefusal(pricingError, CHECK_VIOLATION)).toBe(true);
    // The class alone cannot say WHICH of the two CHECKs fired; the constraint's name can.
    expect(engineErrorMessage(pricingError)).toBe(
      "CHECK constraint failed: products_pricing_unit_ck",
    );

    // Bad vat_class, VALID pricing_unit → only products_vat_class_ck can fire.
    const vatError = await captureError(() => db.execute(insertProduct("each", "bogus")));
    expect(isRefusal(vatError, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(vatError)).toBe("CHECK constraint failed: products_vat_class_ck");

    // The control in the other direction: the same statement with both values valid is accepted, so
    // the two refusals above are the CHECKs biting and not the insert being malformed.
    await db.execute(insertProduct("each", "general"));
  });

  it("has a snapshot category column on both line tables and catalogue_id on locations", async () => {
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
    // A two-entry list, so `descriptions` being ABSENT is what the assertion turns on.
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
    const col = (await columnsOf(db, "products")).find((c) => c.name === "image");
    expect(col).toEqual({ name: "image", notnull: 0 });
  });
});

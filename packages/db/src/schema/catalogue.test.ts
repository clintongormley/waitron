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
    const cols = await rows<{ table_name: string; column_name: string }>(
      db,
      sql`select table_name, column_name from information_schema.columns
          where (table_name in ('sale_lines','working_order_lines') and column_name = 'category')
             or (table_name = 'locations' and column_name = 'catalogue_id')`,
    );
    expect(cols).toHaveLength(3);
  });

  it("products carries a plain-text name and a nullable customer_name jsonb, and no descriptions", async () => {
    const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      db,
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'products'
            and column_name in ('name','customer_name','descriptions')
          order by column_name`,
    );
    expect(cols).toEqual([
      { column_name: "customer_name", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "name", data_type: "text", is_nullable: "NO" },
    ]);
  });

  it("products carries a nullable allergens jsonb column", async () => {
    const [col] = await rows<{ data_type: string; is_nullable: string }>(
      db,
      sql`select data_type, is_nullable from information_schema.columns
          where table_name = 'products' and column_name = 'allergens'`,
    );
    expect(col).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
  });

  it("products carries the three nullable diet jsonb columns", async () => {
    const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      db,
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'products'
            and column_name in ('diet_derivation','diet_override','diet')
          order by column_name`,
    );
    expect(cols).toEqual([
      { column_name: "diet", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "diet_derivation", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "diet_override", data_type: "jsonb", is_nullable: "YES" },
    ]);
  });

  it("products carries a nullable image text column", async () => {
    // The image column is a path REFERENCE (a content-addressed filename), never bytes — nullable
    // because a product legitimately has no photo (distinct from allergens' null, which is a
    // PENDING state that the code reads; image null just means "no picture").
    const [col] = await rows<{ data_type: string; is_nullable: string }>(
      db,
      sql`select data_type, is_nullable from information_schema.columns
          where table_name = 'products' and column_name = 'image'`,
    );
    expect(col).toMatchObject({ data_type: "text", is_nullable: "YES" });
  });
});

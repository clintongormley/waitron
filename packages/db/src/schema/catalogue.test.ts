import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { catalogues } from "./catalogue.js";
import { tenants } from "./tenants.js";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

describeEachTarget("catalogue — menu, taxonomy and priced items", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("forces RLS on the three catalogue tables", async () => {
    const out = await rows<{ relname: string; relforcerowsecurity: boolean }>(
      db,
      sql`select relname, relforcerowsecurity from pg_class
          where relname in ('catalogues','categories','products') order by relname`,
    );
    expect(out.map((r) => r.relname)).toEqual(["catalogues", "categories", "products"]);
    expect(out.every((r) => r.relforcerowsecurity)).toBe(true);
  });

  it("rejects a bad pricing_unit and a bad vat_class, each on its own CHECK", async () => {
    // Seed real FK parents FIRST so the two INSERTs below reach the CHECK constraints instead of
    // tripping products' tenant_id / catalogue_id foreign keys. The previous version of this test
    // inserted gen_random_uuid() for both keys, so it threw 23503 (FK violation) whether or not the
    // CHECKs existed — and it never exercised an invalid vat_class at all. (F1, whole-branch review.)
    const [tenant] = await db
      .insert(tenants)
      .values({ country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" })
      .returning({ id: tenants.id });
    const [catalogue] = await db
      .insert(catalogues)
      .values({ tenantId: tenant.id, name: "Deli" })
      .returning({ id: catalogues.id });

    // Bad pricing_unit, VALID vat_class → only products_pricing_unit_ck can fire.
    const pricingError = await captureError(() =>
      db.execute(sql`insert into products
        (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${tenant.id}, ${catalogue.id}, '{}', 'bogus', '1.00', 'general')`),
    );
    expect(pgErrorCode(pricingError)).toBe("23514");
    expect(pgErrorMessage(pricingError)).toMatch(/products_pricing_unit_ck/);

    // Bad vat_class, VALID pricing_unit → only products_vat_class_ck can fire.
    const vatError = await captureError(() =>
      db.execute(sql`insert into products
        (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (${tenant.id}, ${catalogue.id}, '{}', 'each', '1.00', 'bogus')`),
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

  it("option_group_items carries the nullable add_origins/remove_origins jsonb columns", async () => {
    const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
      db,
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'option_group_items'
            and column_name in ('add_origins','remove_origins')
          order by column_name`,
    );
    expect(cols).toEqual([
      { column_name: "add_origins", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "remove_origins", data_type: "jsonb", is_nullable: "YES" },
    ]);
  });

  it("products carries a nullable image text column", async () => {
    // The image column is a path REFERENCE (a content-addressed filename), never bytes — nullable
    // because a product legitimately has no photo (distinct from allergens' null, which is a
    // load-bearing PENDING state; image null just means "no picture"). The write/read RLS receipt
    // that the existing grant + policy cover it lives in catalogue.rls.test.ts.
    const [col] = await rows<{ data_type: string; is_nullable: string }>(
      db,
      sql`select data_type, is_nullable from information_schema.columns
          where table_name = 'products' and column_name = 'image'`,
    );
    expect(col).toMatchObject({ data_type: "text", is_nullable: "YES" });
  });
});

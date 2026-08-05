import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { describeEachTarget } from "../testing/harness.js";

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

  it("rejects an invalid pricing_unit / vat_class", async () => {
    await expect(
      db.execute(sql`insert into products
        (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values (gen_random_uuid(), gen_random_uuid(), '{}', 'bogus', '1.00', 'general')`),
    ).rejects.toThrow();
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
});

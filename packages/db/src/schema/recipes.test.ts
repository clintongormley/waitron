import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "../migrations.js";
import { usePgliteDb } from "../testing/lifecycle.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

describe("recipes schema", () => {
  it("creates the ingredients and recipe_lines tables and the products overlay columns", async () => {
    const tables = await fx.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_name in ('ingredients','recipe_lines') order by table_name`);
    expect(tables.rows.map((r) => r.table_name)).toEqual(["ingredients", "recipe_lines"]);

    const cols = await fx.db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_name = 'products' and column_name in ('manual_allergens','recipe_derivation')
      order by column_name`);
    expect(cols.rows.map((r) => r.column_name)).toEqual(["manual_allergens", "recipe_derivation"]);
  });
});

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

  it("ingredients carries a nullable dietary_origin enum column", async () => {
    const cols = await fx.db.execute<{
      column_name: string;
      is_nullable: string;
      udt_name: string;
    }>(sql`
      select column_name, is_nullable, udt_name
      from information_schema.columns
      where table_name = 'ingredients' and column_name = 'dietary_origin'`);
    expect(cols.rows).toEqual([
      { column_name: "dietary_origin", is_nullable: "YES", udt_name: "dietary_origin" },
    ]);
  });

  it("indexes recipe_lines.ingredient_id so productsUsingIngredient avoids a sequential scan", async () => {
    const indexes = await fx.db.execute<{ indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'recipe_lines' order by indexname`);
    expect(indexes.rows.map((r) => r.indexname)).toContain("recipe_lines_ingredient_id_idx");
  });
});

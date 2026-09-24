import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("recipes schema", () => {
  it("creates the ingredients and recipe_lines tables and the products overlay columns", async () => {
    const tables = await fx.db.execute<{ name: string }>(sql`
      select name from sqlite_master
      where type = 'table' and name in ('ingredients','recipe_lines') order by name`);
    expect(tables.rows.map((r) => r.name)).toEqual(["ingredients", "recipe_lines"]);

    const cols = await fx.db.execute<{ name: string }>(sql`
      select name from pragma_table_info('products')
      where name in ('manual_allergens','recipe_derivation') order by name`);
    expect(cols.rows.map((r) => r.name)).toEqual(["manual_allergens", "recipe_derivation"]);
  });

  it("ingredients carries a nullable dietary_origin enum column", async () => {
    // The vocabulary is a named CHECK, read here as DDL text — weaker than it looks: a constraint
    // name inside a comment in the same statement would satisfy it too.
    const cols = await fx.db.execute<{ name: string; type: string; notnull: number }>(sql`
      select name, lower(type) as type, "notnull" from pragma_table_info('ingredients')
      where name = 'dietary_origin'`);
    expect(cols.rows).toEqual([{ name: "dietary_origin", type: "text", notnull: 0 }]);

    const ddl = await fx.db.execute<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'table' and name = 'ingredients'`,
    );
    expect(ddl.rows[0]!.sql).toContain('CONSTRAINT "ingredients_dietary_origin_ck"');
  });

  it("indexes recipe_lines.ingredient_id so productsUsingIngredient avoids a sequential scan", async () => {
    const indexes = await fx.db.execute<{ name: string }>(sql`
      select name from pragma_index_list('recipe_lines') order by name`);
    expect(indexes.rows.map((r) => r.name)).toContain("recipe_lines_ingredient_id_idx");
  });
});

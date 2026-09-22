import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("recipes schema", () => {
  it("creates the ingredients and recipe_lines tables and the products overlay columns", async () => {
    // `information_schema.tables` and `information_schema.columns` do not exist on this engine —
    // run as written these statements died with `no such table: information_schema.tables` and
    // `no such table: information_schema.columns` (measured on this suite). `sqlite_master` and
    // `pragma_table_info` are the replacements, following
    // `packages/payments/src/migrations.test.ts`. Both report the same NAMES, so neither assertion
    // below changes. `sqlite_master` holds indexes, triggers and views as well as tables, which is
    // why the read asks for `type = 'table'`.
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
    // WHERE THE THIRD ASSERTION WENT. This case used to read three things out of
    // `information_schema.columns` — the column's name, its nullability, and `udt_name`, which on
    // PostgreSQL was the name of the ENUM TYPE the column was declared as. There is no enum type
    // on this engine: drizzle's SQLite generator emits the vocabulary as a named CHECK constraint
    // instead, so the column reads as plain `text` in `pragma_table_info` and `udt_name` has no
    // counterpart there at all.
    //
    // So the third assertion moves to the constraint, following the `acceptedPaymentStates` idiom
    // in `packages/payments/src/migrations.test.ts`: read the table's own statement back out of
    // `sqlite_master` and look for the named CHECK. Dumped from this package's migrated database,
    // that statement carries
    // `CONSTRAINT "ingredients_dietary_origin_ck" CHECK("ingredients"."dietary_origin" in (…))`.
    // Reading DDL text is weaker than reading a catalogue table — a constraint name that appeared
    // inside a comment in the same statement would satisfy this too.
    // `lower(type)`, because the pragma answers `TEXT` in upper case while the `CREATE TABLE`
    // statement `sqlite_master` holds spells the same column `text`. Measured on this package's
    // migrated database: `pragma_table_info('ingredients')` gives `type` `TEXT` for this column,
    // and so does `pragma_table_info('products')` for `allergens`. Lower-casing here keeps the
    // assertion about the storage class rather than about which case the pragma prints.
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
    // `pg_indexes` does not exist on this engine — run as written this statement died with
    // `no such table: pg_indexes`. `pragma_index_list` is the replacement, and it reports the
    // index under the same NAME the migration created it under, so the assertion is unchanged.
    const indexes = await fx.db.execute<{ name: string }>(sql`
      select name from pragma_index_list('recipe_lines') order by name`);
    expect(indexes.rows.map((r) => r.name)).toContain("recipe_lines_ingredient_id_idx");
  });
});

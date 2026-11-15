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
import { menus } from "./menus.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from menus`);
  await suite.db.execute(sql`delete from taxpayer`);
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

it("a second default menu is refused, while two non-default menus are allowed", async () => {
  const insert = (id: string, isDefault: number) =>
    suite.db.run(sql`
    insert into menus (id, name, is_default, created_at, updated_at)
    values (${id}, ${id}, ${isDefault}, ${AT}, ${AT})`);
  await insert("house", 1);
  await insert("day", 0);
  await insert("evening", 0);
  const error = await captureError(() => insert("duplicate", 1));
  expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  expect(engineErrorMessage(error)).toBe("UNIQUE constraint failed: menus.is_default");
  expect(suite.db.all(sql`select id, is_default from menus order by id`)).toEqual([
    { id: "day", is_default: 0 },
    { id: "evening", is_default: 0 },
    { id: "house", is_default: 1 },
  ]);
});

describe("menu — menu, taxonomy and priced items", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
  });

  it("products and categories carry no station of their own", async () => {
    expect((await columnsOf(db, "products")).map((c) => c.name)).not.toContain("station_id");
    expect((await columnsOf(db, "categories")).map((c) => c.name)).not.toContain("station_id");
  });

  it("rejects a bad vat_class on its own CHECK", async () => {
    const [menu] = await db.insert(menus).values({ name: "Deli" }).returning({ id: menus.id });
    const insertProduct = (vatClass: string): ReturnType<typeof sql> =>
      sql`insert into products (id, name, unit_price, vat_class, created_at, updated_at) values (${randomUUID()}, 'Fixture', 100, ${vatClass}, ${AT}, ${AT})`;
    const vatError = await captureError(() => db.execute(insertProduct("bogus")));
    expect(isRefusal(vatError, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(vatError)).toBe("CHECK constraint failed: products_vat_class_ck");
    await db.execute(insertProduct("general"));
  });

  it("rejects a bad takeaway_vat_class on its own CHECK, and accepts a valid or blank one", async () => {
    const [menu] = await db.insert(menus).values({ name: "Deli" }).returning({ id: menus.id });
    const insertProduct = (takeawayVatClass: string | null): ReturnType<typeof sql> =>
      sql`insert into products (id, menu_id, name, unit_price, vat_class, takeaway_vat_class, created_at, updated_at) values (${randomUUID()}, ${menu.id}, 'Fixture', 100, 'reduced', ${takeawayVatClass}, ${AT}, ${AT})`;

    const error = await captureError(() => db.execute(insertProduct("nope")));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe(
      "CHECK constraint failed: products_takeaway_vat_class_ck",
    );

    await db.execute(insertProduct("general"));
    // Not part of `products_top_level_owns_ck`: a product with no parent may leave it blank.
    await db.execute(insertProduct(null));
  });

  it("has a snapshot category column on both line tables", async () => {
    const present = async (table: string, column: string) =>
      (await columnsOf(db, table)).some((c) => c.name === column);
    expect(await present("sale_lines", "category")).toBe(true);
    expect(await present("working_order_lines", "category")).toBe(true);
  });

  it("products carries a plain-text name and a nullable customer_name, and no descriptions", async () => {
    const cols = (await columnsOf(db, "products"))
      .filter((c) => ["name", "customer_name", "descriptions"].includes(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    // A two-entry list, so `descriptions` being ABSENT is what the assertion turns on.
    expect(cols).toEqual([
      { name: "customer_name", notnull: 0 },
      { name: "name", notnull: 1 },
    ]);
  });

  it("products carries a nullable allergens column", async () => {
    const col = (await columnsOf(db, "products")).find((c) => c.name === "allergens");
    expect(col).toEqual({ name: "allergens", notnull: 0 });
  });

  it("products carries the two nullable diet columns", async () => {
    const cols = (await columnsOf(db, "products"))
      .filter((c) => ["diet_override", "diet"].includes(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(cols).toEqual([
      { name: "diet", notnull: 0 },
      { name: "diet_override", notnull: 0 },
    ]);
  });

  it("products carries a nullable image text column", async () => {
    const col = (await columnsOf(db, "products")).find((c) => c.name === "image");
    expect(col).toEqual({ name: "image", notnull: 0 });
  });
});

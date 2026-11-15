// What the column-shape cases do NOT check: a column's type. On this engine a json column and a
// plain text one both report `TEXT`, so the cases check only that a column exists, whether it is
// NOT NULL, and, in the `descriptions` case, that a column is absent.
import { HOME_COLUMN_RANGE } from "@waitron/shared";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { checkFailed } from "../constraint-target.js";
import { CHECK_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`delete from products`);
  await suite.db.execute(sql`delete from sections`);

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
    const insertProduct = (vatClass: string): ReturnType<typeof sql> =>
      sql`insert into products (id, name, unit_price, vat_class, created_at, updated_at) values (${randomUUID()}, 'Fixture', 100, ${vatClass}, ${AT}, ${AT})`;
    const vatError = await captureError(() => db.execute(insertProduct("bogus")));
    expect(isRefusal(vatError, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(vatError)).toBe("CHECK constraint failed: products_vat_class_ck");
    await db.execute(insertProduct("general"));
  });

  it("rejects a bad takeaway_vat_class on its own CHECK, and accepts a valid or blank one", async () => {
    const insertProduct = (takeawayVatClass: string | null): ReturnType<typeof sql> =>
      sql`insert into products (id, name, unit_price, vat_class, takeaway_vat_class, created_at, updated_at) values (${randomUUID()}, 'Fixture', 100, 'reduced', ${takeawayVatClass}, ${AT}, ${AT})`;

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

  it("products carries only the nullable diet override", async () => {
    const cols = (await columnsOf(db, "products"))
      .filter((c) => ["diet_override", "diet"].includes(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(cols).toEqual([{ name: "diet_override", notnull: 0 }]);
  });

  it("products carries a nullable image text column", async () => {
    const col = (await columnsOf(db, "products")).find((c) => c.name === "image");
    expect(col).toEqual({ name: "image", notnull: 0 });
  });
});

describe("product declared checks", () => {
  const insert = (id: string, name = "Tea", price = 100, ordering = "public") =>
    suite.db.run(
      sql`insert into products (id, name, unit_price, vat_class, ordering, created_at, updated_at) values (${id}, ${name}, ${price}, 'general', ${ordering}, ${AT}, ${AT})`,
    );
  it("refuses an ordering outside the three on insert, replace and update", async () => {
    for (const ordering of ["public", "staff_only", "not_sold_separately"]) {
      await insert(ordering, "Tea", 100, ordering);
      await suite.db.run(sql`update products set ordering = ${ordering} where id = 'public'`);
    }
    for (const ordering of ["secret", "Public"]) {
      expect(
        checkFailed(
          await captureError(() => insert("bad", "Tea", 100, ordering)),
          "products_ordering_ck",
        ),
      ).toBe(true);
      expect(
        checkFailed(
          await captureError(() =>
            suite.db.run(sql`update products set ordering = ${ordering} where id = 'public'`),
          ),
          "products_ordering_ck",
        ),
      ).toBe(true);
    }
    expect(
      checkFailed(
        await captureError(() =>
          suite.db.run(
            sql`insert or replace into products (id,name,unit_price,vat_class,ordering,created_at,updated_at) values ('public','Tea',100,'general','secret',${AT},${AT})`,
          ),
        ),
        "products_ordering_ck",
      ),
    ).toBe(true);
    expect(suite.db.get(sql`select ordering from products where id = 'public'`)).toEqual({
      ordering: "not_sold_separately",
    });
    await suite.db.run(
      sql`insert into products (id,name,unit_price,vat_class,created_at,updated_at) values ('default','Tea',100,'general',${AT},${AT})`,
    );
    expect(suite.db.get(sql`select ordering from products where id = 'default'`)).toEqual({
      ordering: "public",
    });
  });
  it("refuses a negative price on insert and update, allows zero and variant inheritance", async () => {
    await insert("parent", "Tea", 0);
    expect(
      checkFailed(await captureError(() => insert("bad", "Tea", -1)), "products_unit_price_ck"),
    ).toBe(true);
    expect(
      checkFailed(
        await captureError(() =>
          suite.db.run(sql`update products set unit_price = -1 where id = 'parent'`),
        ),
        "products_unit_price_ck",
      ),
    ).toBe(true);
    await suite.db.run(
      sql`insert into products (id,parent_id,name,unit_price,created_at,updated_at) values ('variant','parent','Small',null,${AT},${AT})`,
    );
    expect(suite.db.all(sql`select id,unit_price from products order by id`)).toEqual([
      { id: "parent", unit_price: 0 },
      { id: "variant", unit_price: null },
    ]);
    await suite.db.run(sql`delete from products where id = 'variant'`);
  });
  it("refuses a blank name on insert and update", async () => {
    await insert("valid");
    for (const name of ["", "   "]) {
      expect(checkFailed(await captureError(() => insert("bad", name)), "products_name_ck")).toBe(
        true,
      );
      expect(
        checkFailed(
          await captureError(() =>
            suite.db.run(sql`update products set name = ${name} where id = 'valid'`),
          ),
          "products_name_ck",
        ),
      ).toBe(true);
    }
    expect(suite.db.get(sql`select name from products where id = 'valid'`)).toEqual({
      name: "Tea",
    });
  });
  it("a lookup of products by photo uses products_image_idx", async () => {
    const query = sql`explain query plan select 1 from products where image = 'unused.webp'`;
    const details = () =>
      suite.db
        .all<{ detail: string }>(query)
        .map((row) => row.detail)
        .join(" ");
    expect(details()).toMatch(/USING (?:COVERING )?INDEX products_image_idx/);
    await suite.db.run(sql`drop index products_image_idx`);
    expect(details()).toContain("SCAN products");
    await suite.db.run(
      sql`create index products_image_idx on products(image) where image is not null`,
    );
  });
});

describe("menu display and root checks", () => {
  const insertMenu = (id: string) =>
    suite.db.run(
      sql`insert into menus(id,name,created_at,updated_at) values (${id},${id},${AT},${AT})`,
    );
  it.each([
    ["handheld_columns", 4, [2, 3]],
    ["till_columns", 3, [4, 10]],
    ["till_columns", 11, [4, 10]],
    ["handheld_tiles", "unknown", ["colours", "thumbnails"]],
    ["till_tiles", "unknown", ["colours", "thumbnails"]],
    ["handheld_order", "unknown", ["home_first", "menu_first"]],
    ["till_order", "unknown", ["home_first", "menu_first"]],
  ] as const)(
    "refuses invalid %s %s and accepts its bounds or enum values",
    async (column, bad, good) => {
      await insertMenu("display");
      const update = (value: string | number) =>
        suite.db.run(
          sql`update menus set ${sql.identifier(column)} = ${value} where id = 'display'`,
        );
      expect(checkFailed(await captureError(() => update(bad)), `menus_${column}_ck`)).toBe(true);
      for (const value of good) {
        await update(value);
        expect(
          suite.db.get(
            sql`select ${sql.identifier(column)} as value from menus where id = 'display'`,
          ),
        ).toEqual({ value });
      }
    },
  );
  it("pins the column ranges to HOME_COLUMN_RANGE", () => {
    const row = suite.db.get<{ sql: string }>(
      sql`select sql from sqlite_master where name = 'menus'`,
    )!;
    for (const device of ["handheld", "till"] as const) {
      const bounds = row.sql.match(new RegExp(`${device}_columns" between (\\d+) and (\\d+)`));
      expect(bounds?.slice(1).map(Number)).toEqual([
        HOME_COLUMN_RANGE[device].min,
        HOME_COLUMN_RANGE[device].max,
      ]);
    }
  });
  it.each(["menu_root", "home_layout"] as const)(
    "refuses a second %s for one menu, but allows sections",
    async (role) => {
      await insertMenu("roots");
      const insert = (id: string, role: string) =>
        suite.db.run(
          sql`insert into sections(id,internal_name,role,owner_menu_id) values (${id},${id},${role},'roots')`,
        );
      await insert("first", role);
      const error = await captureError(() => insert("second", role));
      expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toBe(
        "UNIQUE constraint failed: sections.owner_menu_id, sections.role",
      );
      await insert("folder-1", "section");
      await insert("folder-2", "section");
      expect(suite.db.all(sql`select id from sections where role = 'section' order by id`)).toEqual(
        [{ id: "folder-1" }, { id: "folder-2" }],
      );
    },
  );
  it("refuses deleting a category that has a subcategory, while a leaf deletes", async () => {
    await suite.db.run(
      sql`insert into categories(id,name,created_at,updated_at) values ('parent','Food',${AT},${AT})`,
    );
    await suite.db.run(
      sql`insert into categories(id,name,parent_id,created_at,updated_at) values ('child','Starters','parent',${AT},${AT})`,
    );
    const error = await captureError(() =>
      suite.db.run(sql`delete from categories where id = 'parent'`),
    );
    expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
    await suite.db.run(sql`delete from categories where id = 'child'`);
    await suite.db.run(sql`delete from categories where id = 'parent'`);
    expect(suite.db.all(sql`select id from categories`)).toEqual([]);
  });
});

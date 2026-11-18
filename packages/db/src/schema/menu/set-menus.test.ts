import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  kitchenCourses,
  menuItems,
  menus,
  products,
} from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function insertMenu(
  kind: string,
  price: number | null,
  vatClass: string | null,
  isDefault = 0,
) {
  return suite.db.execute(sql`
    insert into menus (id, name, kind, set_price, set_vat_class, is_default, created_at, updated_at)
    values ('lunch', 'Lunch', ${kind}, ${price}, ${vatClass}, ${isDefault},
            '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z')
  `);
}

async function insertLine(count: number, id = "line") {
  return suite.db.execute(sql`
    insert into set_menu_lines (id, menu_id, position, count) values (${id}, 'lunch', 0, ${count})
  `);
}

it.each([
  ["set_menu", null, "reduced"],
  ["set_menu", 1400, null],
  ["menu", 1400, null],
  ["menu", null, "reduced"],
])("refuses incomplete or misplaced terms (%s, %s, %s)", async (kind, price, vatClass) => {
  await expect(insertMenu(kind, price, vatClass)).rejects.toThrow("menus_set_terms_ck");
});

it.each([
  ["menu", null, null],
  ["set_menu", 1400, "reduced"],
])("stores complete terms (%s, %s, %s)", async (kind, price, vatClass) => {
  await insertMenu(kind, price, vatClass);
  const { rows } = await suite.db.execute(sql`
    select kind, set_price, set_vat_class from menus where id = 'lunch'
  `);
  expect(rows).toEqual([{ kind, set_price: price, set_vat_class: vatClass }]);
});

it.each([
  ["special", 1400, "reduced", 0, "menus_kind_ck"],
  ["set_menu", -1, "reduced", 0, "menus_set_price_ck"],
  ["set_menu", 1400, "luxury", 0, "menus_set_vat_class_ck"],
  ["set_menu", 1400, "reduced", 1, "menus_set_not_default_ck"],
])(
  "refuses invalid set-menu data (%s, %s, %s, %s)",
  async (kind, price, vatClass, isDefault, check) => {
    await expect(insertMenu(kind, price, vatClass, isDefault)).rejects.toThrow(check);
  },
);

it("a line takes between one and ninety-nine dishes", async () => {
  await insertMenu("set_menu", 1400, "reduced");
  for (const count of [0, 100])
    await expect(insertLine(count)).rejects.toThrow("set_menu_lines_count_ck");
  await insertLine(1, "first");
  await insertLine(99, "last");
  const { rows } = await suite.db.execute(sql`select count from set_menu_lines order by id`);
  expect(rows).toEqual([{ count: 1 }, { count: 99 }]);
});

it("deleting a set menu deletes its lines and their course choices", async () => {
  await insertMenu("set_menu", 1400, "reduced");
  await insertLine(1);
  await suite.db.insert(kitchenCourses).values({ id: "starter", name: "Starters" });
  await suite.db.execute(sql`
    insert into set_menu_line_courses (line_id, course_id) values ('line', 'starter')
  `);
  await suite.db.delete(menus).where(eq(menus.id, "lunch"));
  expect((await suite.db.execute(sql`select * from set_menu_lines`)).rows).toEqual([]);
  expect((await suite.db.execute(sql`select * from set_menu_line_courses`)).rows).toEqual([]);
  expect(await suite.db.select({ id: kitchenCourses.id }).from(kitchenCourses)).toEqual([
    { id: "starter" },
  ]);
});

it("only excludes variants of the offer's product", async () => {
  await insertMenu("set_menu", 1400, "reduced");
  await suite.db.insert(products).values([
    { id: "soup", name: "Soup", vatClass: "reduced", unitPrice: 600 },
    { id: "salad", name: "Salad", vatClass: "reduced", unitPrice: 700 },
  ]);
  await suite.db.insert(products).values([
    { id: "cup", parentId: "soup", name: "Cup" },
    { id: "small", parentId: "salad", name: "Small" },
  ]);
  await suite.db.insert(menuItems).values({ id: "offer", menuId: "lunch", productId: "soup" });
  const exclude = (productId: string, variantId: string) =>
    suite.db.execute(sql`
      insert into set_menu_variant_exclusions (menu_item_id, product_id, variant_id)
      values ('offer', ${productId}, ${variantId})
    `);
  await exclude("soup", "cup");
  for (const productId of ["soup", "salad"]) {
    const error = await captureError(() => exclude(productId, "small"));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  }
  expect(
    (await suite.db.execute(sql`select variant_id from set_menu_variant_exclusions`)).rows,
  ).toEqual([{ variant_id: "cup" }]);
});

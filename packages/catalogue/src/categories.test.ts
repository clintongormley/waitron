import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct, listProducts } from "./operations.js";
import {
  createCategory,
  listCategories,
  readCategory,
  updateCategory,
  deleteCategory,
  setMainReportingCategory,
  listCategoryProducts,
} from "./categories.js";
import { writeContentLanguages, listContentTranslationGaps } from "./content-languages.js";

// Authoring results. The cases with two transactions started together are in
// categories.db.test.ts.
const fx = useCatalogueDb();
const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
  await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] }));
  const food = await app((tx) => createCategory(tx, { name: { en: "Food", fr: "Cuisine" } }));
  const drinks = await app((tx) => createCategory(tx, { name: { en: "Drinks" } }));
  const menu = await app((tx) => createCatalogue(tx, { name: "Lunch" }));
  const product = await app((tx) =>
    createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Toast",
      pricingUnit: "each",
      unitPrice: "2",
      vatClass: "general",
    }),
  );
  return { app, food, drinks, menu, product };
}
describe("category authoring", () => {
  it("keeps translated names, and gives a product a main category with no membership", async () => {
    const { app, food, drinks, product, menu } = await fixture();
    expect(food).toEqual({
      id: food.id,
      name: { en: "Food", fr: "Cuisine" },
      image: null,
      color: null,
      parentId: null,
    });
    expect(await app((tx) => setMainReportingCategory(tx, product.id, food.id))).toEqual({
      primaryCategoryId: food.id,
    });
    // Moving it is a plain replacement: nothing is kept in the category it left.
    await app((tx) => setMainReportingCategory(tx, product.id, drinks.id));
    const [listed] = await app((tx) => listProducts(tx, menu.id));
    expect(listed).toMatchObject({
      id: product.id,
      categoryId: drinks.id,
      primaryCategoryId: drinks.id,
      labelIds: [],
    });
    expect(listed).not.toHaveProperty("categoryIds");
    expect(await app((tx) => listCategoryProducts(tx, food.id))).toEqual([]);
    expect(await app((tx) => listCategoryProducts(tx, drinks.id))).toEqual([
      {
        id: product.id,
        name: product.name,
        active: true,
        primaryCategoryId: drinks.id,
        labelIds: [],
      },
    ]);
    expect(await app((tx) => setMainReportingCategory(tx, product.id, null))).toEqual({
      primaryCategoryId: null,
    });
    expect((await app((tx) => listProducts(tx, menu.id)))[0]!.categoryId).toBeNull();
    // Sorted by id: two rows written in one millisecond tie on `created_at`, and the random id then
    // decides their order (operations.test.ts, "settles a created_at tie").
    expect(byId(await app((tx) => listCategories(tx)))).toEqual(byId([food, drinks]));
  });
  it("refuses an unknown category or product, and leaves the main category as it was", async () => {
    const { app, food, product } = await fixture();
    await app((tx) => setMainReportingCategory(tx, product.id, food.id));
    const missing = crypto.randomUUID();
    await expect(
      app((tx) => setMainReportingCategory(tx, product.id, missing)),
    ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
    await expect(app((tx) => setMainReportingCategory(tx, missing, food.id))).rejects.toMatchObject(
      { code: "product.not_found", params: { productId: missing } },
    );
    expect(await app((tx) => listCategoryProducts(tx, food.id))).toMatchObject([
      { id: product.id, primaryCategoryId: food.id },
    ]);
  });
  it("rejects deep cycles, and a delete moves children and products to the parent by default", async () => {
    const { app, food, drinks, product } = await fixture();
    const child = await app((tx) =>
      createCategory(tx, { name: { en: "Sandwiches" }, parentId: food.id }),
    );
    const leaf = await app((tx) =>
      createCategory(tx, { name: { en: "Toast" }, parentId: child.id }),
    );
    for (const parentId of [food.id, leaf.id])
      await expect(app((tx) => updateCategory(tx, food.id, { parentId }))).rejects.toMatchObject({
        code: "category.parent_cycle",
      });
    // A category below the deleted one takes the deleted one's place in the tree, and so do its
    // products: `child`'s parent is `food`.
    await app((tx) => setMainReportingCategory(tx, product.id, child.id));
    await app((tx) => deleteCategory(tx, child.id));
    expect((await app((tx) => readCategory(tx, leaf.id))).parentId).toBe(food.id);
    expect(await app((tx) => listCategoryProducts(tx, food.id))).toMatchObject([
      { id: product.id, primaryCategoryId: food.id },
    ]);
    // A top-level category's products become Uncategorised and its children top-level.
    await app((tx) => deleteCategory(tx, food.id));
    expect((await app((tx) => readCategory(tx, leaf.id))).parentId).toBeNull();
    const { rows } = await fx.db.execute<{ category_id: string | null }>(
      sql`select category_id from products where id = ${product.id}`,
    );
    expect(rows).toEqual([{ category_id: null }]);
    await app((tx) => deleteCategory(tx, drinks.id));
    expect((await app((tx) => listCategories(tx))).map((c) => c.id)).toEqual([leaf.id]);
  });
  it("rejects a main category naming an unknown category id", async () => {
    const { app, product } = await fixture();
    await expect(
      app((tx) => setMainReportingCategory(tx, product.id, crypto.randomUUID())),
    ).rejects.toMatchObject({ code: "category.not_found" });
  });
  it("validates the default name and includes category gaps without dropping disabled translations", async () => {
    const { app, food, drinks } = await fixture();
    await expect(app((tx) => createCategory(tx, { name: { fr: "Pain" } }))).rejects.toMatchObject({
      code: "content.translation_required",
    });
    expect(await app((tx) => listContentTranslationGaps(tx, "fr"))).toContainEqual({
      kind: "category",
      id: drinks.id,
    });
    await app((tx) => writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en"] }));
    await app((tx) => updateCategory(tx, food.id, { name: { en: "Meals", fr: "Cuisine" } }));
    expect((await app((tx) => readCategory(tx, food.id))).name).toEqual({
      en: "Meals",
      fr: "Cuisine",
    });
  });
});

it("updateProduct's categoryId sets the main category, with no membership coupling", async () => {
  const { updateProduct } = await import("./operations.js");
  const { app, food, drinks, product, menu } = await fixture();
  const second = await app((tx) =>
    createProduct(tx, {
      catalogueId: menu.id,
      categoryId: drinks.id,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    }),
  );
  await app((tx) => updateProduct(tx, product.id, { categoryId: food.id }));
  await app((tx) => updateProduct(tx, product.id, { categoryId: drinks.id }));
  expect(
    byId(
      (await app((tx) => listProducts(tx))).map(({ id, categoryId, primaryCategoryId }) => ({
        id,
        categoryId,
        primaryCategoryId,
      })),
    ),
  ).toEqual(
    byId([
      { id: product.id, categoryId: drinks.id, primaryCategoryId: drinks.id },
      { id: second.id, categoryId: drinks.id, primaryCategoryId: drinks.id },
    ]),
  );
  await app((tx) => updateProduct(tx, product.id, { categoryId: null }));
  expect(await app((tx) => listCategoryProducts(tx, drinks.id))).toMatchObject([{ id: second.id }]);
  await expect(
    app((tx) => updateProduct(tx, product.id, { categoryId: crypto.randomUUID() })),
  ).rejects.toMatchObject({ code: "category.not_found" });
});

it("rejects an image reference with a category error when media is not installed", async () => {
  const { app, food } = await fixture();
  await expect(
    app((tx) =>
      createCategory(tx, {
        name: { en: "New" },
        image: "missing.jpg",
      }),
    ),
  ).rejects.toMatchObject({ code: "category.image_not_found" });
  await expect(
    app((tx) =>
      updateCategory(tx, food.id, {
        image: "missing.jpg",
      }),
    ),
  ).rejects.toMatchObject({ code: "category.image_not_found" });
  expect((await app((tx) => readCategory(tx, food.id))).image).toBeNull();
});

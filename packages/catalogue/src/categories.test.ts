import { describe, expect, it } from "vitest";
import { withTenant, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct, listProducts } from "./operations.js";
import {
  createCategory,
  listCategories,
  readCategory,
  updateCategory,
  deleteCategory,
  replaceProductCategories,
  readProductCategories,
  listCategoryProducts,
} from "./categories.js";
import { writeContentLanguages, listContentTranslationGaps } from "./content-languages.js";

// PGlite covers authoring results; the sibling PostgreSQL suite covers grants and contention.
const fx = useCatalogueDb();
async function fixture() {
  const tenantId = await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db, tenantId);
  const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTenant(fx.db, tenantId, fn);
  await app((tx) =>
    writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en", "fr"] }),
  );
  const food = await app((tx) =>
    createCategory(tx, tenantId, { name: { en: "Food", fr: "Cuisine" } }),
  );
  const drinks = await app((tx) => createCategory(tx, tenantId, { name: { en: "Drinks" } }));
  const menu = await app((tx) => createCatalogue(tx, tenantId, { name: "Lunch" }));
  const product = await app((tx) =>
    createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Toast" },
      pricingUnit: "each",
      unitPrice: "2",
      vatClass: "general",
    }),
  );
  return { tenantId, app, food, drinks, menu, product };
}
describe("category authoring", () => {
  it("keeps translated names, direct membership and one stable product row", async () => {
    const { tenantId, app, food, drinks, product, menu } = await fixture();
    expect(food).toEqual({
      id: food.id,
      name: { en: "Food", fr: "Cuisine" },
      image: null,
      parentId: null,
    });
    await app((tx) =>
      replaceProductCategories(tx, tenantId, product.id, { categoryIds: [food.id] }),
    );
    await app((tx) =>
      replaceProductCategories(tx, tenantId, product.id, { categoryIds: [drinks.id, food.id] }),
    );
    expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
      categoryIds: [drinks.id, food.id].sort(),
      primaryCategoryId: food.id,
    });
    expect((await app((tx) => listProducts(tx, tenantId, menu.id))).map((p) => p.id)).toEqual([
      product.id,
    ]);
    for (const category of [food, drinks])
      expect(await app((tx) => listCategoryProducts(tx, tenantId, category.id))).toEqual([
        {
          id: product.id,
          descriptions: product.descriptions,
          active: true,
          primaryCategoryId: food.id,
          categoryIds: [food.id, drinks.id].sort(),
        },
      ]);
    expect(await app((tx) => listCategories(tx, tenantId))).toEqual([food, drinks]);
  });
  it("requires an explicit replacement primary and rolls back invalid saves", async () => {
    const { tenantId, app, food, drinks, product } = await fixture();
    await app((tx) =>
      replaceProductCategories(tx, tenantId, product.id, {
        categoryIds: [food.id, drinks.id],
        primaryCategoryId: food.id,
      }),
    );
    for (const [input, code] of [
      [{ categoryIds: [drinks.id] }, "category.primary_required"],
      [{ categoryIds: [food.id, food.id] }, "category.membership_invalid"],
      [{ categoryIds: [food.id], primaryCategoryId: drinks.id }, "category.membership_invalid"],
      [{ categoryIds: [food.id], primaryCategoryId: null }, "category.membership_invalid"],
      [{ categoryIds: [], primaryCategoryId: food.id }, "category.membership_invalid"],
      [{ categoryIds: [crypto.randomUUID()], primaryCategoryId: food.id }, "category.not_found"],
    ] as const) {
      await expect(
        app((tx) =>
          replaceProductCategories(tx, tenantId, product.id, {
            ...input,
            categoryIds: [...input.categoryIds],
          }),
        ),
      ).rejects.toMatchObject({ code });
      expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
        categoryIds: [food.id, drinks.id].sort(),
        primaryCategoryId: food.id,
      });
    }
    await app((tx) =>
      replaceProductCategories(tx, tenantId, product.id, {
        categoryIds: [drinks.id],
        primaryCategoryId: drinks.id,
      }),
    );
    await app((tx) => replaceProductCategories(tx, tenantId, product.id, { categoryIds: [] }));
    expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
      categoryIds: [],
      primaryCategoryId: null,
    });
  });
  it("rejects deep cycles and dependencies, without assigning children to parents", async () => {
    const { tenantId, app, food, drinks, product } = await fixture();
    const child = await app((tx) =>
      createCategory(tx, tenantId, { name: { en: "Sandwiches" }, parentId: food.id }),
    );
    const leaf = await app((tx) =>
      createCategory(tx, tenantId, { name: { en: "Toast" }, parentId: child.id }),
    );
    for (const parentId of [food.id, leaf.id])
      await expect(
        app((tx) => updateCategory(tx, tenantId, food.id, { parentId })),
      ).rejects.toMatchObject({ code: "category.parent_cycle" });
    await expect(app((tx) => deleteCategory(tx, tenantId, food.id))).rejects.toMatchObject({
      code: "category.in_use",
      params: { children: 1, products: 0, routes: 0 },
    });
    await app((tx) =>
      replaceProductCategories(tx, tenantId, product.id, { categoryIds: [leaf.id] }),
    );
    expect(await app((tx) => listCategoryProducts(tx, tenantId, food.id))).toEqual([]);
    await expect(app((tx) => deleteCategory(tx, tenantId, leaf.id))).rejects.toMatchObject({
      code: "category.in_use",
    });
    await app((tx) => updateCategory(tx, tenantId, child.id, { parentId: null }));
    await app((tx) => deleteCategory(tx, tenantId, food.id));
    await app((tx) => deleteCategory(tx, tenantId, drinks.id));
    expect((await app((tx) => listCategories(tx, tenantId))).map((c) => c.id)).toEqual([
      child.id,
      leaf.id,
    ]);
  });
  it("scopes reads and rejects foreign parents, products and categories", async () => {
    const { tenantId, app, food, product } = await fixture();
    const other = await seedTenant(fx.db);
    expect(await app((tx) => listCategories(tx, other))).toEqual([]);
    await expect(app((tx) => readCategory(tx, other, food.id))).rejects.toMatchObject({
      code: "category.not_found",
    });
    await expect(
      app((tx) => createCategory(tx, other, { name: { en: "Other" }, parentId: food.id })),
    ).rejects.toMatchObject({ code: "category.not_found" });
    await expect(
      app((tx) => replaceProductCategories(tx, other, product.id, { categoryIds: [food.id] })),
    ).rejects.toMatchObject({ code: "product.not_found" });
    await expect(
      app((tx) =>
        replaceProductCategories(tx, tenantId, product.id, { categoryIds: [crypto.randomUUID()] }),
      ),
    ).rejects.toMatchObject({ code: "category.not_found" });
  });
  it("validates the default name and includes category gaps without dropping disabled translations", async () => {
    const { tenantId, app, food, drinks } = await fixture();
    await expect(
      app((tx) => createCategory(tx, tenantId, { name: { fr: "Pain" } })),
    ).rejects.toMatchObject({ code: "content.translation_required" });
    expect(await app((tx) => listContentTranslationGaps(tx, tenantId, "fr"))).toContainEqual({
      kind: "category",
      id: drinks.id,
    });
    await app((tx) =>
      writeContentLanguages(tx, tenantId, { defaultLanguage: "en", languages: ["en"] }),
    );
    await app((tx) =>
      updateCategory(tx, tenantId, food.id, { name: { en: "Meals", fr: "Cuisine" } }),
    );
    expect((await app((tx) => readCategory(tx, tenantId, food.id))).name).toEqual({
      en: "Meals",
      fr: "Cuisine",
    });
  });
});

it("an old single-category editor cannot silently clear additional memberships", async () => {
  const { updateProduct } = await import("./operations.js");
  const { tenantId, app, food, drinks, product } = await fixture();
  await app((tx) =>
    replaceProductCategories(tx, tenantId, product.id, {
      categoryIds: [food.id, drinks.id],
      primaryCategoryId: food.id,
    }),
  );
  await expect(
    app((tx) => updateProduct(tx, tenantId, product.id, { categoryId: null })),
  ).rejects.toMatchObject({ code: "category.primary_required" });
  expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
    categoryIds: [food.id, drinks.id].sort(),
    primaryCategoryId: food.id,
  });
});

it("returns each product's own membership set when reading the unfiltered library", async () => {
  const { tenantId, app, food, drinks, product, menu } = await fixture();
  const second = await app((tx) =>
    createProduct(tx, tenantId, {
      catalogueId: menu.id,
      categoryId: drinks.id,
      descriptions: { en: "Coffee" },
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    }),
  );
  await app((tx) => replaceProductCategories(tx, tenantId, product.id, { categoryIds: [food.id] }));
  expect(
    (await app((tx) => listProducts(tx, tenantId))).map(
      ({ id, categoryIds, primaryCategoryId }) => ({ id, categoryIds, primaryCategoryId }),
    ),
  ).toEqual([
    { id: product.id, categoryIds: [food.id], primaryCategoryId: food.id },
    { id: second.id, categoryIds: [drinks.id], primaryCategoryId: drinks.id },
  ]);
});

it("rejects an image reference with a category error when media is not installed", async () => {
  const { tenantId, app, food } = await fixture();
  await expect(
    app((tx) =>
      createCategory(tx, tenantId, {
        name: { en: "New" },
        image: "missing.jpg",
      }),
    ),
  ).rejects.toMatchObject({ code: "category.image_not_found" });
  await expect(
    app((tx) =>
      updateCategory(tx, tenantId, food.id, {
        image: "missing.jpg",
      }),
    ),
  ).rejects.toMatchObject({ code: "category.image_not_found" });
  expect((await app((tx) => readCategory(tx, tenantId, food.id))).image).toBeNull();
});

it("the primary selector preserves memberships and clears only the final membership", async () => {
  const { updateProduct } = await import("./operations.js");
  const { tenantId, app, food, drinks, product } = await fixture();
  await app((tx) => updateProduct(tx, tenantId, product.id, { categoryId: food.id }));
  await app((tx) => updateProduct(tx, tenantId, product.id, { categoryId: drinks.id }));
  expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
    categoryIds: [food.id, drinks.id].sort(),
    primaryCategoryId: drinks.id,
  });
  await app((tx) =>
    replaceProductCategories(tx, tenantId, product.id, { categoryIds: [drinks.id] }),
  );
  await app((tx) => updateProduct(tx, tenantId, product.id, { categoryId: null }));
  expect(await app((tx) => readProductCategories(tx, tenantId, product.id))).toEqual({
    categoryIds: [],
    primaryCategoryId: null,
  });
});

import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  readCategory,
  setMainReportingCategory,
} from "./categories.js";
import { createCatalogue, createProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { plantStoredCategory, racePair, seedLegacySellingUnits } from "../test/fixtures.js";

/**
 * Category authoring against a real database, including pairs of transactions started
 * together. `racePair` (`test/fixtures.ts`) carries the mechanism, the measurement and the control.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

async function fixture() {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  const a = await app((tx) => createCategory(tx, { name: "A" }));
  const b = await app((tx) => createCategory(tx, { name: "B" }));
  return { a, b };
}
const race = (
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown>,
) => racePair(suite.db, first, second);
it("serializes opposing reparenting and rejects the second edge", async () => {
  const { a, b } = await fixture();
  const [first, second] = await race(
    (tx) => updateCategory(tx, a.id, { parentId: b.id }),
    (tx) => updateCategory(tx, b.id, { parentId: a.id }),
  );
  expect(first!.status).toBe("fulfilled");
  expect(second).toMatchObject({ status: "rejected", reason: { code: "category.parent_cycle" } });
  expect((await app((tx) => readCategory(tx, b.id))).parentId).toBeNull();
});
it.each(["attach", "delete"] as const)(
  "serializes delete/attach with %s committing first",
  async (winner) => {
    const { a } = await fixture();
    const product = await app(async (tx) => {
      const menu = await createCatalogue(tx, { name: "M" });
      return createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "P",
        pricingUnit: "each",
        unitPrice: "1",
        vatClass: "general",
      });
    });
    const attach = (tx: Transaction) => setMainReportingCategory(tx, product.id, a.id);
    const remove = (tx: Transaction) => deleteCategory(tx, a.id);
    const result = await race(
      winner === "attach" ? attach : remove,
      winner === "attach" ? remove : attach,
    );
    expect(result[0]!.status).toBe("fulfilled");
    if (winner === "attach")
      // The delete serializes behind the attach, then moves the product to A's parent: none.
      expect(result[1]).toMatchObject({ status: "fulfilled" });
    // The attach serializes behind the delete and cannot reference the gone category.
    else
      expect(result[1]).toMatchObject({
        status: "rejected",
        reason: { code: "category.not_found" },
      });
    // Either ordering leaves the product pointing at no deleted category.
    expect(await mainCategoryOf(product.id)).toBeNull();
  },
);

it("stores a category's name as one trimmed string", async () => {
  await seedTenant(suite.db);
  const created = await app((tx) => createCategory(tx, { name: "  Drinks  " }));
  expect(created.name).toBe("Drinks");
  expect((await app((tx) => readCategory(tx, created.id))).name).toBe("Drinks");
  const renamed = await app((tx) => updateCategory(tx, created.id, { name: " Bar " }));
  expect(renamed.name).toBe("Bar");
});
it("a name-only update keeps a nested category's parent", async () => {
  const { a, b } = await fixture();
  await app((tx) => updateCategory(tx, b.id, { parentId: a.id }));
  await app((tx) => updateCategory(tx, b.id, { name: "Beer" }));
  expect(await app((tx) => readCategory(tx, b.id))).toMatchObject({
    name: "Beer",
    parentId: a.id,
  });
});
it("refuses a blank category name", async () => {
  await seedTenant(suite.db);
  await expect(app((tx) => createCategory(tx, { name: "   " }))).rejects.toMatchObject({
    code: "category.invalid",
    params: { field: "name" },
  });
  // A caller outside the route's shape check, handing over something that is not text at all.
  await expect(
    app((tx) => createCategory(tx, { name: { en: "Drinks" } as unknown as string })),
  ).rejects.toMatchObject({ code: "category.invalid", params: { field: "name" } });
  const made = await app((tx) => createCategory(tx, { name: "Kept" }));
  await expect(app((tx) => updateCategory(tx, made.id, { name: "" }))).rejects.toMatchObject({
    code: "category.invalid",
    params: { field: "name" },
  });
  expect((await app((tx) => readCategory(tx, made.id))).name).toBe("Kept");
});
const unpricedVariant = (name: string) => ({
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: null,
  available: true,
});
const seedProduct = (name = "P") =>
  app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Menu" });
    return (
      await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "1",
        vatClass: "general",
      })
    ).id;
  });
/** The `category_id` the product row itself stores: a variant's own, never its parent's. */
async function mainCategoryOf(productId: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ categoryId: products.categoryId })
    .from(products)
    .where(eq(products.id, productId));
  return row!.categoryId;
}
it("a product's main category may be any category, with no membership", async () => {
  const { a, b } = await fixture();
  const productId = await seedProduct();
  const child = await app((tx) => createCategory(tx, { name: "A1", parentId: a.id }));
  for (const categoryId of [child.id, b.id, a.id, null]) {
    expect(await app((tx) => setMainReportingCategory(tx, productId, categoryId))).toEqual({
      primaryCategoryId: categoryId,
    });
    expect(await mainCategoryOf(productId)).toBe(categoryId);
  }
});
it("refuses a variant's id as it refuses an id that names no product", async () => {
  const { a, b } = await fixture();
  const productId = await seedProduct();
  const variantId = await app(async (tx) => {
    await setMainReportingCategory(tx, productId, a.id);
    const [variant] = await setProductVariants(tx, productId, [unpricedVariant("Half")], "en");
    return variant!.id;
  });
  await expect(app((tx) => setMainReportingCategory(tx, variantId, b.id))).rejects.toMatchObject({
    code: "product.not_found",
    params: { productId: variantId },
  });
  expect(await mainCategoryOf(variantId)).toBeNull();
  expect(await mainCategoryOf(productId)).toBe(a.id);
});
it("deleting a category moves its products to its parent, and clears a variant's stored one", async () => {
  const { a, b } = await fixture();
  const child = await app((tx) => createCategory(tx, { name: "A1", parentId: a.id }));
  const product1 = await seedProduct();
  const product2 = await seedProduct("Q");
  const variantId = await app(async (tx) => {
    await setMainReportingCategory(tx, product1, child.id);
    await setMainReportingCategory(tx, product2, b.id);
    const [variant] = await setProductVariants(tx, product2, [unpricedVariant("Half")], "en");
    await plantStoredCategory(tx, variant!.id, child.id);
    return variant!.id;
  });
  await app((tx) => deleteCategory(tx, child.id));
  expect(await mainCategoryOf(product1)).toBe(a.id);
  expect(await mainCategoryOf(variantId)).toBeNull();
  expect(await mainCategoryOf(product2)).toBe(b.id);
  // A top-level category has no parent, so its products become Uncategorised.
  await app((tx) => deleteCategory(tx, a.id));
  expect(await mainCategoryOf(product1)).toBeNull();
  expect(await mainCategoryOf(variantId)).toBeNull();
  expect(await mainCategoryOf(product2)).toBe(b.id);
});
it("deleting a category reparents its children to its parent", async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    const food = await createCategory(tx, { name: "Food" });
    const breakfast = await createCategory(tx, {
      name: "Breakfast",
      parentId: food.id,
    });
    const eggs = await createCategory(tx, {
      name: "Eggs",
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBe(food.id);
  });
});
it("deleting a top-level category makes its children top-level", async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    const breakfast = await createCategory(tx, { name: "Breakfast" });
    const eggs = await createCategory(tx, {
      name: "Eggs",
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBeNull();
  });
});

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
  categoryDependants,
  addProductsToCategory,
  listCategoryProducts,
} from "./categories.js";
import { writeContentLanguages } from "./content-languages.js";
import { createCatalogue, createProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { racePair, seedLegacySellingUnits } from "../test/fixtures.js";

/**
 * Category authoring against a real database, including three pairs of transactions started
 * together. `racePair` (`test/fixtures.ts`) carries the mechanism, the measurement and the control.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

async function fixture() {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  const a = await app((tx) => createCategory(tx, { name: { en: "A" } }));
  const b = await app((tx) => createCategory(tx, { name: { en: "B" } }));
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

it.each(["category", "language"] as const)(
  "serializes a name/hierarchy edit against default-language changes with %s first",
  async (winner) => {
    const { a, b } = await fixture();
    await app(async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] });
      await updateCategory(tx, a.id, { name: { en: "A", fr: "Un" } });
      await updateCategory(tx, b.id, { name: { en: "B", fr: "Deux" } });
    });
    const edit = (tx: Transaction) =>
      updateCategory(tx, a.id, {
        name: { en: "Changed" },
        parentId: b.id,
      });
    const language = (tx: Transaction) =>
      writeContentLanguages(tx, {
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      });
    const result = await race(
      winner === "category" ? edit : language,
      winner === "category" ? language : edit,
    );
    expect(result[0]!.status).toBe("fulfilled");
    expect(result[1]).toMatchObject({
      status: "rejected",
      reason: {
        code: winner === "category" ? "content.default_missing" : "content.translation_required",
      },
    });
    expect(await app((tx) => readCategory(tx, a.id))).toEqual({
      ...a,
      name: winner === "category" ? { en: "Changed" } : { en: "A", fr: "Un" },
      parentId: winner === "category" ? b.id : null,
    });
  },
);
it("stores and validates a category colour", async () => {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  const made = await app((tx) => createCategory(tx, { name: { en: "Hot" }, color: "#b12525" }));
  expect(made.color).toBe("#b12525");
  const cleared = await app((tx) => updateCategory(tx, made.id, { color: null }));
  expect(cleared.color).toBeNull();
  await expect(
    app((tx) => createCategory(tx, { name: { en: "Bad" }, color: "#FFF" })),
  ).rejects.toMatchObject({ code: "category.color_invalid" });
});
const unpricedVariant = (name: string) => ({
  name,
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: null,
  available: true,
});
const seedProduct = () =>
  app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Menu" });
    return (
      await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "P",
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
  const child = await app((tx) => createCategory(tx, { name: { en: "A1" }, parentId: a.id }));
  for (const categoryId of [child.id, b.id, a.id, null]) {
    expect(await app((tx) => setMainReportingCategory(tx, productId, categoryId))).toEqual({
      primaryCategoryId: categoryId,
    });
    expect(await mainCategoryOf(productId)).toBe(categoryId);
  }
});
it("sets a variant's own main category only on the variant scope", async () => {
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
  await app((tx) => setMainReportingCategory(tx, variantId, b.id, "any"));
  expect(await mainCategoryOf(variantId)).toBe(b.id);
  expect(await mainCategoryOf(productId)).toBe(a.id);
});
it("deleting a category moves its products, variants included, to its parent by default", async () => {
  const { a, b } = await fixture();
  const child = await app((tx) => createCategory(tx, { name: { en: "A1" }, parentId: a.id }));
  const product1 = await seedProduct();
  const product2 = await seedProduct();
  const variantId = await app(async (tx) => {
    await setMainReportingCategory(tx, product1, child.id);
    await setMainReportingCategory(tx, product2, b.id);
    const [variant] = await setProductVariants(tx, product2, [unpricedVariant("Half")], "en");
    await setMainReportingCategory(tx, variant!.id, child.id, "any");
    return variant!.id;
  });
  await app((tx) => deleteCategory(tx, child.id));
  expect(await mainCategoryOf(product1)).toBe(a.id);
  expect(await mainCategoryOf(variantId)).toBe(a.id);
  expect(await mainCategoryOf(product2)).toBe(b.id);
  // A top-level category has no parent, so its products become Uncategorised.
  await app((tx) => deleteCategory(tx, a.id));
  expect(await mainCategoryOf(product1)).toBeNull();
  expect(await mainCategoryOf(variantId)).toBeNull();
  expect(await mainCategoryOf(product2)).toBe(b.id);
});
it("deleting a category moves its products and children where the call says", async () => {
  const { a, b } = await fixture();
  const productId = await seedProduct();
  const made = await app(async (tx) => {
    const child = await createCategory(tx, { name: { en: "A1" }, parentId: a.id });
    const grandchild = await createCategory(tx, { name: { en: "A1a" }, parentId: child.id });
    const other = await createCategory(tx, { name: { en: "A2" }, parentId: a.id });
    await setMainReportingCategory(tx, productId, child.id);
    return { child, grandchild, other };
  });
  await app((tx) =>
    deleteCategory(tx, made.child.id, { productsTo: made.other.id, childrenTo: b.id }),
  );
  expect(await mainCategoryOf(productId)).toBe(made.other.id);
  expect((await app((tx) => readCategory(tx, made.grandchild.id))).parentId).toBe(b.id);
  // An explicit null sends products to Uncategorised and children to the top level, though the
  // deleted category has a parent.
  await app((tx) => setMainReportingCategory(tx, productId, made.grandchild.id));
  const leaf = await app((tx) =>
    createCategory(tx, { name: { en: "Leaf" }, parentId: made.grandchild.id }),
  );
  await app((tx) => deleteCategory(tx, made.grandchild.id, { productsTo: null, childrenTo: null }));
  expect(await mainCategoryOf(productId)).toBeNull();
  expect((await app((tx) => readCategory(tx, leaf.id))).parentId).toBeNull();
});
it("refuses a reassignment to the deleted category, below it or to no category, writing nothing", async () => {
  const { a, b } = await fixture();
  const productId = await seedProduct();
  const made = await app(async (tx) => {
    const child = await createCategory(tx, { name: { en: "A1" }, parentId: a.id });
    const grandchild = await createCategory(tx, { name: { en: "A1a" }, parentId: child.id });
    await setMainReportingCategory(tx, productId, a.id);
    return { child, grandchild };
  });
  const missing = crypto.randomUUID();
  for (const [reassign, error] of [
    [{ productsTo: a.id }, { code: "category.reassign_invalid", params: { field: "productsTo" } }],
    [{ childrenTo: a.id }, { code: "category.reassign_invalid", params: { field: "childrenTo" } }],
    [
      { childrenTo: made.child.id },
      { code: "category.reassign_invalid", params: { field: "childrenTo" } },
    ],
    [
      { childrenTo: made.grandchild.id },
      { code: "category.reassign_invalid", params: { field: "childrenTo" } },
    ],
    [{ productsTo: missing }, { code: "category.not_found", params: { categoryId: missing } }],
    [{ childrenTo: missing }, { code: "category.not_found", params: { categoryId: missing } }],
  ] as const) {
    await expect(app((tx) => deleteCategory(tx, a.id, reassign))).rejects.toMatchObject(error);
    expect(await mainCategoryOf(productId)).toBe(a.id);
    expect((await app((tx) => readCategory(tx, made.child.id))).parentId).toBe(a.id);
    expect((await app((tx) => readCategory(tx, a.id))).id).toBe(a.id);
  }
  // A category below the deleted one may still take its PRODUCTS: it survives the delete.
  await app((tx) => deleteCategory(tx, a.id, { productsTo: made.grandchild.id, childrenTo: b.id }));
  expect(await mainCategoryOf(productId)).toBe(made.grandchild.id);
  expect((await app((tx) => readCategory(tx, made.child.id))).parentId).toBe(b.id);
});
it("deleting a category reparents its children to its parent", async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    const food = await createCategory(tx, { name: { en: "Food" } });
    const breakfast = await createCategory(tx, {
      name: { en: "Breakfast" },
      parentId: food.id,
    });
    const eggs = await createCategory(tx, {
      name: { en: "Eggs" },
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBe(food.id);
  });
});
it("deleting a top-level category makes its children top-level", async () => {
  await seedTenant(suite.db);
  await app(async (tx) => {
    const breakfast = await createCategory(tx, { name: { en: "Breakfast" } });
    const eggs = await createCategory(tx, {
      name: { en: "Eggs" },
      parentId: breakfast.id,
    });
    await deleteCategory(tx, breakfast.id);
    expect((await readCategory(tx, eggs.id)).parentId).toBeNull();
  });
});
async function dependantsFixture() {
  await seedTenant(suite.db);
  await seedLegacySellingUnits(suite.db);
  const made = await app(async (tx) => {
    const food = await createCategory(tx, { name: { en: "Food" } });
    const x = await createCategory(tx, { name: { en: "X" }, parentId: food.id });
    const eggs = await createCategory(tx, { name: { en: "Eggs" }, parentId: x.id });
    const menu = await createCatalogue(tx, { name: "M" });
    const p1 = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "P1",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    const p2 = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "P2",
      pricingUnit: "each",
      unitPrice: "1",
      vatClass: "general",
    });
    // p1's main category is X; p2's is Food, the category above X.
    await setMainReportingCategory(tx, p1.id, x.id);
    await setMainReportingCategory(tx, p2.id, food.id);
    return { food, x, eggs, p1, p2 };
  });
  return {
    foodId: made.food.id,
    xId: made.x.id,
    eggsId: made.eggs.id,
    p1Id: made.p1.id,
    p2Id: made.p2.id,
  };
}
it("reports a category's dependants for the delete preview", async () => {
  const { foodId, xId, eggsId, p1Id, p2Id } = await dependantsFixture();
  const deps = await app((tx) => categoryDependants(tx, xId));
  expect(deps.parentId).toBe(foodId);
  expect(deps.children.map((c) => c.id)).toEqual([eggsId]);
  expect(deps.products).toEqual([{ id: p1Id, name: "P1" }]);
  expect((await app((tx) => categoryDependants(tx, foodId))).products).toEqual([
    { id: p2Id, name: "P2" },
  ]);
});
it("lists the products whose main category is a category, or one below it", async () => {
  const { foodId, xId, eggsId, p1Id, p2Id } = await dependantsFixture();
  expect((await app((tx) => listCategoryProducts(tx, foodId))).map((p) => p.id)).toEqual([p2Id]);
  expect(
    (await app((tx) => listCategoryProducts(tx, foodId, { includeDescendants: true }))).map(
      (p) => p.id,
    ),
  ).toEqual([p1Id, p2Id].sort());
  expect(
    await app((tx) => listCategoryProducts(tx, xId, { includeDescendants: true })),
  ).toMatchObject([{ id: p1Id, primaryCategoryId: xId, labelIds: [] }]);
  expect(await app((tx) => listCategoryProducts(tx, eggsId, { includeDescendants: true }))).toEqual(
    [],
  );
});
async function bulkAddFixture() {
  const { a: c, b: d } = await fixture();
  const p1Id = await seedProduct();
  const p2Id = await seedProduct();
  // p2 starts with D as its main category; p1 has none.
  await app((tx) => setMainReportingCategory(tx, p2Id, d.id));
  return { cId: c.id, dId: d.id, p1Id, p2Id };
}
it("bulk-adds products by setting each one's main category, moving it from where it was", async () => {
  const { cId, p1Id, p2Id } = await bulkAddFixture();
  await app((tx) => addProductsToCategory(tx, cId, [p1Id, p2Id]));
  expect(await mainCategoryOf(p1Id)).toBe(cId);
  expect(await mainCategoryOf(p2Id)).toBe(cId);
});
it("a repeated bulk add and an empty list change nothing further", async () => {
  const { cId, p1Id, p2Id } = await bulkAddFixture();
  await app(async (tx) => {
    await addProductsToCategory(tx, cId, [p2Id]);
    await addProductsToCategory(tx, cId, [p2Id]);
    await addProductsToCategory(tx, cId, []);
  });
  expect(await mainCategoryOf(p2Id)).toBe(cId);
  expect(await mainCategoryOf(p1Id)).toBeNull();
});
it("refuses a bulk add whose product ids are not an array", async () => {
  const { cId } = await bulkAddFixture();
  await expect(
    app((tx) =>
      // A request body coerced to a bare string: the type says string[], the wire does not.
      addProductsToCategory(tx, cId, "not-a-list" as unknown as string[]),
    ),
  ).rejects.toMatchObject({ code: "category.membership_invalid" });
});
const badProductIds: [string, (p1Id: string) => Promise<string>][] = [
  ["repeats a product id", (p1Id) => Promise.resolve(p1Id)],
  ["names a malformed product id", () => Promise.resolve("not-a-uuid")],
];
it.each(badProductIds)("refuses a bulk add that %s, applying nothing", async (_what, badId) => {
  const { cId, p1Id } = await bulkAddFixture();
  const bad = await badId(p1Id);
  await expect(app((tx) => addProductsToCategory(tx, cId, [p1Id, bad]))).rejects.toMatchObject({
    code: "category.membership_invalid",
  });
  expect(await mainCategoryOf(p1Id)).toBeNull();
});
it("refuses a bulk add naming a variant, applying nothing", async () => {
  const { cId, p1Id } = await bulkAddFixture();
  const variantId = await app(
    async (tx) => (await setProductVariants(tx, p1Id, [unpricedVariant("Half")], "en"))[0]!.id,
  );
  await expect(
    app((tx) => addProductsToCategory(tx, cId, [p1Id, variantId])),
  ).rejects.toMatchObject({ code: "category.membership_invalid" });
  expect(await mainCategoryOf(p1Id)).toBeNull();
  expect(await mainCategoryOf(variantId)).toBeNull();
});

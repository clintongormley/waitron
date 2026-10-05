import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createCatalogue, createProduct, listProducts, updateProduct } from "./operations.js";
import { readDishFacts } from "./menu-document.js";
import { setProductVariants } from "./variants.js";
import { createCategory } from "./categories.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";

const fx = useCatalogueDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, action);
let catalogueId: string;
let productId: string;
let variantId: string;
beforeEach(async () => {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  ({ catalogueId, productId, variantId } = await app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Menu" });
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Wine",
      pricingUnit: "each",
      unitPrice: "4",
      vatClass: "general",
    });
    const [variant] = await setProductVariants(
      tx,
      product.id,
      [
        {
          name: "Glass",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      "en",
    );
    return { catalogueId: menu.id, productId: product.id, variantId: variant!.id };
  }));
});

const storedColor = async (id: string) =>
  (await fx.db.select({ color: products.color }).from(products).where(eq(products.id, id)))[0]!
    .color;

it("stores a product's own colour, lists it, and clears it", async () => {
  await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
  expect(await storedColor(productId)).toBe("#256bb1");
  const listed = await app((tx) => listProducts(tx, catalogueId));
  expect(listed.find((product) => product.id === productId)).toMatchObject({ color: "#256bb1" });
  await app((tx) => updateProduct(tx, productId, { color: null }));
  expect(await storedColor(productId)).toBeNull();
});

it("answers a variant's id as an id that names no product, and leaves both rows", async () => {
  await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
  await expect(
    app((tx) => updateProduct(tx, variantId, { color: "#b12525" })),
  ).rejects.toMatchObject({
    code: "product.not_found",
    params: { productId: variantId },
  });
  const unknown = crypto.randomUUID();
  await expect(app((tx) => updateProduct(tx, unknown, { color: "#b12525" }))).rejects.toMatchObject(
    {
      code: "product.not_found",
      params: { productId: unknown },
    },
  );
  expect(await storedColor(variantId)).toBeNull();
  expect(await storedColor(productId)).toBe("#256bb1");
});

it("refuses a variant's id with null too, leaving a colour it holds", async () => {
  await fx.db.update(products).set({ color: "#b12525" }).where(eq(products.id, variantId));
  await expect(app((tx) => updateProduct(tx, variantId, { color: null }))).rejects.toMatchObject({
    code: "product.not_found",
    params: { productId: variantId },
  });
  expect(await storedColor(variantId)).toBe("#b12525");
});

it.each(["#B12525", "", "red"])(
  "refuses the colour %j as product.invalid on color, before looking for the product",
  async (color) => {
    await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
    await expect(app((tx) => updateProduct(tx, productId, { color }))).rejects.toMatchObject({
      code: "product.invalid",
      params: { field: "color" },
    });
    await expect(
      app((tx) => updateProduct(tx, crypto.randomUUID(), { color })),
    ).rejects.toMatchObject({ code: "product.invalid", params: { field: "color" } });
    expect(await storedColor(productId)).toBe("#256bb1");
  },
);

it("sets the colour through updateProduct, and leaves it when the patch has none", async () => {
  await app((tx) => updateProduct(tx, productId, { color: "#256bb1" }));
  expect(await storedColor(productId)).toBe("#256bb1");
  await app((tx) => updateProduct(tx, productId, { name: "Red wine" }));
  expect(await storedColor(productId)).toBe("#256bb1");
  await app((tx) => updateProduct(tx, productId, { color: null }));
  expect(await storedColor(productId)).toBeNull();
});

it("reads each product's effective colour, a variant's as its parent's whatever its row holds", async () => {
  const drinks = await app((tx) => createCategory(tx, { name: "Drinks", color: "#256bb1" }));
  await app((tx) => updateProduct(tx, productId, { categoryId: drinks.id }));
  await fx.db.update(products).set({ color: "#b12525" }).where(eq(products.id, variantId));
  const unknown = crypto.randomUUID();
  const readEffectiveColors = async (tx: Transaction, ids: string[]) =>
    new Map([...(await readDishFacts(tx, ids))].map(([id, facts]) => [id, facts.color]));
  expect(await app((tx) => readEffectiveColors(tx, [productId, variantId, unknown]))).toEqual(
    new Map([
      [productId, "#256bb1"],
      [variantId, "#256bb1"],
    ]),
  );
  expect(await app((tx) => readEffectiveColors(tx, []))).toEqual(new Map());
});

it("reads the category tree once and the products once per batch, with no separate colour read", async () => {
  await app(async (tx) => {
    const reads = vi.spyOn(tx, "select");
    try {
      await readDishFacts(tx, [productId, variantId]);
      expect(reads).toHaveBeenCalledTimes(2);
    } finally {
      reads.mockRestore();
    }
  });
});

it("writes a category and a colour in one patch, and ranks a category refusal above a bad colour", async () => {
  const drinks = await app((tx) => createCategory(tx, { name: "Drinks" }));
  await app((tx) => updateProduct(tx, productId, { categoryId: drinks.id, color: "#256bb1" }));
  expect(await storedColor(productId)).toBe("#256bb1");
  expect(
    (await fx.db.select().from(products).where(eq(products.id, productId)))[0]!.categoryId,
  ).toBe(drinks.id);
  const missing = crypto.randomUUID();
  await expect(
    app((tx) => updateProduct(tx, productId, { categoryId: missing, color: "red" })),
  ).rejects.toMatchObject({ code: "category.not_found", params: { categoryId: missing } });
  await expect(
    app((tx) => updateProduct(tx, variantId, { categoryId: drinks.id, color: "red" })),
  ).rejects.toMatchObject({ code: "product.not_found", params: { productId: variantId } });
  await expect(
    app((tx) => updateProduct(tx, productId, { categoryId: null, color: "red" })),
  ).rejects.toMatchObject({ code: "product.invalid", params: { field: "color" } });
  expect(await storedColor(productId)).toBe("#256bb1");
});

it("looks for the product once and writes the row once for a category and a colour", async () => {
  const drinks = await app((tx) => createCategory(tx, { name: "Drinks" }));
  await app(async (tx) => {
    const reads = vi.spyOn(tx, "select");
    const writes = vi.spyOn(tx, "update");
    try {
      await updateProduct(tx, productId, { categoryId: drinks.id, color: "#256bb1" });
      expect([reads.mock.calls.length, writes.mock.calls.length]).toEqual([2, 1]);
    } finally {
      reads.mockRestore();
      writes.mockRestore();
    }
  });
});

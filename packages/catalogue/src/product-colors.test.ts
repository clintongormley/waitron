import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createCatalogue, createProduct, listProducts, updateProduct } from "./operations.js";
import { setProductColor } from "./product-colors.js";
import { setProductVariants } from "./variants.js";
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
  await app((tx) => setProductColor(tx, productId, "#256bb1"));
  expect(await storedColor(productId)).toBe("#256bb1");
  const listed = await app((tx) => listProducts(tx, catalogueId));
  expect(listed.find((product) => product.id === productId)).toMatchObject({ color: "#256bb1" });
  await app((tx) => setProductColor(tx, productId, null));
  expect(await storedColor(productId)).toBeNull();
});

it("answers a variant's id as an id that names no product, and leaves both rows", async () => {
  await app((tx) => setProductColor(tx, productId, "#256bb1"));
  await expect(app((tx) => setProductColor(tx, variantId, "#b12525"))).rejects.toMatchObject({
    code: "product.not_found",
    params: { productId: variantId },
  });
  const unknown = crypto.randomUUID();
  await expect(app((tx) => setProductColor(tx, unknown, "#b12525"))).rejects.toMatchObject({
    code: "product.not_found",
    params: { productId: unknown },
  });
  expect(await storedColor(variantId)).toBeNull();
  expect(await storedColor(productId)).toBe("#256bb1");
});

it.each(["#B12525", "", "red"])(
  "refuses the colour %j as product.invalid on color, before looking for the product",
  async (color) => {
    await app((tx) => setProductColor(tx, productId, "#256bb1"));
    await expect(app((tx) => setProductColor(tx, productId, color))).rejects.toMatchObject({
      code: "product.invalid",
      params: { field: "color" },
    });
    await expect(
      app((tx) => setProductColor(tx, crypto.randomUUID(), color)),
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

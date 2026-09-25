import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct, listProducts } from "./operations.js";
import { setProductVariants } from "./variants.js";
import {
  createLabel,
  deleteLabel,
  listLabels,
  readProductLabels,
  renameLabel,
  setProductLabels,
} from "./labels.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const product = (name: string) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      });
    const beer = await product("Beer");
    const juice = await product("Juice");
    const [glass] = await setProductVariants(
      tx,
      beer.id,
      [
        {
          name: "Half pint",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      "en",
    );
    return { menuId: menu.id, beer: beer.id, juice: juice.id, variant: glass!.id };
  });
}

describe("labels", () => {
  it("creates, lists with a product count, renames and deletes a label", async () => {
    const f = await fixture();
    const alcoholic = await app((tx) => createLabel(tx, "  Alcoholic  "));
    expect(alcoholic).toEqual({ id: alcoholic.id, name: "Alcoholic" });
    const happy = await app((tx) => createLabel(tx, "Happy hour drinks"));
    await app((tx) => setProductLabels(tx, f.beer, [alcoholic.id, happy.id]));
    await app((tx) => setProductLabels(tx, f.juice, [happy.id]));
    expect(await app((tx) => listLabels(tx))).toEqual([
      { id: alcoholic.id, name: "Alcoholic", productCount: 1 },
      { id: happy.id, name: "Happy hour drinks", productCount: 2 },
    ]);
    expect(await app((tx) => renameLabel(tx, happy.id, " After work "))).toEqual({
      id: happy.id,
      name: "After work",
    });
    // Renaming a label to the name it already has is not a clash with itself.
    expect(await app((tx) => renameLabel(tx, happy.id, "After work"))).toEqual({
      id: happy.id,
      name: "After work",
    });
    expect((await app((tx) => listLabels(tx))).map((l) => l.name)).toEqual([
      "After work",
      "Alcoholic",
    ]);
    await app((tx) => deleteLabel(tx, happy.id));
    expect(await app((tx) => listLabels(tx))).toEqual([
      { id: alcoholic.id, name: "Alcoholic", productCount: 1 },
    ]);
    // The deleted label is gone from every product that carried it.
    expect(await app((tx) => readProductLabels(tx, f.beer))).toEqual([alcoholic.id]);
    expect(await app((tx) => readProductLabels(tx, f.juice))).toEqual([]);
  });

  it("refuses a blank name and a name another label already has", async () => {
    await fixture();
    const alcoholic = await app((tx) => createLabel(tx, "Alcoholic"));
    const other = await app((tx) => createLabel(tx, "Soft"));
    await expect(app((tx) => createLabel(tx, "   "))).rejects.toMatchObject({
      code: "label.invalid",
      params: { field: "name" },
    });
    await expect(app((tx) => createLabel(tx, " Alcoholic "))).rejects.toMatchObject({
      code: "label.name_taken",
      params: { name: "Alcoholic" },
    });
    await expect(app((tx) => renameLabel(tx, other.id, "Alcoholic"))).rejects.toMatchObject({
      code: "label.name_taken",
      params: { name: "Alcoholic" },
    });
    await expect(app((tx) => renameLabel(tx, other.id, ""))).rejects.toMatchObject({
      code: "label.invalid",
      params: { field: "name" },
    });
    await expect(app((tx) => createLabel(tx, 7 as unknown as string))).rejects.toMatchObject({
      code: "label.invalid",
      params: { field: "name" },
    });
    expect((await app((tx) => listLabels(tx))).map((l) => l.id)).toEqual([alcoholic.id, other.id]);
  });

  it("treats names differing only in letter case as different labels", async () => {
    await fixture();
    const upper = await app((tx) => createLabel(tx, "Alcoholic"));
    const lower = await app((tx) => createLabel(tx, "alcoholic"));
    await expect(app((tx) => createLabel(tx, "Alcoholic"))).rejects.toMatchObject({
      code: "label.name_taken",
      params: { name: "Alcoholic" },
    });
    expect(await app((tx) => listLabels(tx))).toEqual([
      { id: upper.id, name: "Alcoholic", productCount: 0 },
      { id: lower.id, name: "alcoholic", productCount: 0 },
    ]);
  });

  it("refuses a rename or delete of an unknown label", async () => {
    await fixture();
    await app((tx) => createLabel(tx, "Taken"));
    const missing = crypto.randomUUID();
    const writes: ((tx: Transaction) => Promise<unknown>)[] = [
      (tx) => renameLabel(tx, missing, "Anything"),
      // An unknown label is reported as such even when the name it asks for is taken.
      (tx) => renameLabel(tx, missing, "Taken"),
      (tx) => deleteLabel(tx, missing),
    ];
    for (const write of writes)
      await expect(app(write)).rejects.toMatchObject({
        code: "label.not_found",
        params: { labelId: missing },
      });
  });

  it("replaces a product's labels, and refuses an unknown, repeated or malformed selection whole", async () => {
    const f = await fixture();
    const a = await app((tx) => createLabel(tx, "A"));
    const b = await app((tx) => createLabel(tx, "B"));
    expect(await app((tx) => setProductLabels(tx, f.beer, [b.id, a.id]))).toEqual(
      [a.id, b.id].sort(),
    );
    expect(await app((tx) => readProductLabels(tx, f.beer))).toEqual([a.id, b.id].sort());
    const missing = crypto.randomUUID();
    for (const [labelIds, error] of [
      [[a.id, missing], { code: "label.not_found", params: { labelId: missing } }],
      [[a.id, a.id], { code: "label.invalid", params: { field: "labelIds" } }],
      [[a.id, a.id.toUpperCase()], { code: "label.invalid", params: { field: "labelIds" } }],
      ["not-a-list", { code: "label.invalid", params: { field: "labelIds" } }],
      [[a.id, 3], { code: "label.invalid", params: { field: "labelIds" } }],
    ] as const) {
      await expect(
        app((tx) => setProductLabels(tx, f.beer, labelIds as unknown as string[])),
      ).rejects.toMatchObject(error);
      expect(await app((tx) => readProductLabels(tx, f.beer))).toEqual([a.id, b.id].sort());
    }
    expect(await app((tx) => setProductLabels(tx, f.beer, [b.id.toUpperCase()]))).toEqual([b.id]);
    expect(await app((tx) => readProductLabels(tx, f.beer))).toEqual([b.id]);
    expect(await app((tx) => setProductLabels(tx, f.beer, []))).toEqual([]);
    expect(await app((tx) => readProductLabels(tx, f.beer))).toEqual([]);
  });

  it("reads a variant's labels as its parent's and refuses labels of its own", async () => {
    const f = await fixture();
    const a = await app((tx) => createLabel(tx, "A"));
    await app((tx) => setProductLabels(tx, f.beer, [a.id]));
    expect(await app((tx) => readProductLabels(tx, f.variant))).toEqual([a.id]);
    await expect(app((tx) => setProductLabels(tx, f.variant, [a.id]))).rejects.toMatchObject({
      code: "product.variant_invalid",
      params: { field: "labelIds" },
    });
    // The list reads the parent's labels onto the variant too.
    const [beer] = (await app((tx) => listProducts(tx, f.menuId))).filter((p) => p.id === f.beer);
    expect(beer!.labelIds).toEqual([a.id]);
    expect(beer!.variants.map((v) => v.effective.labelIds)).toEqual([[a.id]]);
  });

  it("refuses an unknown product on both the read and the write", async () => {
    await fixture();
    const missing = crypto.randomUUID();
    await expect(app((tx) => readProductLabels(tx, missing))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: missing },
    });
    await expect(app((tx) => setProductLabels(tx, missing, []))).rejects.toMatchObject({
      code: "product.not_found",
      params: { productId: missing },
    });
  });
});

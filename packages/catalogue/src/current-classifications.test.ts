import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createCategory, setMainReportingCategory, updateCategory } from "./categories.js";
import { setProductVariants } from "./variants.js";
import { writeContentLanguages } from "./content-languages.js";
import { currentClassifications } from "./current-classifications.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

/** Drinks > Softs, and a top-level Spirits. */
async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const drinks = await createCategory(tx, { name: "Drinks" });
    const softs = await createCategory(tx, {
      name: "Softs",
      parentId: drinks.id,
    });
    const spirits = await createCategory(tx, { name: "Spirits" });
    const product = (name: string, categoryId: string | null) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name,
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      });
    const cola = await product("Cola", softs.id);
    const water = await product("Water", null);
    const gin = await product("Gin", spirits.id);
    const [double] = await setProductVariants(
      tx,
      gin.id,
      [
        {
          name: "Double",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      "en",
    );
    return {
      drinks,
      softs,
      spirits,
      cola: cola.id,
      water: water.id,
      gin: gin.id,
      double: double!.id,
    };
  });
}

describe("currentClassifications", () => {
  it("classifies each listed product by today's chain, by each category's one name, whatever the content language", async () => {
    const f = await fixture();
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es", "en"] }),
    );

    const map = await app((tx) => currentClassifications(tx, [f.cola, f.water, f.double]));

    expect(Object.fromEntries(map)).toEqual({
      [f.cola]: {
        reporting: [
          { id: f.drinks.id, name: "Drinks" },
          { id: f.softs.id, name: "Softs" },
        ],
      },
      [f.water]: { reporting: [] },
      // A variant reports its parent's main category.
      [f.double]: { reporting: [{ id: f.spirits.id, name: "Spirits" }] },
    });
  });

  it("follows a move and a rename made since, rather than any earlier state", async () => {
    const f = await fixture();
    await app(async (tx) => {
      await updateCategory(tx, f.softs.id, {
        name: "Soft drinks",
        parentId: f.spirits.id,
      });
      await setMainReportingCategory(tx, f.water, f.drinks.id);
    });

    const map = await app((tx) => currentClassifications(tx, [f.cola, f.water]));

    expect(map.get(f.cola)).toEqual({
      reporting: [
        { id: f.spirits.id, name: "Spirits" },
        { id: f.softs.id, name: "Soft drinks" },
      ],
    });
    expect(map.get(f.water)).toEqual({ reporting: [{ id: f.drinks.id, name: "Drinks" }] });
  });

  it("leaves out an id no product row has, rather than refusing the whole list", async () => {
    const f = await fixture();
    const unknown = "00000000-0000-4000-8000-00000000dead";

    const map = await app((tx) => currentClassifications(tx, [unknown, f.water, f.water]));

    expect([...map.keys()]).toEqual([f.water]);
  });

  it("answers an empty list with an empty map", async () => {
    await fixture();

    const map = await app((tx) => currentClassifications(tx, []));

    expect(map.size).toBe(0);
  });
});

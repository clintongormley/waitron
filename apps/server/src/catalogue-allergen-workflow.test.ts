import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
  updateProduct,
} from "@waitron/catalogue";
import type { ProductAllergens } from "@waitron/catalogue";
import { createIngredient, setProductRecipe, updateIngredient } from "@waitron/recipes";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((set) => ["core", "catalogue"].includes(set.name)),
    null,
  ),
});

describe("catalogue allergen workflows", () => {
  it("keeps unreviewed, reviewed-none and specific allergen kinds distinct in the till read", async () => {
    await seedVenue(suite.db, { timeZone: "Europe/Madrid", invoiceLocales: ["en-GB"] });
    await withTransaction(suite.db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const food = await createCategory(tx, { name: "Food" });
      const desserts = await createCategory(tx, { name: "Desserts" });
      const samples: {
        name: string;
        categoryId: string;
        unitPrice: string;
        allergens?: ProductAllergens;
      }[] = [
        {
          name: "Wheat pastry",
          categoryId: food.id,
          unitPrice: "3.50",
          allergens: { gluten: { kinds: ["wheat"] }, eggs: {} },
        },
        {
          name: "House cake",
          categoryId: desserts.id,
          unitPrice: "4.20",
          allergens: { milk: {}, nuts: { kinds: ["almonds"] } },
        },
        { name: "Garden salad", categoryId: food.id, unitPrice: "5.90", allergens: {} },
        { name: "Daily soup", categoryId: food.id, unitPrice: "4.50" },
      ];
      for (const sample of samples) {
        await createProduct(tx, {
          catalogueId: catalogue.id,
          pricingUnit: "each",
          vatClass: "reduced",
          ...sample,
        });
      }
      await assignCatalogueToVenue(tx, catalogue.id);
    });
    const available = await withTransaction(suite.db, (tx) => listAvailableProducts(tx));
    expect(
      Object.fromEntries(available.products.map((product) => [product.name, product.allergens])),
    ).toEqual({
      "Wheat pastry": { gluten: { kinds: ["wheat"] }, eggs: {} },
      "House cake": { milk: {}, nuts: { kinds: ["almonds"] } },
      "Garden salad": {},
      "Daily soup": null,
    });
  });

  it("publishes recipe inheritance and manual additions, then withdraws and restores review", async () => {
    await withTransaction(suite.db, async (tx) => {
      const sauce = await createIngredient(tx, { name: "Egg sauce", allergens: { eggs: {} } });
      const bread = await createIngredient(tx, {
        name: "Wheat bread",
        allergens: { gluten: { kinds: ["wheat"] } },
      });
      const filling = await createIngredient(tx, { name: "Unreviewed filling" });
      const catalogue = await createCatalogue(tx, { name: "Deli" });
      const sandwich = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: null,
        name: "Sandwich",
        pricingUnit: "each",
        unitPrice: "5.50",
        vatClass: "reduced",
      });
      const published = async () =>
        (
          await tx
            .select({ allergens: products.allergens })
            .from(products)
            .where(eq(products.id, sandwich.id))
        )[0]!.allergens;
      await setProductRecipe(tx, sandwich.id, [sauce.id, bread.id]);
      expect(await published()).toEqual({ eggs: {}, gluten: { kinds: ["wheat"] } });
      await updateProduct(tx, sandwich.id, { allergens: { nuts: { kinds: ["almonds"] } } });
      expect(await published()).toEqual({
        eggs: {},
        gluten: { kinds: ["wheat"] },
        nuts: { kinds: ["almonds"] },
      });
      await setProductRecipe(tx, sandwich.id, [sauce.id, bread.id, filling.id]);
      expect(await published()).toBeNull();
      await updateIngredient(tx, filling.id, { allergens: { fish: {} } });
      expect(await published()).toEqual({
        eggs: {},
        fish: {},
        gluten: { kinds: ["wheat"] },
        nuts: { kinds: ["almonds"] },
      });
    });
  });
});

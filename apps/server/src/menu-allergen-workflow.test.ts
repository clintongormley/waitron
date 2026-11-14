import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/menu";
import type { ProductAllergens } from "@waitron/menu";

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
});

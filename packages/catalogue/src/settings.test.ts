import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, catalogues, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import * as catalogue from "./index.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

describe("the venue's new-product defaults", () => {
  it("uses general before provisioning has stored a preset", async () => {
    expect(await catalogue.readCatalogueSettings(suite.db)).toEqual({
      defaultProductVatClass: "general",
    });
  });

  it.each(["general", "reduced", "super_reduced", "zero"] as const)(
    "saves and reloads %s without changing an existing product",
    async (defaultProductVatClass) => {
      await seedTenant(suite.db);
      const [menu] = await suite.db.insert(catalogues).values({ name: "Lunch" }).returning();
      const [product] = await suite.db
        .insert(products)
        .values({
          catalogueId: menu!.id,
          name: "Lemonade",
          pricingUnit: "each",
          unitPrice: 100,
          vatClass: "reduced",
        })
        .returning();
      await withTransaction(suite.db, (tx) =>
        catalogue.saveCatalogueSettings(tx, { defaultProductVatClass }),
      );
      expect(await catalogue.readCatalogueSettings(suite.db)).toEqual({ defaultProductVatClass });
      expect(
        await suite.db
          .select({ vatClass: products.vatClass })
          .from(products)
          .where(eq(products.id, product!.id)),
      ).toEqual([{ vatClass: "reduced" }]);
    },
  );

  it.each([undefined, null, {}, [], ["reduced"], "", "unknown", 10, true])(
    "refuses an invalid default %j without changing the stored setting",
    async (value) => {
      await withTransaction(suite.db, (tx) =>
        catalogue.saveCatalogueSettings(tx, { defaultProductVatClass: "zero" }),
      );
      await expect(
        withTransaction(suite.db, (tx) =>
          catalogue.saveCatalogueSettings(tx, { defaultProductVatClass: value }),
        ),
      ).rejects.toMatchObject({
        code: "product.invalid",
        params: { field: "defaultProductVatClass" },
      });
      expect(await catalogue.readCatalogueSettings(suite.db)).toEqual({
        defaultProductVatClass: "zero",
      });
    },
  );
});

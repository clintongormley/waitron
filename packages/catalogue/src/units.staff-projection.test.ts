import { expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createUnit } from "./units.js";
import {
  addProductToMenu,
  createCatalogue,
  createProduct,
  listAvailableProducts,
  listMenuOffers,
  listProducts,
} from "./operations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

it.each(["products", "available", "offers"] as const)(
  "%s carries the staff pair separately from customer translations",
  async (surface) => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Deli" });
      const unit = await createUnit(
        tx,
        {
          staffName: "Mass",
          staffAbbreviation: "M",
          name: { en: "Customer weight" },
          abbreviation: { en: "CW" },
          precision: 3,
        },
        "en",
      );
      const weighed = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Staff potatoes",
        unitId: unit.id,
        unitPrice: "3.00",
        vatClass: "general",
      });
      const each = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Staff cup",
        unitId: null,
        unitPrice: "1.00",
        vatClass: "general",
      });
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Room",
          catalogueId: menu.id,
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
        })
        .returning({ id: locations.id });
      await addProductToMenu(tx, { menuId: menu.id, productId: weighed.id, grossPrice: "3.00" });
      await addProductToMenu(tx, { menuId: menu.id, productId: each.id, grossPrice: "1.00" });
      const rows =
        surface === "products"
          ? await listProducts(tx, menu.id)
          : surface === "available"
            ? (await listAvailableProducts(tx, location!.id)).products
            : await listMenuOffers(tx, [menu.id]);
      const first = rows.find((row) => row.name === "Staff potatoes")!;
      const second = rows.find((row) => row.name === "Staff cup")!;
      expect(first.unit).toEqual({
        id: unit.id,
        staffName: "Mass",
        staffAbbreviation: "M",
        name: { en: "Customer weight" },
        abbreviation: { en: "CW" },
        precision: 3,
        hardwareUnit: null,
      });
      expect(second.unit).toMatchObject({
        id: "00000000-0000-0000-0000-000000000001",
        staffName: "Each",
        staffAbbreviation: "ea",
        precision: 0,
        hardwareUnit: null,
      });
    });
  },
);

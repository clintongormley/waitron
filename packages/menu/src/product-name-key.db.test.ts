import { beforeEach, describe, expect, it } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedTaxpayer, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useMenuDb } from "../test/fixtures.js";
import { createProduct } from "./operations.js";

const suite = useMenuDb();
const app = <T>(action: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, action);

beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedVenueSettings(suite.db);
  await seedLegacySellingUnits(suite.db);
});

const make = (name: string) =>
  app((tx) =>
    createProduct(tx, {
      categoryId: null,
      name,
      pricingUnit: "each",
      unitPrice: "2",
      vatClass: "general",
    }),
  ).then((created) => created.id);

describe("the clash lookup", () => {
  it("finds a clash that differs only in a non-ASCII letter's case", async () => {
    await make("Ñoquis");
    await expect(make("ñoquis")).rejects.toMatchObject({
      code: "product.name_taken",
      params: { field: "name", name: "ñoquis" },
    });
  });

  it("refuses a duplicate of a raw product without a stored key", async () => {
    await app((tx) =>
      tx.insert(products).values({ name: "Gazpacho", unitPrice: 200, vatClass: "general" }),
    );
    await expect(make("gazpacho")).rejects.toMatchObject({
      code: "product.name_taken",
      params: { field: "name", name: "gazpacho" },
    });
  });
});

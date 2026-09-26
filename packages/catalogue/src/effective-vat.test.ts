import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct, updateProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { readEffectiveVatClasses } from "./effective-vat.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

afterEach(() => {
  vi.restoreAllMocks();
});

const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }).session;

/** A wine at `reduced` with two variants: one leaves its VAT class blank, one sets `super_reduced`.
 * A second product at `zero`, so a read that takes the wrong row's class answers differently. */
async function fixture() {
  await seedTenant(suite.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const product = (name: string, vatClass: "reduced" | "zero") =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name,
        pricingUnit: "each",
        unitPrice: "4.00",
        vatClass,
      });
    const wine = await product("Wine", "reduced");
    const water = await product("Water", "zero");
    const [blank, own] = await setProductVariants(
      tx,
      wine.id,
      ["Glass", "Bottle"].map((name) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: null,
        available: true,
      })),
      "en",
    );
    await updateProduct(tx, own!.id, { vatClass: "super_reduced" });
    return { wine: wine.id, water: water.id, blank: blank!.id, own: own!.id };
  });
}

describe("readEffectiveVatClasses", () => {
  it("reads each product's current class, a variant with none of its own following its parent's current class", async () => {
    const f = await fixture();
    await app((tx) => updateProduct(tx, f.wine, { vatClass: "general" }));

    const classes = await app((tx) =>
      readEffectiveVatClasses(tx, [f.wine, f.water, f.blank, f.own]),
    );

    expect(classes).toEqual(
      new Map([
        [f.wine, "general"],
        [f.water, "zero"],
        [f.blank, "general"],
        [f.own, "super_reduced"],
      ]),
    );
  });

  it("reads every id in one query, lists a repeated id once and leaves out an id that names no product", async () => {
    const f = await fixture();
    const missing = "00000000-0000-4000-8000-000000000000";

    await app(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      const classes = await readEffectiveVatClasses(tx, [f.blank, f.blank, f.water, missing]);

      expect(prepared).toHaveBeenCalledTimes(1);
      expect(classes).toEqual(
        new Map([
          [f.blank, "reduced"],
          [f.water, "zero"],
        ]),
      );
    });
  });

  it("asks nothing of the database for no ids", async () => {
    await app(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");

      expect(await readEffectiveVatClasses(tx, [])).toEqual(new Map());
      expect(prepared).not.toHaveBeenCalled();
    });
  });
});

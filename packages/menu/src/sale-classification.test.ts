import { describe, expect, it, vi } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { SaleLineClassification } from "@waitron/shared";
import { plantStoredCategory, seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createCategory } from "./categories.js";
import { setProductVariants } from "./variants.js";
import {
  classifyLine,
  loadClassification,
  validateSnapshot,
  type LoadedClassification,
} from "./sale-classification.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

/**
 * The drizzle session the query-count case spies on. `session` is marked `@internal`, so it is on
 * the object at runtime and off the published type.
 */
const sessionOf = (tx: Transaction) =>
  (tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }).session;

/** Drinks > Alcoholic drinks > Cocktails, and a separate top-level Extras. */
async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const drinks = await createCategory(tx, { name: "Drinks" });
    const alcoholic = await createCategory(tx, {
      name: "Alcoholic drinks",
      parentId: drinks.id,
    });
    const cocktails = await createCategory(tx, {
      name: "Cocktails",
      parentId: alcoholic.id,
    });
    const extras = await createCategory(tx, { name: "Extras" });
    const product = (name: string, categoryId: string | null) =>
      createProduct(tx, {
        catalogueId: menu.id,
        categoryId,
        name,
        pricingUnit: "each",
        unitPrice: "3",
        vatClass: "general",
      });
    const mojito = await product("Mojito", cocktails.id);
    const wine = await product("Wine by the glass", alcoholic.id);
    const water = await product("Water", null);
    const lemon = await product("Lemon", extras.id);
    const beer = await product("Beer", drinks.id);
    const variant = (name: string) => ({
      name,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
    });
    const [wine125, wine175] = await setProductVariants(
      tx,
      wine.id,
      [variant("125 ml"), variant("175 ml")],
      "en",
    );
    // A variant still holding a category of its own, which it never reports.
    await plantStoredCategory(tx, wine175!.id, cocktails.id);
    return {
      categories: { drinks, alcoholic, cocktails, extras },
      products: {
        mojito: mojito.id,
        wine: wine.id,
        wine125: wine125!.id,
        wine175: wine175!.id,
        water: water.id,
        lemon: lemon.id,
        beer: beer.id,
      },
    };
  });
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function chain(f: Fixture, ...which: (keyof Fixture["categories"])[]) {
  return which.map((key) => ({ id: f.categories[key].id, name: f.categories[key].name }));
}

async function loaded(f: Fixture): Promise<LoadedClassification> {
  return app((tx) => loadClassification(tx, Object.values(f.products)));
}

describe("classifyLine", () => {
  it("records a dish's main reporting chain from the root to the leaf, and nothing else", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.mojito)).toEqual({
      reporting: chain(f, "drinks", "alcoholic", "cocktails"),
    });
  });

  it("gives a variant with no main category its parent's chain", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.wine125)).toEqual({
      reporting: chain(f, "drinks", "alcoholic"),
    });
  });

  it("gives a variant holding a stored category of its own its parent's chain", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.wine175)).toEqual({
      reporting: chain(f, "drinks", "alcoholic"),
    });
  });

  it("records an Uncategorised product with an empty chain", async () => {
    const f = await fixture();

    expect(classifyLine(await loaded(f), f.products.water)).toEqual({ reporting: [] });
  });

  it("classifies an extras pick by its own product, not by any dish", async () => {
    const f = await fixture();

    expect(classifyLine(await loaded(f), f.products.lemon)).toEqual({
      reporting: chain(f, "extras"),
    });
  });

  it("refuses a product that was not loaded", async () => {
    const f = await fixture();
    const c = await app((tx) => loadClassification(tx, [f.products.mojito]));

    const error = await captureError(async () => classifyLine(c, f.products.water));

    expect(error).toMatchObject({
      code: "product.not_found",
      params: { productId: f.products.water },
    });
  });

  it("refuses to build a chain through a category that was not loaded", () => {
    const c: LoadedClassification = {
      categories: new Map([["leaf", { name: "Leaf", parentId: "gone" }]]),
      products: new Map([["p", { categoryId: "leaf" }]]),
    };

    expect(() => classifyLine(c, "p")).toThrow(
      expect.objectContaining({
        code: "sale_classification.invalid",
        params: { productId: "p", reason: "unknown_id" },
      }),
    );
  });

  it("refuses to build a chain round a loop in the tree, rather than walking it forever", () => {
    const c: LoadedClassification = {
      categories: new Map([
        ["a", { name: "A", parentId: "b" }],
        ["b", { name: "B", parentId: "a" }],
      ]),
      products: new Map([["p", { categoryId: "a" }]]),
    };

    expect(() => classifyLine(c, "p")).toThrow(
      expect.objectContaining({
        code: "sale_classification.invalid",
        params: { productId: "p", reason: "repeated_id" },
      }),
    );
  });
});

describe("loadClassification", () => {
  it("reads the same fixed number of queries for one product as for a basket across three categories", async () => {
    const f = await fixture();
    const counts = await app(async (tx) => {
      const prepared = vi.spyOn(sessionOf(tx), "prepareQuery");
      await loadClassification(tx, [f.products.mojito]);
      const one = prepared.mock.calls.length;
      prepared.mockClear();
      const basket = await loadClassification(tx, [
        f.products.mojito,
        f.products.wine125,
        f.products.wine175,
        f.products.beer,
        f.products.lemon,
      ]);
      const five = prepared.mock.calls.length;
      prepared.mockRestore();
      return { one, five, loadedProducts: basket.products.size };
    });

    expect(counts.five).toBe(counts.one);
    expect(counts.one).toBeGreaterThan(0);
    expect(counts.loadedProducts).toBe(5);
  });

  it("loads nothing for an empty basket but still answers", async () => {
    const f = await fixture();
    const c = await app((tx) => loadClassification(tx, []));

    expect(c.products.size).toBe(0);
    expect(c.categories.get(f.categories.drinks.id)).toEqual({
      name: "Drinks",
      parentId: null,
    });
  });
});

describe("validateSnapshot", () => {
  async function classified() {
    const f = await fixture();
    const c = await loaded(f);
    return { f, c, snapshot: classifyLine(c, f.products.mojito) };
  }

  it("accepts the snapshot classifyLine built (the control)", async () => {
    const { f, c, snapshot } = await classified();

    expect(() => validateSnapshot(c, f.products.mojito, snapshot)).not.toThrow();
  });

  it("refuses a category id that names no category", async () => {
    const { f, c, snapshot } = await classified();
    const corrupt: SaleLineClassification = {
      reporting: [{ id: "no-such-category", name: "Gone" }, ...snapshot.reporting],
    };

    expect(await captureError(() => validateSnapshot(c, f.products.mojito, corrupt))).toMatchObject(
      {
        code: "sale_classification.invalid",
        params: { productId: f.products.mojito, reason: "unknown_id" },
      },
    );
  });

  it("refuses an empty category name", async () => {
    const { f, c, snapshot } = await classified();
    const corrupt: SaleLineClassification = {
      reporting: snapshot.reporting.map((e, i) => (i === 1 ? { ...e, name: "" } : e)),
    };

    expect(await captureError(() => validateSnapshot(c, f.products.mojito, corrupt))).toMatchObject(
      {
        code: "sale_classification.invalid",
        params: { productId: f.products.mojito, reason: "empty_name" },
      },
    );
  });

  it("refuses a chain that names one category twice", async () => {
    const { f, c, snapshot } = await classified();
    const [drinks, alcoholic, cocktails] = snapshot.reporting;

    expect(
      await captureError(() =>
        validateSnapshot(c, f.products.mojito, {
          ...snapshot,
          reporting: [drinks!, alcoholic!, drinks!, alcoholic!, cocktails!],
        }),
      ),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.mojito, reason: "repeated_id" },
    });
  });

  it.each<[string, (f: Fixture, s: SaleLineClassification) => SaleLineClassification]>([
    [
      "a chain ending above the main category",
      (_f, s) => ({ ...s, reporting: s.reporting.slice(0, 2) }),
    ],
    ["an empty chain for a categorised product", (_f, s) => ({ ...s, reporting: [] })],
    ["a chain ending in another category", (f, s) => ({ ...s, reporting: chain(f, "extras") })],
  ])("refuses %s", async (_case, corrupt) => {
    const { f, c, snapshot } = await classified();

    expect(
      await captureError(() => validateSnapshot(c, f.products.mojito, corrupt(f, snapshot))),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.mojito, reason: "wrong_leaf" },
    });
  });

  it("refuses a chain on an Uncategorised product", async () => {
    const { f, c } = await classified();

    expect(
      await captureError(() =>
        validateSnapshot(c, f.products.water, { reporting: chain(f, "extras") }),
      ),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.water, reason: "wrong_leaf" },
    });
  });
});

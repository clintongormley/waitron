import { describe, expect, it, vi } from "vitest";
import { captureError, withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { SaleLineClassification } from "@waitron/shared";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createCategory, setMainReportingCategory } from "./categories.js";
import { createLabel, setProductLabels } from "./labels.js";
import { setProductVariants } from "./variants.js";
import {
  classifyLine,
  loadClassification,
  parentProductOf,
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

/**
 * Drinks > Alcoholic drinks > Cocktails, and a separate top-level Extras. Every category's English
 * and Spanish names differ, so a snapshot read in the wrong language fails.
 */
async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Bar" });
    const drinks = await createCategory(tx, { name: { en: "Drinks", es: "Bebidas" } });
    const alcoholic = await createCategory(tx, {
      name: { en: "Alcoholic drinks", es: "Bebidas alcohólicas" },
      parentId: drinks.id,
    });
    const cocktails = await createCategory(tx, {
      name: { en: "Cocktails", es: "Cócteles" },
      parentId: alcoholic.id,
    });
    const extras = await createCategory(tx, { name: { en: "Extras", es: "Añadidos" } });
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
    // A variant with a main category of its own, which it takes over its parent's.
    await setMainReportingCategory(tx, wine175!.id, cocktails.id, "any");

    const happyHour = await createLabel(tx, "Happy hour drinks");
    const alcoholicLabel = await createLabel(tx, "Alcoholic");
    await setProductLabels(tx, mojito.id, [happyHour.id, alcoholicLabel.id]);
    await setProductLabels(tx, wine.id, [alcoholicLabel.id]);
    return {
      categories: { drinks, alcoholic, cocktails, extras },
      labels: { happyHour, alcoholic: alcoholicLabel },
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

function sortedLabels(f: Fixture, ...which: ("happyHour" | "alcoholic")[]) {
  return which
    .map((key) => ({ id: f.labels[key].id, name: f.labels[key].name }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function chain(f: Fixture, language: "en" | "es", ...which: (keyof Fixture["categories"])[]) {
  return which.map((key) => ({
    id: f.categories[key].id,
    name: f.categories[key].name[language]!,
  }));
}

async function loaded(f: Fixture, language = "en"): Promise<LoadedClassification> {
  return app((tx) => loadClassification(tx, Object.values(f.products), language));
}

describe("classifyLine", () => {
  it("records a dish's main reporting chain from the root to the leaf, and its labels sorted by id", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.mojito)).toEqual({
      reporting: chain(f, "en", "drinks", "alcoholic", "cocktails"),
      labels: sortedLabels(f, "happyHour", "alcoholic"),
    });
    expect(parentProductOf(c, f.products.mojito)).toBeNull();
  });

  it("names each category in the default content language it is loaded with", async () => {
    const f = await fixture();

    expect(classifyLine(await loaded(f, "es"), f.products.mojito).reporting).toEqual(
      chain(f, "es", "drinks", "alcoholic", "cocktails"),
    );
  });

  it("gives a variant with no main category its parent's chain, its parent's labels and its parent's id", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.wine125)).toEqual({
      reporting: chain(f, "en", "drinks", "alcoholic"),
      labels: sortedLabels(f, "alcoholic"),
    });
    expect(parentProductOf(c, f.products.wine125)).toBe(f.products.wine);
  });

  it("gives a variant with a main category of its own that chain, and still its parent's labels", async () => {
    const f = await fixture();
    const c = await loaded(f);

    expect(classifyLine(c, f.products.wine175)).toEqual({
      reporting: chain(f, "en", "drinks", "alcoholic", "cocktails"),
      labels: sortedLabels(f, "alcoholic"),
    });
    expect(parentProductOf(c, f.products.wine175)).toBe(f.products.wine);
  });

  it("records an Uncategorised product with an empty chain and no labels", async () => {
    const f = await fixture();

    expect(classifyLine(await loaded(f), f.products.water)).toEqual({ reporting: [], labels: [] });
  });

  it("classifies an extras pick by its own product, not by any dish", async () => {
    const f = await fixture();

    expect(classifyLine(await loaded(f), f.products.lemon)).toEqual({
      reporting: chain(f, "en", "extras"),
      labels: [],
    });
  });

  it("refuses a product that was not loaded", async () => {
    const f = await fixture();
    const c = await app((tx) => loadClassification(tx, [f.products.mojito], "en"));

    const error = await captureError(async () => classifyLine(c, f.products.water));

    expect(error).toMatchObject({
      code: "product.not_found",
      params: { productId: f.products.water },
    });
    expect(() => parentProductOf(c, f.products.water)).toThrow(
      expect.objectContaining({ code: "product.not_found" }),
    );
  });

  it("refuses to build a chain through a category that was not loaded", () => {
    const c: LoadedClassification = {
      categories: new Map([["leaf", { name: { en: "Leaf" }, parentId: "gone" }]]),
      language: "en",
      labels: new Map(),
      products: new Map([["p", { parentId: null, categoryId: "leaf", labelIds: [] }]]),
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
        ["a", { name: { en: "A" }, parentId: "b" }],
        ["b", { name: { en: "B" }, parentId: "a" }],
      ]),
      language: "en",
      labels: new Map(),
      products: new Map([["p", { parentId: null, categoryId: "a", labelIds: [] }]]),
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
      await loadClassification(tx, [f.products.mojito], "en");
      const one = prepared.mock.calls.length;
      prepared.mockClear();
      const basket = await loadClassification(
        tx,
        [
          f.products.mojito,
          f.products.wine125,
          f.products.wine175,
          f.products.beer,
          f.products.lemon,
        ],
        "en",
      );
      const five = prepared.mock.calls.length;
      prepared.mockRestore();
      return { one, five, loadedProducts: basket.products.size };
    });

    expect(counts.five).toBe(counts.one);
    expect(counts.one).toBeGreaterThan(0);
    expect(counts.loadedProducts).toBe(5);
  });

  it("reads only the labels the loaded products carry", async () => {
    const f = await fixture();
    const [variantOnly, unlabelled] = await app(async (tx) => [
      await loadClassification(tx, [f.products.wine125], "en"),
      await loadClassification(tx, [f.products.water, f.products.lemon], "en"),
    ]);

    expect([...variantOnly.labels.keys()]).toEqual([f.labels.alcoholic.id]);
    expect(unlabelled.labels.size).toBe(0);
  });

  it("loads nothing for an empty basket but still answers", async () => {
    const f = await fixture();
    const c = await app((tx) => loadClassification(tx, [], "en"));

    expect(c.products.size).toBe(0);
    expect(c.categories.get(f.categories.drinks.id)).toEqual({
      name: { en: "Drinks", es: "Bebidas" },
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

  function refusal(fn: () => void) {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error("validateSnapshot accepted the snapshot");
  }

  it("accepts the snapshot classifyLine built (the control)", async () => {
    const { f, c, snapshot } = await classified();

    expect(() => validateSnapshot(c, f.products.mojito, snapshot)).not.toThrow();
  });

  it.each<[string, (f: Fixture, s: SaleLineClassification) => SaleLineClassification]>([
    [
      "a category id that names no category",
      (_f, s) => ({ ...s, reporting: [{ id: "no-such-category", name: "Gone" }, ...s.reporting] }),
    ],
    [
      "a label id that names no label",
      (_f, s) => ({ ...s, labels: [...s.labels, { id: "no-such-label", name: "Gone" }] }),
    ],
  ])("refuses %s", async (_case, corrupt) => {
    const { f, c, snapshot } = await classified();

    expect(
      refusal(() => validateSnapshot(c, f.products.mojito, corrupt(f, snapshot))),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.mojito, reason: "unknown_id" },
    });
  });

  it.each<[string, (s: SaleLineClassification) => SaleLineClassification]>([
    [
      "an empty category name",
      (s) => ({ ...s, reporting: s.reporting.map((e, i) => (i === 1 ? { ...e, name: "" } : e)) }),
    ],
    [
      "an empty label name",
      (s) => ({ ...s, labels: s.labels.map((e, i) => (i === 0 ? { ...e, name: "" } : e)) }),
    ],
  ])("refuses %s", async (_case, corrupt) => {
    const { f, c, snapshot } = await classified();

    expect(refusal(() => validateSnapshot(c, f.products.mojito, corrupt(snapshot)))).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.mojito, reason: "empty_name" },
    });
  });

  it("refuses a chain that names one category twice", async () => {
    const { f, c, snapshot } = await classified();
    const [drinks, alcoholic, cocktails] = snapshot.reporting;

    expect(
      refusal(() =>
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
    [
      "a chain ending in another category",
      (f, s) => ({ ...s, reporting: chain(f, "en", "extras") }),
    ],
  ])("refuses %s", async (_case, corrupt) => {
    const { f, c, snapshot } = await classified();

    expect(
      refusal(() => validateSnapshot(c, f.products.mojito, corrupt(f, snapshot))),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.mojito, reason: "wrong_leaf" },
    });
  });

  it("refuses a chain on an Uncategorised product", async () => {
    const { f, c } = await classified();

    expect(
      refusal(() =>
        validateSnapshot(c, f.products.water, { reporting: chain(f, "en", "extras"), labels: [] }),
      ),
    ).toMatchObject({
      code: "sale_classification.invalid",
      params: { productId: f.products.water, reason: "wrong_leaf" },
    });
  });
});

import { describe, expect, it } from "vitest";
import { filterProductsByDiet, filterProductsByMenu } from "./menu-filter.js";
import type { DietProfile, TillProduct } from "./api/client.js";

/** A minimal sellable product tagged with the menu it came from — only the fields the filter reads. */
function product(id: string, catalogueId?: string): TillProduct {
  return {
    id,
    descriptions: { en: id },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    ...(catalogueId === undefined ? {} : { catalogueId }),
  };
}

describe("filterProductsByMenu", () => {
  const food = product("bocadillo", "cat-food");
  const drink = product("cerveza", "cat-drinks");
  const products = [food, drink];

  it("returns only the selected menu's products", () => {
    expect(filterProductsByMenu(products, "cat-food")).toEqual([food]);
    expect(filterProductsByMenu(products, "cat-drinks")).toEqual([drink]);
  });

  it('returns EVERY product when no menu is selected (the "" fallback)', () => {
    expect(filterProductsByMenu(products, "")).toEqual(products);
  });

  it("returns nothing when the selected menu matches no product (incl. untagged products)", () => {
    expect(filterProductsByMenu([product("misc")], "cat-food")).toEqual([]);
    expect(filterProductsByMenu(products, "cat-missing")).toEqual([]);
  });
});

/** Attach a published diet profile to an otherwise-minimal product (only the fields the filter reads). */
function dietProduct(id: string, diet: DietProfile | null | undefined): TillProduct {
  return { ...product(id), ...(diet === undefined ? {} : { diet }) };
}

describe("filterProductsByDiet", () => {
  const veganProduct = dietProduct("ensalada", {
    vegan: "yes",
    vegetarian: "yes",
    contains: [],
  });
  const vegetarianProduct = dietProduct("tortilla", {
    vegan: "no",
    vegetarian: "yes",
    contains: [],
  });
  const meatProduct = dietProduct("chuleta", {
    vegan: "no",
    vegetarian: "no",
    contains: ["meat"],
  });
  const fishProduct = dietProduct("boquerones", {
    vegan: "no",
    vegetarian: "no",
    contains: ["fish"],
  });
  // An unreviewed dish: diet is cautious "unknown", so it satisfies NO positive filter.
  const unknownProduct = dietProduct("misterio", {
    vegan: "unknown",
    vegetarian: "unknown",
    contains: [],
  });
  const noDietProduct = dietProduct("legacy", null);

  it("filterProductsByDiet('vegan') keeps only vegan-yes products", () => {
    const out = filterProductsByDiet([veganProduct, meatProduct], "vegan");
    expect(out).toEqual([veganProduct]);
  });

  it("filterProductsByDiet('vegetarian') keeps vegetarian-yes (vegan and lacto/ovo) products", () => {
    expect(
      filterProductsByDiet([veganProduct, vegetarianProduct, meatProduct], "vegetarian"),
    ).toEqual([veganProduct, vegetarianProduct]);
  });

  it("filterProductsByDiet('no-meat') drops contains-meat products", () => {
    expect(filterProductsByDiet([veganProduct, meatProduct], "no-meat")).toEqual([veganProduct]);
  });

  it("filterProductsByDiet('no-meat') keeps a contains-fish product (fish is not meat)", () => {
    expect(filterProductsByDiet([fishProduct, meatProduct], "no-meat")).toEqual([fishProduct]);
  });

  it("filterProductsByDiet('no-fish') drops contains-fish products", () => {
    expect(filterProductsByDiet([meatProduct, fishProduct], "no-fish")).toEqual([meatProduct]);
  });

  it("excludes an unknown diet from the cautious vegan/vegetarian filters", () => {
    expect(filterProductsByDiet([unknownProduct], "vegan")).toEqual([]);
    expect(filterProductsByDiet([unknownProduct], "vegetarian")).toEqual([]);
  });

  it("keeps an unknown diet under no-meat/no-fish (contains has not recorded the tag)", () => {
    // Per spec §3.1 these read `contains` (asserted from KNOWN presence); an unreviewed dish whose
    // `contains` is empty is kept — cautiousness is confined to the vegan/vegetarian labels.
    expect(filterProductsByDiet([unknownProduct], "no-meat")).toEqual([unknownProduct]);
    expect(filterProductsByDiet([unknownProduct], "no-fish")).toEqual([unknownProduct]);
  });

  it("drops a null/absent diet from EVERY filter (nothing to assert)", () => {
    for (const p of ["vegan", "vegetarian", "no-meat", "no-fish"] as const) {
      expect(filterProductsByDiet([noDietProduct], p)).toEqual([]);
    }
  });
});

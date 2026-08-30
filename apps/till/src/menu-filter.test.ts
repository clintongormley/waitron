import { describe, expect, it } from "vitest";
import { filterProductsByMenu } from "./menu-filter.js";
import type { TillProduct } from "./api/client.js";

/** A minimal sellable product tagged with the menu it came from — only the fields the filter reads. */
function product(id: string, catalogueId?: string): TillProduct {
  return {
    id,
    descriptions: { "en-GB": id },
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

import { describe, expect, it } from "vitest";
import type { Decimal } from "@waitron/shared";
import type { MenuPriceRow, Setting } from "../api/client.js";
import {
  productInherited,
  sizeClash,
  variantInherited,
  withoutOwn,
} from "./menu-price-inheritance.js";
import { combinedFixture } from "./test-helpers.js";

const range = (low: string, high = low) => ({ state: "price", low, high });
const CLASH = { state: "clash" };

const burger: MenuPriceRow = {
  menuItemId: "mi-burger",
  combined: combinedFixture("p-burger", "12.00", [], null, "12.00", {}),
  productId: "p-burger",
  name: "Burger",
  categoryId: "c-mains",
  placements: [[]],
  productPrice: "12.00",
  override: null,
  effectivePrice: "12.00",
  active: true,
  variants: [],
};
const steak: MenuPriceRow = {
  ...burger,
  menuItemId: "mi-steak",
  combined: combinedFixture("p-steak", "18.00", [], "18.00", "20.00", {}),
  productId: "p-steak",
  name: "Steak",
  productPrice: "20.00",
  override: "18.00",
  effectivePrice: "18.00",
};
const lager: MenuPriceRow = {
  ...burger,
  menuItemId: "mi-lager",
  combined: combinedFixture("p-lager", "2.00", [], null, "2.00", {}),
  productId: "p-lager",
  name: "Lager",
  categoryId: "c-beer",
  productPrice: "2.00",
  effectivePrice: "2.00",
};
const lemonade: MenuPriceRow = {
  menuItemId: "mi-lemonade",
  combined: combinedFixture(
    "p-lemonade",
    "2.50",
    [
      { variantId: "v-small", price: null },
      { variantId: "v-large", price: "3.75" },
    ],
    "2.50",
    "3.00",
    { "v-large": "3.40" },
  ),
  productId: "p-lemonade",
  name: "Lemonade",
  categoryId: "c-drinks",
  placements: [["s-fav"], ["s-drinks"]],
  productPrice: "3.00",
  override: "2.50",
  effectivePrice: "2.50",
  active: true,
  variants: [
    { variantId: "v-small", price: null, active: true },
    { variantId: "v-large", price: "3.75", active: true },
  ],
};
const wine: MenuPriceRow = {
  menuItemId: "mi-wine",
  combined: combinedFixture(
    "p-wine",
    "13.00",
    [
      { variantId: "v-glass", price: "7.00" },
      { variantId: "v-bottle", price: null },
      { variantId: "v-carafe", price: "15.00" },
    ],
    "13.00",
    "10.00",
    { "v-glass": "6.00", "v-bottle": null, "v-carafe": "14.00" },
  ),
  productId: "p-wine",
  name: "Wine",
  categoryId: "c-drinks",
  placements: [["s-drinks"]],
  productPrice: "10.00",
  override: "13.00",
  effectivePrice: "13.00",
  active: true,
  variants: [
    { variantId: "v-glass", price: "7.00", active: true },
    { variantId: "v-bottle", price: null, active: true },
    { variantId: "v-carafe", price: "15.00", active: true },
  ],
};
const juice: MenuPriceRow = {
  menuItemId: "mi-juice",
  combined: combinedFixture(
    "p-juice",
    "4.00",
    [
      { variantId: "v-juice-small", price: "3.50" },
      { variantId: "v-juice-large", price: null },
    ],
    null,
    "4.00",
    { "v-juice-small": "3.00", "v-juice-large": "5.00" },
  ),
  productId: "p-juice",
  name: "Juice",
  categoryId: "c-drinks",
  placements: [["s-fav"]],
  productPrice: "4.00",
  override: null,
  effectivePrice: "4.00",
  active: true,
  variants: [
    { variantId: "v-juice-small", price: "3.50", active: true },
    { variantId: "v-juice-large", price: null, active: true },
  ],
};
const cider: MenuPriceRow = {
  menuItemId: "mi-cider",
  combined: combinedFixture(
    "p-cider",
    "4.00",
    [
      { variantId: "v-pint", price: null },
      { variantId: "v-half", price: null },
    ],
    null,
    "4.00",
    { "v-pint": "4.50", "v-half": null },
  ),
  productId: "p-cider",
  name: "Cider",
  categoryId: "c-beer",
  placements: [["s-drinks", "s-beer"]],
  productPrice: "4.00",
  override: null,
  effectivePrice: "4.00",
  active: true,
  variants: [
    { variantId: "v-pint", price: null, active: true },
    { variantId: "v-half", price: null, active: true },
  ],
};

const clashPrice = {
  state: "clash",
  candidates: [
    { place: { kind: "own_sections" }, value: "3.00", source: { kind: "product" } },
    {
      place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
      value: "3.50",
      source: { kind: "menu", menuId: "drinks", menuName: "Drinks", from: { kind: "own" } },
    },
  ],
} as unknown as Setting<Decimal>;

function withProductClash(row: MenuPriceRow): MenuPriceRow {
  return { ...row, combined: { ...row.combined, price: clashPrice } };
}
/** The size's own setting is a clash at size level. */
function withSizeClash(row: MenuPriceRow, variantId: string): MenuPriceRow {
  return {
    ...row,
    combined: {
      ...row.combined,
      variants: row.combined.variants.map((v) =>
        v.variantId === variantId ? { variantId, price: { ...clashPrice, level: "size" } } : v,
      ),
    },
  };
}
function withInactive(row: MenuPriceRow, ...variantIds: string[]): MenuPriceRow {
  return {
    ...row,
    variants: row.variants.map((v) =>
      variantIds.includes(v.variantId) ? { ...v, active: false } : v,
    ),
  };
}

describe("productInherited", () => {
  it.each([
    ["burger, with no override", burger, range("12.00")],
    ["steak, past its own 18.00", steak, range("20.00")],
    ["lemonade, a following size and a size's own price", lemonade, range("3.00", "3.75")],
    ["wine, counting each size's own price", wine, range("7.00", "15.00")],
    ["juice, a size's own price and a catalogue size price", juice, range("3.50", "5.00")],
    ["cider, a catalogue size price and a following size", cider, range("4.00", "4.50")],
  ])("%s", (_, row, expected) => {
    expect(productInherited(row)).toEqual(expected);
  });

  it("leaves an Inactive size out of the range", () => {
    expect(productInherited(withInactive(lemonade, "v-large"))).toEqual(range("3.00"));
  });

  it("gives the product's own inherited price when it has no Active size", () => {
    const allInactive = withInactive(lemonade, "v-small", "v-large");
    expect(productInherited(allInactive)).toEqual(range("3.00"));
    const noOwn = {
      ...allInactive,
      combined: { ...allInactive.combined, price: withoutOwn(allInactive.combined.price) },
    };
    expect(productInherited(noOwn)).toEqual(range("3.00"));
  });

  it("is a clash when the product's price clashes", () => {
    expect(productInherited(withProductClash(lager))).toEqual(CLASH);
  });

  it("is a clash when an Active size's own price clashes", () => {
    expect(productInherited(withSizeClash(lemonade, "v-small"))).toEqual(CLASH);
  });

  it("leaves an Inactive size's clash off the product", () => {
    const row = withInactive(withSizeClash(lemonade, "v-large"), "v-large");
    expect(productInherited(row)).toEqual(range("3.00"));
    expect(variantInherited(row, "v-large", undefined)).toEqual(CLASH);
  });
});

describe("variantInherited", () => {
  it.each([
    ["the product's saved menu price while its field is untouched", "v-small", undefined, "2.50"],
    ["the price typed in the product's field", "v-small", "2.80", "2.80"],
    ["the product's inherited price once its field is emptied", "v-small", null, "3.00"],
    ["a size's catalogue price, past its own override", "v-large", undefined, "3.40"],
  ] as const)("gives %s", (_, variantId, parent, expected) => {
    expect(variantInherited(lemonade, variantId, parent)).toEqual(range(expected));
  });

  it("is a clash when the size's own setting clashes", () => {
    expect(variantInherited(withSizeClash(lemonade, "v-small"), "v-small", undefined)).toEqual(
      CLASH,
    );
  });

  it("follows a clashing product price until a price is typed for the product", () => {
    const row = withProductClash(lemonade);
    expect(variantInherited(row, "v-small", undefined)).toEqual(CLASH);
    expect(variantInherited(row, "v-small", "2.80")).toEqual(range("2.80"));
  });
});

describe("sizeClash", () => {
  it("is true when an Active size clashes while the product's price is decided", () => {
    expect(sizeClash(withSizeClash(lemonade, "v-small"))).toBe(true);
  });

  it("is false when the clash is the product's own", () => {
    expect(sizeClash(withProductClash(lemonade))).toBe(false);
  });

  it("is false when the clashing size is Inactive", () => {
    expect(sizeClash(withInactive(withSizeClash(lemonade, "v-small"), "v-small"))).toBe(false);
  });

  it("is false when no size clashes", () => {
    expect(sizeClash(lemonade)).toBe(false);
  });
});

describe("withoutOwn", () => {
  it("gives what an own setting overrides", () => {
    expect(withoutOwn(lemonade.combined.price)).toEqual({
      state: "decided",
      value: "3.00",
      source: { kind: "product" },
      otherwise: null,
    });
  });

  it("keeps an own setting with nothing under it", () => {
    const bare: Setting<Decimal> = {
      state: "decided",
      value: "2.50" as Decimal,
      source: { kind: "own" },
      otherwise: null,
    };
    expect(withoutOwn(bare)).toBe(bare);
  });

  it("keeps a size that follows its product, with its product's saved price", () => {
    const following = lemonade.combined.variants[0]!.price;
    expect(following).toMatchObject({ value: "2.50", source: { kind: "parent" } });
    expect(withoutOwn(following)).toBe(following);
  });

  it("keeps a setting from the catalogue", () => {
    expect(withoutOwn(burger.combined.price)).toBe(burger.combined.price);
  });

  it("keeps a clash", () => {
    expect(withoutOwn(clashPrice)).toBe(clashPrice);
  });
});

import { describe, expect, it } from "vitest";
import type { Decimal } from "@waitron/shared";
import { combineOffer } from "@waitron/catalogue/src/menu-combine.js";
import type { MenuPriceRow, Setting } from "../api/client.js";
import {
  productInherited,
  sizeClash,
  sizesInheritedFrom,
  variantInherited,
  variantInheritedFrom,
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
  override: "18.00",
  effectivePrice: "18.00",
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
  override: null,
  effectivePrice: "4.00",
  active: true,
  variants: [
    { variantId: "v-pint", price: null, active: true },
    { variantId: "v-half", price: null, active: true },
  ],
};

interface OwnPrices {
  price?: string;
  variants?: Record<string, string>;
}
const d = (value: string) => value as Decimal;

/** The clash rows come from the real `combineOffer`: this menu places the product in its own
 * sections at its catalogue prices and includes a Drinks menu that sets `drinks` itself. */
function combined(
  productId: string,
  catalogue: { price: string; variants: Record<string, string | null> },
  lunch: OwnPrices,
  drinks: OwnPrices,
): MenuPriceRow["combined"] {
  const ids = Object.keys(catalogue.variants);
  const prices = (price: string | null | undefined) => (price == null ? null : d(price));
  const offer = (own: OwnPrices, included: Parameters<typeof combineOffer>[0]["included"]) =>
    combineOffer({
      productId,
      catalogue: {
        price: d(catalogue.price),
        variants: ids.map((variantId) => ({
          variantId,
          price: prices(catalogue.variants[variantId]),
        })),
      },
      own: {
        price: prices(own.price),
        variants: ids.map((variantId) => ({ variantId, price: prices(own.variants?.[variantId]) })),
      },
      placedInOwnSections: true,
      included,
    });
  return offer(lunch, [{ menuId: "drinks", menuName: "Drinks", offer: offer(drinks, []) }]);
}
const lemonadeCatalogue = { price: "3.00", variants: { "v-small": null, "v-large": "3.40" } };
const lemonadeOn = (lunch: OwnPrices, drinks: OwnPrices): MenuPriceRow => ({
  ...lemonade,
  combined: combined("p-lemonade", lemonadeCatalogue, lunch, drinks),
});

const lagerClash: MenuPriceRow = {
  ...burger,
  menuItemId: "mi-lager",
  combined: combined("p-lager", { price: "2.00", variants: {} }, {}, { price: "2.50" }),
  productId: "p-lager",
  name: "Lager",
};
/** The product's price clashes (3.00 here, 3.50 on Drinks); Small follows it, Large is 3.40 on both. */
const productClash = lemonadeOn({}, { price: "3.50" });
/** This menu's own 2.50 sits over that clash. */
const ownOverClash = lemonadeOn({ price: "2.50" }, { price: "3.50" });
/** Small's own 2.20 sits over that clash. */
const sizeOwnOverClash = lemonadeOn({ variants: { "v-small": "2.20" } }, { price: "3.50" });
/** Small's own 2.20 sits over its product's own 2.50. */
const sizeOwnOverParent = lemonadeOn({ price: "2.50", variants: { "v-small": "2.20" } }, {});
/** Large's own price clashes (3.40 here, 3.90 on Drinks); the product's price is decided. */
const sizeLevelClash = lemonadeOn({ price: "2.50" }, { variants: { "v-large": "3.90" } });

const sizeOf = (row: MenuPriceRow, variantId: string) =>
  row.combined.variants.find((v) => v.variantId === variantId)!.price;

function withInactive(row: MenuPriceRow, ...variantIds: string[]): MenuPriceRow {
  return {
    ...row,
    variants: row.variants.map((v) =>
      variantIds.includes(v.variantId) ? { ...v, active: false } : v,
    ),
  };
}

describe("the clash rows", () => {
  it("have the shapes combineOffer gives", () => {
    expect(lagerClash.combined.price.state).toBe("clash");
    expect(productClash.combined.price.state).toBe("clash");
    expect(sizeOf(productClash, "v-small")).toMatchObject({ state: "clash", level: "product" });
    expect(sizeOf(productClash, "v-large")).toMatchObject({ state: "decided", value: "3.40" });
    expect(ownOverClash.combined.price).toMatchObject({
      state: "decided",
      value: "2.50",
      source: { kind: "own" },
      otherwise: { state: "clash" },
    });
    expect(sizeOf(sizeOwnOverClash, "v-small")).toMatchObject({
      state: "decided",
      value: "2.20",
      source: { kind: "own" },
      otherwise: { state: "clash" },
      level: "size",
    });
    expect(sizeOf(sizeOwnOverParent, "v-small")).toMatchObject({
      value: "2.20",
      source: { kind: "own" },
      otherwise: { state: "decided", value: "2.50", source: { kind: "parent" } },
      level: "size",
    });
    expect(sizeLevelClash.combined.price.state).toBe("decided");
    expect(sizeOf(sizeLevelClash, "v-large")).toMatchObject({ state: "clash", level: "size" });
  });
});

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

  it("is a clash when a product without sizes clashes", () => {
    expect(productInherited(lagerClash)).toEqual(CLASH);
  });

  it("is a clash when the product's price clashes and a size follows it", () => {
    expect(productInherited(productClash)).toEqual(CLASH);
  });

  it("is a clash when this menu's own price sits over a clash", () => {
    expect(productInherited(ownOverClash)).toEqual(CLASH);
  });

  it("counts a size's own price over a clashing product", () => {
    expect(productInherited(sizeOwnOverClash)).toEqual(range("2.20", "3.40"));
  });

  it("is a clash when an Active size's own price clashes", () => {
    expect(productInherited(sizeLevelClash)).toEqual(CLASH);
  });

  it("leaves an Inactive size's clash off the product", () => {
    const row = withInactive(sizeLevelClash, "v-large");
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
    expect(variantInherited(sizeLevelClash, "v-large", undefined)).toEqual(CLASH);
  });

  it("follows a clashing product price until a price is typed for the product", () => {
    expect(variantInherited(productClash, "v-small", "2.80")).toEqual(range("2.80"));
    expect(variantInherited(productClash, "v-small", undefined)).toEqual(CLASH);
    expect(variantInherited(productClash, "v-small", null)).toEqual(CLASH);
  });

  it("follows the product's own price over a clash until it is emptied", () => {
    expect(variantInherited(ownOverClash, "v-small", undefined)).toEqual(range("2.50"));
    expect(variantInherited(ownOverClash, "v-small", null)).toEqual(CLASH);
  });

  it("past a size's own price, follows its product", () => {
    expect(variantInherited(sizeOwnOverParent, "v-small", undefined)).toEqual(range("2.50"));
    expect(variantInherited(sizeOwnOverParent, "v-small", "2.80")).toEqual(range("2.80"));
    expect(variantInherited(sizeOwnOverParent, "v-small", null)).toEqual(range("3.00"));
  });

  it("past a size's own price over its product's clash, follows the price typed for the product", () => {
    expect(variantInherited(sizeOwnOverClash, "v-small", "2.80")).toEqual(range("2.80"));
    expect(variantInherited(sizeOwnOverClash, "v-small", undefined)).toEqual(CLASH);
    expect(variantInherited(sizeOwnOverClash, "v-small", null)).toEqual(CLASH);
    // What the menu charges once 2.80 is saved for the product and Small's own price cleared.
    expect(sizeOf(lemonadeOn({ price: "2.80" }, { price: "3.50" }), "v-small")).toMatchObject({
      state: "decided",
      value: "2.80",
      source: { kind: "parent" },
    });
  });

  it("past a size's own price over the size's own clash, stays a clash whatever the product's field holds", () => {
    const drinks = { price: "3.50", variants: { "v-large": "3.90" } };
    const row = lemonadeOn({ variants: { "v-large": "3.60" } }, drinks);
    expect(variantInherited(row, "v-large", "2.80")).toEqual(CLASH);
    expect(variantInherited(row, "v-large", undefined)).toEqual(CLASH);
    expect(sizeOf(lemonadeOn({ price: "2.80" }, drinks), "v-large")).toMatchObject({
      state: "clash",
      level: "size",
    });
  });
});

describe("variantInheritedFrom", () => {
  it("gives a following size the product's price as its field reads now", () => {
    expect(variantInheritedFrom(lemonade, "v-small", undefined)).toEqual({
      setting: lemonade.combined.price,
      follows: true,
    });
    expect(variantInheritedFrom(lemonade, "v-small", null)).toEqual({
      setting: withoutOwn(lemonade.combined.price),
      follows: true,
    });
    expect(variantInheritedFrom(lemonade, "v-small", "2.80")).toEqual({
      setting: {
        state: "decided",
        value: "2.80",
        source: { kind: "own" },
        otherwise: withoutOwn(lemonade.combined.price),
      },
      follows: true,
    });
  });

  it("gives a size that does not follow its product its setting past its own override", () => {
    expect(variantInheritedFrom(lemonade, "v-large", undefined)).toEqual({
      setting: withoutOwn(sizeOf(lemonade, "v-large")),
      follows: false,
    });
    expect(variantInheritedFrom(sizeLevelClash, "v-large", "2.80")).toEqual({
      setting: sizeOf(sizeLevelClash, "v-large"),
      follows: false,
    });
  });

  it("gives a size with its own price over its product's clash that clash, following the product", () => {
    expect(variantInheritedFrom(sizeOwnOverClash, "v-small", undefined)).toEqual({
      setting: sizeOwnOverClash.combined.price,
      follows: true,
    });
  });

  it("gives a size following a clashing product the clash", () => {
    expect(variantInheritedFrom(productClash, "v-small", undefined)).toEqual({
      setting: productClash.combined.price,
      follows: true,
    });
  });
});

describe("sizesInheritedFrom", () => {
  it("gives each Active size its own price on this menu, else the setting it inherits with the product left blank", () => {
    expect(sizesInheritedFrom(withInactive(wine, "v-carafe"))).toEqual([
      { variantId: "v-glass", setting: sizeOf(wine, "v-glass"), follows: false },
      { variantId: "v-bottle", setting: withoutOwn(wine.combined.price), follows: true },
    ]);
  });

  it("is empty for a product with no Active size", () => {
    expect(sizesInheritedFrom(withInactive(lemonade, "v-small", "v-large"))).toEqual([]);
  });
});

describe("sizeClash", () => {
  it("is true when an Active size clashes while the product's price is decided", () => {
    expect(sizeClash(sizeLevelClash)).toBe(true);
  });

  it("is false when the clash is the product's own, carried by a size that follows it", () => {
    expect(sizeClash(productClash)).toBe(false);
  });

  it("is true when an Active size clashes at size level and no Active size follows the product's clash", () => {
    const both = lemonadeOn({}, { price: "3.50", variants: { "v-large": "3.90" } });
    expect(both.combined.price.state).toBe("clash");
    expect(sizeClash(withInactive(both, "v-small"))).toBe(true);
    expect(sizeClash(both)).toBe(false);
  });

  it("is false when the clashing size is Inactive", () => {
    expect(sizeClash(withInactive(sizeLevelClash, "v-large"))).toBe(false);
  });

  it("is false when no size clashes", () => {
    expect(sizeClash(lemonade)).toBe(false);
  });

  it("counts a price typed for a clashing product as deciding it, past an emptied one", () => {
    const drinks = { price: "3.50", variants: { "v-large": "3.90" } };
    const row = lemonadeOn({}, drinks);
    expect(sizeClash(row)).toBe(false);
    expect(sizeClash(row, "2.80")).toBe(true);
    expect(sizeClash(row, null)).toBe(false);
    expect(sizeClash(lemonadeOn({ price: "2.80" }, drinks))).toBe(true);
    expect(sizeClash(lemonadeOn({ price: "2.80" }, drinks), null)).toBe(false);
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
      value: d("2.50"),
      source: { kind: "own" },
      otherwise: null,
    };
    expect(withoutOwn(bare)).toBe(bare);
  });

  it("keeps a size that follows its product, with its product's saved price", () => {
    const following = sizeOf(lemonade, "v-small");
    expect(following).toMatchObject({ value: "2.50", source: { kind: "parent" } });
    expect(withoutOwn(following)).toBe(following);
  });

  it("keeps a setting from the catalogue", () => {
    expect(withoutOwn(burger.combined.price)).toBe(burger.combined.price);
  });

  it("keeps a clash", () => {
    expect(withoutOwn(productClash.combined.price)).toBe(productClash.combined.price);
  });
});

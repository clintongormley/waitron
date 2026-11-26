import { describe, expect, it } from "vitest";
import type { Decimal } from "@waitron/shared";
import { combineOffer } from "@waitron/menu/src/menu-combine.js";
import type { MenuPriceRow, Setting } from "../api/client.js";
import {
  productInherited,
  variantClash,
  variantsInheritedFrom,
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
  available: true,
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
  available: true,
  variants: [
    { variantId: "v-small", price: null, available: true },
    { variantId: "v-large", price: "3.75", available: true },
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
  available: true,
  variants: [
    { variantId: "v-glass", price: "7.00", available: true },
    { variantId: "v-bottle", price: null, available: true },
    { variantId: "v-carafe", price: "15.00", available: true },
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
  available: true,
  variants: [
    { variantId: "v-juice-small", price: "3.50", available: true },
    { variantId: "v-juice-large", price: null, available: true },
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
  available: true,
  variants: [
    { variantId: "v-pint", price: null, available: true },
    { variantId: "v-half", price: null, available: true },
  ],
};

interface OwnPrices {
  price?: string;
  variants?: Record<string, string>;
}
const d = (value: string) => value as Decimal;

/** The clash rows come from the real `combineOffer`: this menu places the product in its own
 * sections at its menu prices and includes a Drinks menu that sets `drinks` itself. */
function combined(
  productId: string,
  product: { price: string; variants: Record<string, string | null> },
  lunch: OwnPrices,
  drinks: OwnPrices,
): MenuPriceRow["combined"] {
  const ids = Object.keys(product.variants);
  const prices = (price: string | null | undefined) => (price == null ? null : d(price));
  const offer = (own: OwnPrices, included: Parameters<typeof combineOffer>[0]["included"]) =>
    combineOffer({
      productId,
      product: {
        price: d(product.price),
        variants: ids.map((variantId) => ({
          variantId,
          price: prices(product.variants[variantId]),
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
const lemonadeMenu = { price: "3.00", variants: { "v-small": null, "v-large": "3.40" } };
const lemonadeOn = (lunch: OwnPrices, drinks: OwnPrices): MenuPriceRow => ({
  ...lemonade,
  combined: combined("p-lemonade", lemonadeMenu, lunch, drinks),
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
const variantOwnOverClash = lemonadeOn({ variants: { "v-small": "2.20" } }, { price: "3.50" });
/** Small's own 2.20 sits over its product's own 2.50. */
const variantOwnOverParent = lemonadeOn({ price: "2.50", variants: { "v-small": "2.20" } }, {});
/** Large's own price clashes (3.40 here, 3.90 on Drinks); the product's price is decided. */
const variantLevelClash = lemonadeOn({ price: "2.50" }, { variants: { "v-large": "3.90" } });

const variantOf = (row: MenuPriceRow, variantId: string) =>
  row.combined.variants.find((v) => v.variantId === variantId)!.price;

describe("the clash rows", () => {
  it("have the shapes combineOffer gives", () => {
    expect(lagerClash.combined.price.state).toBe("clash");
    expect(productClash.combined.price.state).toBe("clash");
    expect(variantOf(productClash, "v-small")).toMatchObject({ state: "clash", level: "product" });
    expect(variantOf(productClash, "v-large")).toMatchObject({ state: "decided", value: "3.40" });
    expect(ownOverClash.combined.price).toMatchObject({
      state: "decided",
      value: "2.50",
      source: { kind: "own" },
      otherwise: { state: "clash" },
    });
    expect(variantOf(variantOwnOverClash, "v-small")).toMatchObject({
      state: "decided",
      value: "2.20",
      source: { kind: "own" },
      otherwise: { state: "clash" },
      level: "variant",
    });
    expect(variantOf(variantOwnOverParent, "v-small")).toMatchObject({
      value: "2.20",
      source: { kind: "own" },
      otherwise: { state: "decided", value: "2.50", source: { kind: "parent" } },
      level: "variant",
    });
    expect(variantLevelClash.combined.price.state).toBe("decided");
    expect(variantOf(variantLevelClash, "v-large")).toMatchObject({
      state: "clash",
      level: "variant",
    });
  });
});

describe("productInherited", () => {
  it.each([
    ["burger, with no override", burger, range("12.00")],
    ["steak, past its own 18.00", steak, range("20.00")],
    ["lemonade, a following variant and a variant's own price", lemonade, range("3.00", "3.75")],
    ["wine, counting each variant's own price", wine, range("7.00", "15.00")],
    ["juice, a variant's own price and a menu variant price", juice, range("3.50", "5.00")],
    ["cider, a menu variant price and a following variant", cider, range("4.00", "4.50")],
  ])("%s", (_, row, expected) => {
    expect(productInherited(row)).toEqual(expected);
  });

  it("is a clash when a product without variants clashes", () => {
    expect(productInherited(lagerClash)).toEqual(CLASH);
  });

  it("is a clash when the product's price clashes and a variant follows it", () => {
    expect(productInherited(productClash)).toEqual(CLASH);
  });

  it("is a clash when this menu's own price sits over a clash", () => {
    expect(productInherited(ownOverClash)).toEqual(CLASH);
  });

  it("counts a variant's own price over a clashing product", () => {
    expect(productInherited(variantOwnOverClash)).toEqual(range("2.20", "3.40"));
  });

  it("is a clash when a variant's own price clashes", () => {
    expect(productInherited(variantLevelClash)).toEqual(CLASH);
  });
});

describe("variantInherited", () => {
  it.each([
    ["the product's saved menu price", "v-small", "2.50"],
    ["a variant's menu price, past its own override", "v-large", "3.40"],
  ] as const)("gives %s", (_, variantId, expected) => {
    expect(variantInherited(lemonade, variantId)).toEqual(range(expected));
  });

  it("is a clash when the variant's own setting clashes", () => {
    expect(variantInherited(variantLevelClash, "v-large")).toEqual(CLASH);
  });

  it("past a variant's own price, follows its product", () => {
    expect(variantInherited(variantOwnOverParent, "v-small")).toEqual(range("2.50"));
  });
});

describe("variantInheritedFrom", () => {
  it("gives a following variant the product's price", () => {
    expect(variantInheritedFrom(lemonade, "v-small")).toEqual(lemonade.combined.price);
  });

  it("gives a variant that does not follow its product its setting past its own override", () => {
    expect(variantInheritedFrom(lemonade, "v-large")).toEqual(
      withoutOwn(variantOf(lemonade, "v-large")),
    );
    expect(variantInheritedFrom(variantLevelClash, "v-large")).toEqual(
      variantOf(variantLevelClash, "v-large"),
    );
  });

  it("gives a variant with its own price over its product's clash that clash, following the product", () => {
    expect(variantInheritedFrom(variantOwnOverClash, "v-small")).toEqual(
      variantOwnOverClash.combined.price,
    );
  });

  it("gives a variant following a clashing product the clash", () => {
    expect(variantInheritedFrom(productClash, "v-small")).toEqual(productClash.combined.price);
  });
});

describe("variantsInheritedFrom", () => {
  it("gives each variant its own price on this menu, else the setting it inherits with the product left blank", () => {
    expect(variantsInheritedFrom(wine)).toEqual([
      variantOf(wine, "v-glass"),
      withoutOwn(wine.combined.price),
      variantOf(wine, "v-carafe"),
    ]);
  });
});

describe("variantClash", () => {
  it("is true when a variant clashes at variant level", () => {
    expect(variantClash(variantLevelClash)).toBe(true);
  });

  it("is false when the clash is the product's own, carried by a variant that follows it", () => {
    expect(variantClash(productClash)).toBe(false);
  });

  it("is false when no variant clashes", () => {
    expect(variantClash(lemonade)).toBe(false);
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

  it("keeps a variant that follows its product, with its product's saved price", () => {
    const following = variantOf(lemonade, "v-small");
    expect(following).toMatchObject({ value: "2.50", source: { kind: "parent" } });
    expect(withoutOwn(following)).toBe(following);
  });

  it("keeps a setting from the menu", () => {
    expect(withoutOwn(burger.combined.price)).toBe(burger.combined.price);
  });

  it("keeps a clash", () => {
    expect(withoutOwn(productClash.combined.price)).toBe(productClash.combined.price);
  });
});

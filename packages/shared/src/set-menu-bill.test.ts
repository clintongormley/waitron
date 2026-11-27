import { describe, expect, it } from "vitest";

import type {
  FrozenExtraItem,
  FrozenOfferedModifier,
  MenuOfferVariant,
  PublishedSetMenu,
  ServedSetMenuCopy,
  ServedSetMenuOffer,
  SetMenuFrozenOffer,
  SetMenuOfferVariant,
} from "./index.js";
import * as shared from "./index.js";

const portion: ServedSetMenuOffer["unit"] = {
  id: "each",
  staffName: "Each",
  staffAbbreviation: "ea",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(
  productId: string,
  countsAsCourseId: string | null,
  unitPrice = "0.00",
): ServedSetMenuOffer {
  return {
    id: `item-${productId}`,
    menuId: "daily",
    grossPrice: unitPrice,
    productId,
    countsAsCourseId,
    unitPrice,
    courseId: "sending-course",
    menuName: "Daily menu",
    placements: [[]],
    name: productId,
    customerName: null,
    kitchenName: null,
    unit: portion,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
    category: null,
    allergens: null,
    diet: null,
    dietOverride: null,
    dietaryDeclarations: [],
    offeredModifiers: [],
    variants: [],
    variantCountsAs: {},
    available: true,
    image: null,
    description: null,
  };
}

const glass: MenuOfferVariant = {
  id: "glass",
  name: "Glass",
  customerName: null,
  kitchenName: null,
  image: null,
  unitPrice: "1.50",
  menuPrice: "1.50",
  available: true,
  unit: portion,
  pricingUnit: "each",
  vatClass: "general",
  takeawayVatClass: "general",
  category: null,
  allergens: null,
  diet: null,
  dietOverride: null,
  dietaryDeclarations: [],
  courseId: "sending-course",
};

function daily(offers: ServedSetMenuOffer[]): ServedSetMenuCopy {
  return {
    key: "daily:published",
    menuId: "daily",
    name: "Daily menu",
    terms: {
      price: "14.00",
      names: { en: "Daily menu" },
      lines: [
        { id: "first", count: 1, courseIds: ["starters"] },
        { id: "second", count: 1, courseIds: ["mains"] },
        { id: "third", count: 1, courseIds: ["drinks"] },
      ],
    },
    changedAt: "2026-11-19T00:00:00Z",
    structure: { members: [] },
    offers,
  };
}

describe("set-menu copies", () => {
  it("uses the published surcharge and counting course for each dish and kept variant", () => {
    const wine = {
      ...offer("wine", "starters"),
      variants: [glass],
      variantCountsAs: { glass: "drinks" },
    };
    const copy = daily([offer("soup", "starters"), offer("sirloin", "mains", "5.00"), wine]);
    expect(shared.setMenuOfferOf(copy)).toEqual({
      id: "daily:published",
      priceCents: 1400,
      lines: copy.terms.lines,
      dishes: [
        { productId: "soup", variantId: null, countsAsCourseId: "starters", surchargeCents: 0 },
        { productId: "sirloin", variantId: null, countsAsCourseId: "mains", surchargeCents: 500 },
        { productId: "wine", variantId: "glass", countsAsCourseId: "drinks", surchargeCents: 150 },
      ],
    });
  });

  it("omits dishes sold in a unit that measures an amount", () => {
    const fish = offer("fish", "mains");
    fish.unit = { ...portion, id: "kg", measure: true, hardwareUnit: "kg", precision: 3 };
    expect(shared.setMenuOfferOf(daily([fish, offer("soup", "starters")])).dishes).toEqual([
      { productId: "soup", variantId: null, countsAsCourseId: "starters", surchargeCents: 0 },
    ]);
  });

  it("carries the published identity and version used by the bill, and no VAT terms", () => {
    const copy = shared.setMenuCopyOf(daily([]), "version-2");
    expect(copy).toMatchObject({
      id: "daily:published",
      setMenuId: "daily",
      versionId: "version-2",
      name: "Daily menu",
    });
    expect(copy).not.toHaveProperty("terms");
  });

  it("lists copies by both product and variant", () => {
    const wine = {
      ...offer("wine", null),
      variants: [glass],
      variantCountsAs: { glass: "drinks" },
    };
    const copies = [
      shared.setMenuCopyOf(daily([wine]), "version-1"),
      shared.setMenuCopyOf(
        { ...daily([offer("wine", "drinks")]), key: "daily:other" },
        "version-2",
      ),
    ];
    expect(shared.copiesListing(copies, "wine", "glass").map(({ id }) => id)).toEqual([
      "daily:published",
    ]);
    expect(shared.copiesListing(copies, "wine", null).map(({ id }) => id)).toEqual(["daily:other"]);
    expect(shared.copiesListing(copies, "juice", "glass")).toEqual([]);
  });

  it("records the version a menu selling now holds, else the copy's first", () => {
    const versionIds = ["version-1", "version-2", "version-3"];
    expect(shared.newBillVersionOf(versionIds, new Set(["version-3", "version-2"]))).toBe(
      "version-2",
    );
    expect(shared.newBillVersionOf(versionIds, new Set(["other"]))).toBe("version-1");
    expect(shared.newBillVersionOf(versionIds, undefined)).toBe("version-1");
    expect(shared.newBillVersionOf([], new Set(["version-1"]))).toBeUndefined();
  });
});

it("does not offer a plain dish when none of its published variants can be served", () => {
  const wine = { ...offer("wine", "starters"), variantCountsAs: { glass: "drinks" } };
  expect(shared.setMenuOfferOf(daily([wine])).dishes).toEqual([]);
});

describe("the products a published set menu can hold", () => {
  function dish(
    productId: string,
    countsAsCourseId: string | null,
    rest: Partial<SetMenuFrozenOffer> = {},
  ): SetMenuFrozenOffer {
    return {
      ...offer(productId, countsAsCourseId),
      variants: [],
      offeredModifiers: [],
      ...rest,
    };
  }

  function variant(id: string, countsAsCourseId: string): SetMenuOfferVariant {
    return { ...glass, id, name: id, countsAsCourseId };
  }

  function extra(productId: string): FrozenExtraItem {
    return {
      productId,
      presentation: {
        name: productId,
        customerName: null,
        kitchenName: null,
        variantName: null,
        variantCustomerName: null,
        variantKitchenName: null,
      },
      portion: "1.000",
      unit: portion,
      name: productId,
      customerName: null,
      kitchenName: null,
      price: "1.00",
      vatClass: "general",
      takeawayVatClass: "general",
      addAllergens: {},
      suitableFor: [],
      maxQuantity: null,
      preselected: false,
      image: null,
    };
  }

  function extras(...productIds: string[]): FrozenOfferedModifier {
    return {
      kind: "extras",
      id: "extras",
      name: "Extras",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      items: productIds.map(extra),
    };
  }

  const cooking: FrozenOfferedModifier = {
    kind: "options",
    id: "cooking",
    name: "Cooking",
    customerName: null,
    kitchenName: null,
    defaultLabelId: "rare",
    labels: [{ id: "rare", name: "Rare", customerName: null, kitchenName: null }],
  };

  function published(...offers: SetMenuFrozenOffer[]): PublishedSetMenu {
    const { name, terms, changedAt } = daily([]);
    return {
      name,
      terms,
      courses: {},
      changedAt,
      root: { members: [] },
      offers: Object.fromEntries(offers.map((each, index) => [`item-${index}`, each])),
    };
  }

  const held = (...offers: SetMenuFrozenOffer[]) => shared.setMenuProductIds(published(...offers));

  it("holds each dish a line accepts and the extras it offers", () => {
    expect(
      held(
        dish("soup", "starters"),
        dish("hake", "mains", { offeredModifiers: [extras("sauce", "lemon"), extras("bread")] }),
      ),
    ).toEqual(["soup", "hake", "sauce", "lemon", "bread"]);
  });

  it("leaves out a dish whose course no line accepts, and its extras", () => {
    expect(
      held(
        dish("soup", "starters"),
        dish("flan", "desserts", { offeredModifiers: [extras("cream")] }),
      ),
    ).toEqual(["soup"]);
  });

  it("leaves out a dish with no course", () => {
    expect(held(dish("soup", null))).toEqual([]);
  });

  it("holds the accepted variants of a dish, not the dish, with the extras it offers", () => {
    expect(
      held(
        dish("wine", "drinks", {
          variants: [variant("glass", "drinks"), variant("bottle", "bar")],
          offeredModifiers: [extras("ice")],
        }),
      ),
    ).toEqual(["glass", "ice"]);
  });

  it("leaves out a dish none of whose variants a line accepts, and its extras", () => {
    expect(
      held(
        dish("wine", "drinks", {
          variants: [variant("bottle", "bar")],
          offeredModifiers: [extras("ice")],
        }),
      ),
    ).toEqual([]);
  });

  it("takes nothing from an options list", () => {
    expect(held(dish("sirloin", "mains", { offeredModifiers: [cooking] }))).toEqual(["sirloin"]);
  });

  it("leaves out a dish sold by measure, with its variants and extras", () => {
    const unit: SetMenuFrozenOffer["unit"] = { ...portion, id: "kg", measure: true };
    expect(
      held(
        dish("soup", "starters"),
        dish("fish", "mains", { unit, offeredModifiers: [extras("sauce")] }),
        dish("ham", "starters", { unit, variants: [variant("cured", "starters")] }),
      ),
    ).toEqual(["soup"]);
  });

  it("names a product once however many times it can be had", () => {
    const bread = extras("bread");
    expect(
      held(
        dish("soup", "starters", { offeredModifiers: [bread] }),
        dish("soup", "mains", { offeredModifiers: [bread] }),
        dish("bread", "starters"),
      ),
    ).toEqual(["soup", "bread"]);
  });
});

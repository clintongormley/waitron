import { describe, expect, it } from "vitest";
import { asServedDiet, asServedAllergens } from "./as-served.js";
import type { OrderLine } from "./working-order.js";
import type { DietDerivation, DietOverride, OfferedExtraItem, TillProduct } from "../api/client.js";

/** Its three names are DIFFERENT. */
function item(productId: string): OfferedExtraItem {
  return {
    productId,
    name: productId,
    customerName: { en: `${productId} for the customer` },
    kitchenName: `${productId} KDS`,
    price: "0.00",
    vatClass: "general",
    maxQuantity: 1,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
  };
}

/** A product offering one extras list of `items`, a diet derivation and an optional override. */
function product(
  derivation: DietDerivation | null,
  items: OfferedExtraItem[],
  override?: DietOverride | null,
): TillProduct {
  return {
    id: "dish",
    name: "dish",
    customerName: { en: "dish for the customer" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    dietDerivation: derivation,
    ...(override === undefined ? {} : { dietOverride: override }),
    offeredModifiers: [
      {
        kind: "extras",
        id: "list",
        name: "Extras",
        customerName: { en: "Extras for the customer" },
        kitchenName: "Extras KDS",
        minPicks: 0,
        maxPicks: null,
        items,
      },
    ],
  };
}

/** A pick never changes the line's diet or allergens: each dish shows its OWN figures. */
function line(prod: TillProduct, ...pickedProductIds: string[]): OrderLine {
  return {
    product: prod,
    quantity: "1",
    ...(pickedProductIds.length === 0
      ? {}
      : {
          extras: pickedProductIds.map((productId) => ({
            listId: "list",
            productId,
            name: productId,
            price: "0.00",
            quantity: 1,
          })),
        }),
  };
}

describe("asServedDiet — the dish's own diet, no modifier fold", () => {
  it("shows the dish's own direct declarations, ignoring a selected invalidating extra", () => {
    // A selected bacon extra must NOT change the DISH's own declared claims.
    const prod = product(null, []);
    prod.dietaryDeclarations = ["vegan", "halal"];
    prod.offeredModifiers = [
      {
        kind: "extras",
        id: "list",
        name: "Extras",
        customerName: { en: "Extras for the customer" },
        kitchenName: "Extras KDS",
        minPicks: 0,
        maxPicks: null,
        items: [{ ...item("bacon"), suitableFor: ["halal"] }],
      },
    ];
    const own = { vegan: "yes", vegetarian: "yes", halal: "yes" };
    expect(asServedDiet(line(prod))).toMatchObject(own);
    expect(asServedDiet(line(prod, "bacon"))).toMatchObject(own);
  });

  it("shows the dish's own derived diet, ignoring a no-cheese extra", () => {
    // Base plant + dairy, reviewed ⇒ vegetarian but NOT vegan; the extra changes nothing.
    const prod = product({ origins: ["plant", "dairy"], pending: false }, [item("no-cheese")]);
    expect(asServedDiet(line(prod)).vegan).toBe("no");
    expect(asServedDiet(line(prod, "no-cheese")).vegan).toBe("no");
  });

  it("shows the dish's own vegan diet, ignoring an add-meat extra", () => {
    const prod = product({ origins: ["plant"], pending: false }, [item("add-bacon")]);
    const asServed = asServedDiet(line(prod, "add-bacon"));
    expect(asServed.vegan).toBe("yes");
    expect(asServed.vegetarian).toBe("yes");
    expect(asServed.contains).toEqual([]);
  });

  it("a pending derivation reads unknown (never a positive claim), extra or no extra", () => {
    const prod = product({ origins: ["plant", "dairy"], pending: true }, [item("no-cheese")]);
    const asServed = asServedDiet(line(prod, "no-cheese"));
    expect(asServed.vegan).toBe("unknown");
    expect(asServed.vegetarian).toBe("unknown");
  });

  it("a null derivation reads unknown (an unreviewed dish)", () => {
    const prod = product(null, []);
    const asServed = asServedDiet(line(prod));
    expect(asServed.vegan).toBe("unknown");
    expect(asServed.vegetarian).toBe("unknown");
  });

  it("re-applies the staff override to the dish's own derivation", () => {
    // Base plant-only (would be vegan), but the owner forces vegan:"no" and sets halal.
    const prod = product({ origins: ["plant"], pending: false }, [], {
      vegan: "no",
      halal: "yes",
    });
    const asServed = asServedDiet(line(prod));
    expect(asServed.vegan).toBe("no");
    expect(asServed.halal).toBe("yes");
  });

  it("a forced-vegan dish reads its own vegan:'yes'; a selected add-meat extra does not change it", () => {
    // The owner forces vegan:"yes" on the DISH; the extra's meat does not cap it.
    const prod = product({ origins: ["plant"], pending: false }, [item("add-bacon")]);
    prod.dietOverride = { vegan: "yes" };
    expect(asServedDiet(line(prod)).vegan).toBe("yes");
    const asServed = asServedDiet(line(prod, "add-bacon"));
    expect(asServed.vegan).toBe("yes");
    expect(asServed.contains).toEqual([]);
  });

  it("a line whose dish offers nothing at all still derives the dish's own diet", () => {
    const prod: TillProduct = {
      id: "dish",
      name: "dish",
      customerName: { en: "dish for the customer" },
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
      category: null,
      allergens: null,
      dietDerivation: { origins: ["plant"], pending: false },
    };
    expect(asServedDiet({ product: prod, quantity: "1" }).vegan).toBe("yes");
  });
});

it("shows the dish's own allergens, ignoring a selected extra that used to add one", () => {
  const prod = product({ origins: ["plant"], pending: false }, []);
  prod.allergens = { gluten: { presence: "contains" } };
  prod.offeredModifiers = [
    {
      kind: "extras",
      id: "list",
      name: "Extras",
      customerName: { en: "Extras for the customer" },
      kitchenName: "Extras KDS",
      minPicks: 0,
      maxPicks: null,
      items: [{ ...item("cheese"), addAllergens: { milk: { presence: "contains" } } }],
    },
  ];
  expect(Object.keys(asServedAllergens(line(prod, "cheese")).allergens).sort()).toEqual(["gluten"]);
});

it("the dish's own allergens and diet ignore a canonical extras selection", () => {
  const prod = product({ origins: ["plant"], pending: false }, []);
  prod.allergens = {};
  prod.offeredModifiers = [
    {
      kind: "extras",
      id: "list",
      name: "Extras",
      customerName: { en: "Extras for the customer" },
      kitchenName: "Extras KDS",
      minPicks: 0,
      maxPicks: null,
      items: [{ ...item("bacon"), addAllergens: { milk: { presence: "contains" } } }],
    },
  ];
  const selected = line(prod, "bacon");
  // The selected bacon extra's meat and milk are never folded into the dish's own figures.
  expect(asServedDiet(selected).vegan).toBe("yes");
  expect(asServedDiet(selected).contains).toEqual([]);
  expect(asServedAllergens(selected).allergens).toEqual({});
});

it.each(["answered here", "frozen by the server"] as const)(
  "the dish's own allergens and diet ignore an options answer (%s)",
  (source) => {
    const prod = product({ origins: ["plant", "dairy"], pending: false }, []);
    prod.allergens = { milk: { presence: "contains" } };
    prod.offeredModifiers = [
      {
        kind: "options",
        id: "list-milk",
        name: "Leche",
        customerName: { en: "Milk for the customer" },
        kitchenName: "Leche KDS",
        defaultLabelId: null,
        labels: [
          {
            id: "label-oat",
            name: "Avena",
            customerName: { en: "Oat for the customer" },
            kitchenName: "Avena KDS",
            available: true,
          },
        ],
      },
    ];
    const selected: OrderLine = {
      product: prod,
      quantity: "1",
      ...(source === "answered here"
        ? { options: [{ listId: "list-milk", labelId: "label-oat" }] }
        : {
            optionSnapshots: [
              {
                listName: { en: "Leche" },
                listCustomerName: { en: "Milk for the customer" },
                listKitchenName: "Leche KDS",
                labelName: { en: "Avena" },
                labelCustomerName: { en: "Oat for the customer" },
                labelKitchenName: "Avena KDS",
              },
            ],
          }),
    };
    // The oat answer does not strip the dish's OWN milk allergen or {plant,dairy} diet.
    expect(asServedAllergens(selected)).toEqual({
      allergens: { milk: { presence: "contains" } },
      pending: false,
    });
    expect(asServedDiet(selected)).toEqual({ vegan: "no", vegetarian: "yes", contains: [] });
  },
);

it("a dish declaring only kosher claims nothing about vegan, vegetarian or halal", () => {
  const prod = product(null, []);
  prod.dietaryDeclarations = ["kosher"];
  expect(asServedDiet(line(prod))).toEqual({
    vegan: "unknown",
    vegetarian: "unknown",
    contains: [],
    kosher: "yes",
  });
});

it("an unreviewed dish's allergens read pending with nothing listed; a reviewed one does not", () => {
  const unreviewed = product(null, []);
  expect(asServedAllergens(line(unreviewed))).toEqual({ allergens: {}, pending: true });
  const reviewed = product(null, []);
  reviewed.allergens = {};
  expect(asServedAllergens(line(reviewed))).toEqual({ allergens: {}, pending: false });
});

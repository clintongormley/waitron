import { describe, expect, it } from "vitest";
import { asServedDiet, asServedAllergens } from "./as-served.js";
import type { OrderLine } from "./working-order.js";
import type { DietDerivation, DietOverride, TillOptionItem, TillProduct } from "../api/client.js";

/** A minimal option item. A line selection no longer changes the line's diet/allergens — each dish
 *  shows its OWN figures — so the item carries only the fields the shape needs. */
function item(id: string): TillOptionItem {
  return {
    id,
    name: { en: id },
    priceDelta: "0.00",
    vatClass: null,
    maxQuantity: 1,
    addAllergens: null,
  };
}

/** A product with one option group of `items`, a diet derivation and an optional override. */
function product(
  derivation: DietDerivation | null,
  items: TillOptionItem[],
  override?: DietOverride | null,
): TillProduct {
  return {
    id: "dish",
    descriptions: { en: "dish" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    dietDerivation: derivation,
    ...(override === undefined ? {} : { dietOverride: override }),
    optionGroups: [
      { id: "g", name: { en: "g" }, minSelect: 0, maxSelect: 9, required: false, items },
    ],
  };
}

/** Rung-up line: the product plus the selected option ids. Selections no longer change the line's
 *  diet/allergens — each dish shows its OWN figures — so these tests pin exactly that. */
function line(prod: TillProduct, ...selectedItemIds: string[]): OrderLine {
  return {
    product: prod,
    quantity: "1",
    ...(selectedItemIds.length === 0
      ? {}
      : {
          options: selectedItemIds.map((id) => ({
            optionGroupItemId: id,
            name: { en: id },
            priceDelta: "0.00",
          })),
        }),
  };
}

describe("asServedDiet — the dish's own diet, no modifier fold", () => {
  it("shows the dish's own direct declarations, ignoring a selected invalidating extra", () => {
    // The dish declares vegan + halal; a selected bacon extra (which used to invalidate no_meat/halal)
    // must NOT change the DISH's own declared claims — its own meat is shown separately (Task 4).
    const prod = product(null, []);
    prod.dietaryDeclarations = ["vegan", "halal"];
    prod.modifiers = [
      {
        id: "extras",
        name: { en: "Extras" },
        type: "extras",
        available: true,
        required: false,
        maxTotalQuantity: null,
        choices: [
          {
            ...item("bacon"),
            dietaryEffect: { invalidates: ["no_meat", "halal"] },
            available: true,
            preselected: false,
          },
        ],
      },
    ];
    delete prod.optionGroups;
    const own = { vegan: "yes", vegetarian: "yes", halal: "yes" };
    expect(asServedDiet(line(prod))).toMatchObject(own);
    expect(asServedDiet(line(prod, "bacon"))).toMatchObject(own);
  });

  it("shows the dish's own derived diet, ignoring a no-cheese extra", () => {
    // Base plant + dairy, reviewed ⇒ vegetarian but NOT vegan. A no-cheese extra used to flip it vegan;
    // now the dish shows its own diet and the extra changes nothing.
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
    // The owner forces vegan:"yes" on the DISH. The extra's meat is shown separately (Task 4), so the
    // dish's own diet stays vegan:"yes" — the fold that used to cap this is gone.
    const prod = product({ origins: ["plant"], pending: false }, [item("add-bacon")]);
    prod.dietOverride = { vegan: "yes" };
    expect(asServedDiet(line(prod)).vegan).toBe("yes");
    const asServed = asServedDiet(line(prod, "add-bacon"));
    expect(asServed.vegan).toBe("yes");
    expect(asServed.contains).toEqual([]);
  });

  it("a line with no optionGroups at all still derives the dish's own diet", () => {
    const prod: TillProduct = {
      id: "dish",
      descriptions: { en: "dish" },
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
  prod.modifiers = [
    {
      id: "extras",
      name: { en: "Extras" },
      type: "extras",
      available: true,
      required: false,
      maxTotalQuantity: null,
      choices: [
        {
          ...item("cheese"),
          addAllergens: { milk: { presence: "contains" } },
          available: true,
          preselected: false,
        },
      ],
    },
  ];
  delete prod.optionGroups;
  expect(Object.keys(asServedAllergens(line(prod, "cheese")).allergens).sort()).toEqual(["gluten"]);
});

it("the dish's own allergens and diet ignore a canonical extras selection", () => {
  const prod = product({ origins: ["plant"], pending: false }, []);
  prod.allergens = {};
  prod.modifiers = [
    {
      id: "extras",
      name: { en: "Extras" },
      type: "extras",
      available: true,
      required: false,
      maxTotalQuantity: null,
      choices: [
        {
          ...item("bacon"),
          addAllergens: { milk: { presence: "contains" } },
          available: true,
          preselected: false,
        },
      ],
    },
  ];
  delete prod.optionGroups;
  const selected = line(prod, "bacon");
  // The dish is plant-only and reviewed-with-no-allergens; the selected bacon extra's meat and milk are
  // shown separately (Task 4), never folded into the dish's own figures.
  expect(asServedDiet(selected).vegan).toBe("yes");
  expect(asServedDiet(selected).contains).toEqual([]);
  expect(asServedAllergens(selected).allergens).toEqual({});
});

it.each(["submitted", "saved"] as const)(
  "the dish's own allergens and diet ignore a canonical nonprice option (%s)",
  (source) => {
    const prod = product({ origins: ["plant", "dairy"], pending: false }, []);
    prod.allergens = { milk: { presence: "contains" } };
    prod.modifiers = [
      {
        id: "milk",
        name: { en: "Milk" },
        type: "options",
        available: true,
        defaultChoiceId: null,
        choices: [
          {
            id: "oat",
            name: { en: "Oat" },
            available: true,
          },
        ],
      },
    ];
    delete prod.optionGroups;
    const selected: OrderLine = {
      product: prod,
      quantity: "1",
      ...(source === "submitted"
        ? {
            modifierSelections: [{ modifierId: "milk", type: "options" as const, choiceId: "oat" }],
          }
        : {
            modifierSnapshots: [
              {
                modifierId: "milk",
                name: { en: "Milk" },
                type: "options" as const,
                choiceId: "oat",
                choiceName: { en: "Oat" },
              },
            ],
          }),
    };
    // The oat option used to strip milk/dairy from the fold; now the dish keeps its OWN milk allergen and
    // its OWN {plant,dairy} diet (vegetarian, not vegan), and the option is shown separately (Task 4).
    expect(asServedAllergens(selected)).toEqual({
      allergens: { milk: { presence: "contains" } },
      pending: false,
    });
    expect(asServedDiet(selected)).toEqual({ vegan: "no", vegetarian: "yes", contains: [] });
  },
);

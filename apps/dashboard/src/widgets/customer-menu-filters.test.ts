import { expect, it } from "vitest";
import type { GuestChoice, GuestMember, ProductAllergens } from "@waitron/shared";
import { filterCustomerMenu } from "./customer-menu-filters.js";

type Dish = Extract<GuestMember, { kind: "product" }>;

function dish(name: string, changes: Partial<Dish> = {}): Dish {
  return {
    kind: "product",
    name,
    description: "",
    image: null,
    price: { min: "5.00", max: "5.00" },
    unit: "",
    allergens: {},
    dietary: [],
    variants: [],
    modifiers: [],
    ...changes,
  };
}

function choice(allergens: ProductAllergens | null): GuestChoice {
  return { name: "Choice", price: "5.00", unit: "", allergens, dietary: [] };
}

it("requires one reviewed variant that passes every exclusion and a reviewed dish", () => {
  const menu = [
    dish("Crossed variants", { variants: [choice({ eggs: {} }), choice({ milk: {} })] }),
    dish("Reviewed option", {
      allergens: { eggs: {} },
      variants: [choice({ eggs: {} }), choice({}), choice(null)],
    }),
    dish("Unreviewed parent", { allergens: null, variants: [choice({})] }),
    dish("Unreviewed variant", { variants: [choice({ eggs: {} }), choice(null)] }),
    dish("Reviewed variant", { variants: [choice({ eggs: {} })] }),
    dish("Plain dish", { allergens: { milk: {} } }),
  ];

  const result = filterCustomerMenu(menu, "", "en", "", ["eggs", "milk"]);
  expect(result.entries.map(({ member }) => member.name)).toEqual(["Reviewed option"]);
  expect(result.hidden).toBe(5);
  expect(result.unreviewed).toBe(2);
});

it("blocks declared allergens in served defaults and leaves optional and unknown extras to the detail", () => {
  function withExtra(
    name: string,
    preselected: boolean,
    allergens: ProductAllergens | null,
    changes: Partial<Dish> = {},
  ) {
    return dish(name, {
      modifiers: [
        { kind: "options", name: "Cooking", labels: ["Rare"] },
        {
          kind: "extras",
          name: "Sauce",
          items: [{ ...choice(allergens), preselected, portion: "1" }],
        },
      ],
      ...changes,
    });
  }

  const result = filterCustomerMenu(
    [
      withExtra("Default", true, { nuts: { kinds: ["almonds"] } }, { allergens: null }),
      withExtra("Optional", false, { nuts: { kinds: ["almonds"] } }),
      withExtra("Unknown default", true, null),
      withExtra("Reviewed default", true, {}),
    ],
    "",
    "en",
    "",
    ["nuts"],
  );
  expect(result.entries.map(({ member }) => member.name)).toEqual([
    "Optional",
    "Unknown default",
    "Reviewed default",
  ]);
  expect(result.hidden).toBe(1);
  expect(result.unreviewed).toBe(0);
});

it("counts placements after name and diet matching, keeping nonempty sections and set menus", () => {
  const bread = dish("House bread", { allergens: null, dietary: ["vegan"] });
  const clear = dish("Garden bread", { dietary: ["vegan"] });
  const set: GuestMember = { kind: "set_menu", name: "Bread lunch", price: "20.00", lines: [] };

  expect(
    filterCustomerMenu(
      [
        { kind: "section", name: "Bakery", members: [bread] },
        dish("Green salad", { allergens: null, dietary: ["vegan"] }),
        dish("Cheese bread", { allergens: { milk: {} }, dietary: ["vegetarian"] }),
        { kind: "section", name: "Garden", members: [bread, clear] },
        set,
      ],
      "bread",
      "en",
      "vegan",
      ["milk"],
    ),
  ).toEqual({
    entries: [
      { member: { kind: "section", name: "Garden", members: [clear] }, sectionId: "section-3" },
      { member: set, sectionId: "section-4" },
    ],
    hidden: 2,
    unreviewed: 2,
    dishes: 1,
  });
});

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
});

it("hides dishes served with a default extra that declares an exclusion or lacks review", () => {
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
      withExtra("Unknown default with a reviewed variant", true, null, { variants: [choice({})] }),
      withExtra("Unknown default on a dish that declares nuts", true, null, {
        allergens: { nuts: { kinds: ["almonds"] } },
      }),
      withExtra("Unknown optional", false, null),
      withExtra("Reviewed default", true, {}),
    ],
    "",
    "en",
    "",
    ["nuts"],
  );
  expect(result.entries.map(({ member }) => member.name)).toEqual([
    "Optional",
    "Unknown optional",
    "Reviewed default",
  ]);
});

it("keeps only matching dishes and set menus across sections", () => {
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
    dishes: 1,
  });
});

it.each([
  ["vegan", ["Vegan stew"]],
  ["vegetarian", ["Vegan stew", "Vegetarian pie"]],
  ["no_meat", ["Vegan stew", "Vegetarian pie"]],
  ["no_fish", ["Vegan stew", "Vegetarian pie"]],
  ["halal", ["Halal chicken"]],
])("matches %s using the till's published diet implications", (diet, expected) => {
  const result = filterCustomerMenu(
    [
      dish("Vegan stew", { dietary: ["vegan"] }),
      dish("Vegetarian pie", { dietary: ["vegetarian"] }),
      dish("Halal chicken", { dietary: ["halal"] }),
      dish("Unlabelled salad", { variants: [{ ...choice({}), dietary: ["vegan"] }] }),
    ],
    "",
    "en",
    diet,
    [],
  );
  expect(result.entries.map(({ member }) => member.name)).toEqual(expected);
});

it("matches No fish by diet and excludes Fish by allergen", () => {
  const menu = [
    dish("Fish sauce noodles", {
      dietary: ["no_fish", "no_meat"],
      allergens: { fish: {} },
    }),
    dish("Fresh pasta", { dietary: ["no_fish", "no_meat"] }),
    dish("Unlabelled salad"),
  ];
  const namesFor = (diet: string, excluded: string[] = []) =>
    filterCustomerMenu(menu, "", "en", diet, excluded).entries.map(({ member }) => member.name);
  expect(namesFor("no_fish")).toEqual(["Fish sauce noodles", "Fresh pasta"]);
  expect(namesFor("no_meat")).toEqual(["Fish sauce noodles", "Fresh pasta"]);
  expect(namesFor("no_fish", ["fish"])).toEqual(["Fresh pasta"]);
});

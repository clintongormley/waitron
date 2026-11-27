import { expect, it } from "vitest";
import type { FrozenExtraItem, FrozenOffer, MenuDocument } from "./menu-document-types.js";
import { publicGuestMenu as prepareGuestMenu } from "./guest-menu.js";

const unit = {
  id: "each",
  staffName: "Internal unit",
  staffAbbreviation: "iu",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
};
const offer: FrozenOffer = {
  id: "item",
  menuId: "private-menu",
  productId: "private-product",
  menuName: "Internal menu",
  name: "Internal soup",
  customerName: { en: "Soup", es: "Soup ES" },
  kitchenName: "KITCHEN SOUP",
  unitPrice: "4.00",
  grossPrice: "99.00",
  unit,
  vatClass: "general",
  takeawayVatClass: "general",
  allergens: null,
  diet: null,
  dietOverride: null,
  dietaryDeclarations: [],
  description: { en: "Hot soup" },
  image: "private.jpg",
  placements: [[]],
  variants: [],
  offeredModifiers: [],
};
function document(dish: FrozenOffer = offer): MenuDocument {
  return {
    format: 7,
    menuNames: {},
    menuId: "private-menu",
    menuName: "Lunch",
    includedMenuHashes: { secret: "hash" },
    home: {
      shortcuts: [],
      order: "menu_first",
    },
    root: { members: [{ kind: "product", menuItemId: "item", productId: "private-product" }] },
    offers: { item: dish },
  };
}
const eachUnitId = "canonical-each";
const publicGuestMenu = (
  doc: MenuDocument,
  languages: Parameters<typeof prepareGuestMenu>[1],
  requested: string | readonly string[],
) => prepareGuestMenu(doc, languages, requested, eachUnitId);

const config = { defaultLanguage: "en", languages: ["en", "es", "de"] };
const project = (dish = offer, language = "es") =>
  publicGuestMenu(document(dish), config, language);

it("allows only resolved guest content, with the effective price and reviewed state", () => {
  expect(project()).toEqual({
    name: "Lunch",
    language: "es",
    languages: ["en", "es", "de"],
    members: [
      {
        kind: "product",
        name: "Soup ES",
        description: "Hot soup",
        image: "private.jpg",
        price: { min: "4.00", max: "4.00" },
        unit: "ea",
        allergens: null,
        dietary: [],
        variants: [],
        modifiers: [],
      },
    ],
  });
});

it("uses the published customer title, shows set-menu cards and leaves hidden standalone dishes out", () => {
  const doc = document({ ...offer, unit: { ...unit, id: eachUnitId } });
  const dish = { kind: "product", menuItemId: "item", productId: "private-product" } as const;
  doc.menuNames = { en: "Lunch for customers", es: "Lunch ES" };
  doc.offers.staff = { ...offer, ordering: "staff_only" };
  doc.offers.extra = { ...offer, ordering: "not_sold_separately" };
  doc.setMenus = {
    fixed: {
      name: "Staff set menu",
      terms: { price: "18.50", names: { en: "Three courses" }, lines: [] },
      courses: {},
      root: { members: [] },
      offers: {},
      changedAt: "2026-11-26T17:00:00.000Z",
    },
  };
  doc.setMenus.plain = {
    ...doc.setMenus.fixed!,
    name: "Seasonal menu",
    terms: { price: "20.00", names: {}, lines: [] },
  };
  doc.root.members = [
    {
      kind: "section",
      sectionId: "hidden",
      internalName: "Hidden choices",
      names: {},
      image: null,
      color: null,
      members: [
        { ...dish, menuItemId: "staff" },
        { ...dish, menuItemId: "extra" },
      ],
    },
    dish,
    { kind: "set_menu", menuId: "fixed", name: "Staff placement" },
    { kind: "set_menu", menuId: "plain", name: "Another placement" },
  ];

  expect(publicGuestMenu(doc, config, "ja")).toEqual({
    name: "Lunch for customers",
    language: "en",
    languages: ["en", "es", "de"],
    members: [
      {
        kind: "product",
        name: "Soup",
        description: "Hot soup",
        price: { min: "4.00", max: "4.00" },
        image: "private.jpg",
        unit: "",
        allergens: null,
        dietary: [],
        variants: [],
        modifiers: [],
      },
      { kind: "set_menu", name: "Three courses", price: "18.50", lines: [] },
      { kind: "set_menu", name: "Seasonal menu", price: "20.00", lines: [] },
    ],
  });
});

it("projects set-menu choices from their published courses, supplements and declarations", () => {
  const doc = document();
  const placed = (menuItemId: string) => ({
    kind: "product" as const,
    menuItemId,
    productId: menuItemId,
  });
  const choice = { ...offer, courseOverrideId: null, countsAsCourseId: "main", variants: [] };
  doc.root.members = [{ kind: "set_menu", menuId: "fixed", name: "Staff placement" }];
  doc.setMenus = {
    fixed: {
      name: "Lunch set",
      changedAt: "2026-11-26T17:00:00.000Z",
      terms: {
        price: "18.50",
        names: {},
        lines: [
          { id: "start", count: 2, courseIds: ["soup", "main"] },
          { id: "end", count: 1, courseIds: ["dessert"] },
        ],
      },
      courses: {
        main: { name: "Mains", names: { en: "Main course" } },
        soup: { name: "Soup course", names: { es: "Soup course ES" } },
        dessert: { name: "Dessert", names: {} },
      },
      root: { members: ["bread", "soup", "staff"].map(placed) },
      offers: {
        soup: {
          ...choice,
          countsAsCourseId: null,
          allergens: { milk: {} },
          unitPrice: "2.50",
          variants: [
            {
              ...offer,
              id: "cup",
              name: "Staff cup",
              customerName: { en: "Cup" },
              countsAsCourseId: "soup",
              unitPrice: "2.50",
              menuPrice: null,
              pricingUnit: "each",
              allergens: { gluten: { kinds: ["wheat"] } },
            },
            {
              ...offer,
              id: "sweet",
              name: "Sweet",
              customerName: null,
              countsAsCourseId: "dessert",
              unitPrice: "0.00",
              menuPrice: null,
              pricingUnit: "each",
              dietaryDeclarations: ["vegan"],
            },
          ],
        },
        bread: {
          ...choice,
          name: "Grilled bread",
          customerName: null,
          ordering: "not_sold_separately",
          unitPrice: "0.00",
          unit: { ...unit, id: eachUnitId },
          allergens: { nuts: { kinds: ["almonds"] } },
        },
        staff: { ...choice, ordering: "staff_only" },
      },
    },
  };

  expect(publicGuestMenu(doc, config, "es").members).toEqual([
    {
      kind: "set_menu",
      name: "Lunch set",
      price: "18.50",
      lines: [
        {
          count: 2,
          courses: ["Soup course ES", "Main course"],
          choices: [
            {
              name: "Grilled bread",
              price: "0.00",
              unit: "",
              allergens: { nuts: { kinds: ["almonds"] } },
              dietary: [],
            },
            {
              name: "Soup ES (Cup)",
              price: "2.50",
              unit: "ea",
              allergens: { gluten: { kinds: ["wheat"] } },
              dietary: [],
            },
          ],
        },
        {
          count: 1,
          courses: ["Dessert"],
          choices: [
            {
              name: "Soup ES (Sweet)",
              price: "0.00",
              unit: "ea",
              allergens: null,
              dietary: ["vegan"],
            },
          ],
        },
      ],
    },
  ]);
});
it("resolves parent and variant names independently and prices each variant", () => {
  const dish: FrozenOffer = {
    ...offer,
    variants: [
      {
        ...offer,
        id: "size",
        name: "Large staff",
        customerName: null,
        menuPrice: "88.00",
        unitPrice: "6.00",
        pricingUnit: "each" as const,
        allergens: { gluten: { kinds: ["wheat" as const] } },
        dietaryDeclarations: ["vegan" as const],
      },
      {
        ...offer,
        id: "small",
        name: "Small staff",
        customerName: { en: "Small" },
        menuPrice: null,
        unitPrice: "3.00",
        pricingUnit: "each" as const,
        allergens: {},
        dietaryDeclarations: [],
      },
    ],
  };
  const item = project(dish).members[0]!;
  expect(item).toMatchObject({
    name: "Soup ES",
    price: { min: "3.00", max: "6.00" },
    variants: [
      {
        name: "Large staff",
        price: "6.00",
        allergens: { gluten: { kinds: ["wheat"] } },
        dietary: ["vegan"],
      },
      { name: "Small", price: "3.00", allergens: {}, dietary: [] },
    ],
  });
  expect(JSON.stringify(item)).not.toContain("KITCHEN");
});
it("keeps section order and direct includes when a set-menu placement has no published copy", () => {
  const doc = document();
  const member = doc.root.members[0]!;
  doc.root.members = [
    {
      kind: "section",
      sectionId: "private",
      internalName: "Staff starter",
      names: { es: "Starters ES" },
      image: "private.jpg",
      color: "red",
      members: [member],
    },
    { kind: "set_menu", menuId: "fixed-price-menu", name: "Set menu" },
    {
      kind: "section",
      direct: true,
      sectionId: "included",
      includedMenu: { id: "hidden", name: "Hidden menu" },
      internalName: "Hidden folder",
      names: {},
      image: null,
      color: null,
      members: [member],
    },
    member,
  ];
  expect(publicGuestMenu(doc, config, "es").members.map((m) => [m.kind, m.name])).toEqual([
    ["section", "Starters ES"],
    ["product", "Soup ES"],
    ["product", "Soup ES"],
  ]);
});
it.each<{
  unitKind: string;
  frozenUnit: FrozenExtraItem["unit"];
  displayUnit: { unit: string; servingUnit?: string };
}>([
  {
    unitKind: "a serving",
    frozenUnit: { ...unit, name: { en: "Serving", es: "Portion" }, precision: 2, measure: false },
    displayUnit: { unit: "ea", servingUnit: "Portion" },
  },
  {
    unitKind: "a volume with no scale unit",
    frozenUnit: { ...unit, name: { en: "Litre" }, abbreviation: { en: "l" }, measure: true },
    displayUnit: { unit: "l" },
  },
  {
    unitKind: "the canonical Each unit",
    frozenUnit: { ...unit, id: eachUnitId, measure: false },
    displayUnit: { unit: "" },
  },
  { unitKind: "a published unit without the flag", frozenUnit: unit, displayUnit: { unit: "ea" } },
])("$unitKind keeps extra declarations", ({ frozenUnit, displayUnit }) => {
  const dish: FrozenOffer = {
    ...offer,
    offeredModifiers: [
      {
        kind: "extras",
        id: "list",
        name: "Internal extras",
        customerName: { en: "Extras" },
        kitchenName: "KITCHEN LIST",
        minPicks: 0,
        maxPicks: 2,
        items: [
          {
            productId: "extra",
            presentation: {
              name: "Staff bread",
              customerName: { es: "Bread ES", en: "chips", "en-US": "fries" },
              kitchenName: "KITCHEN BREAD",
              variantName: "Staff size",
              variantCustomerName: null,
              variantKitchenName: "KITCHEN SIZE",
            },
            portion: "2.000",
            unit: frozenUnit,
            name: "Ignore combined",
            customerName: null,
            kitchenName: "KITCHEN",
            price: "1.50",
            vatClass: "general",
            takeawayVatClass: "general",
            maxQuantity: 2,
            preselected: false,
            addAllergens: { nuts: { kinds: ["almonds"] } },
            suitableFor: ["vegetarian"],
            image: "private.jpg",
          },
        ],
      },
      {
        kind: "options",
        id: "option",
        name: "Internal cook",
        customerName: { en: "Cooking" },
        kitchenName: "KITCHEN",
        defaultLabelId: "label",
        labels: [
          {
            id: "label",
            name: "Internal rare",
            customerName: { en: "Rare" },
            kitchenName: "KITCHEN",
          },
        ],
      },
    ],
  };
  const item = project(dish).members[0]!;
  if (item.kind !== "product") throw new Error("Expected a dish");
  expect(item.modifiers).toEqual([
    {
      kind: "extras",
      name: "Extras",
      items: [
        {
          name: "Bread ES (Staff size)",
          price: "1.50",
          portion: "2.000",
          ...displayUnit,
          preselected: false,
          allergens: { nuts: { kinds: ["almonds"] } },
          dietary: ["vegetarian"],
        },
      ],
    },
    { kind: "options", name: "Cooking", labels: ["Rare"] },
  ]);
  const group = dish.offeredModifiers[0]!;
  if (group.kind !== "extras") throw new Error("Expected offered extras");
  group.items[0]!.preselected = true;
  const regional = publicGuestMenu(
    document(dish),
    { defaultLanguage: "en", languages: ["en", "es", "en-US"] },
    "en-US",
  ).members[0]!;
  if (regional.kind !== "product" || regional.modifiers[0]!.kind !== "extras")
    throw new Error("Expected extras");
  expect(regional.modifiers[0].items[0]).toMatchObject({
    name: "fries (Staff size)",
    preselected: true,
  });
});

it("keeps the enabled regional guest page and inherits every unchanged dish name", () => {
  const doc = document({
    ...offer,
    name: "Staff potatoes",
    customerName: { en: "chips", "en-US": "fries" },
  });
  const languages = { defaultLanguage: "en", languages: ["en", "en-US", "es"] };
  expect(publicGuestMenu(doc, languages, "en-US")).toMatchObject({
    language: "en-US",
    members: [{ name: "fries" }],
  });
  for (const language of ["en", "en-GB", "es", "en-CA"]) {
    expect(publicGuestMenu(doc, languages, language).members[0]!.name).toBe("chips");
  }
  expect(publicGuestMenu(document(), languages, "en-US").members[0]!.name).toBe("Soup");
});

it("matches phone preferences before resolving authored text and keeps saved link order", () => {
  const doc = document({
    ...offer,
    customerName: { en: "chips", "en-US": "fries", es: "Spanish potatoes" },
  });
  const config = { defaultLanguage: "es", languages: ["en-US", "es", "en"] };
  for (const [preferences, language, name] of [
    [["fr", "en-US"], "en-US", "fries"],
    [["en-GB", "es"], "en", "chips"],
    [["de"], "es", "Spanish potatoes"],
  ] as const) {
    expect(publicGuestMenu(doc, config, preferences)).toMatchObject({
      language,
      languages: ["en-US", "es", "en"],
      members: [{ name }],
    });
  }
  expect(
    publicGuestMenu(doc, { defaultLanguage: "en-US", languages: ["en", "en-US"] }, "en-AU")
      .language,
  ).toBe("en");
  expect(
    publicGuestMenu(
      doc,
      { defaultLanguage: "en-US", languages: ["en-GB", "en-US", "es"] },
      "en-AU",
    ),
  ).toMatchObject({ language: "en-US", languages: ["en-GB", "en-US", "es"] });
});

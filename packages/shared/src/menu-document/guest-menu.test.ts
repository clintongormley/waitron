import { expect, it } from "vitest";
import type { MenuDocument, FrozenOffer } from "./menu-document-types.js";
import { publicGuestMenu } from "./guest-menu.js";

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
    format: 3,
    menuId: "private-menu",
    menuName: "Lunch",
    includedMenuHashes: { secret: "hash" },
    home: {
      shortcuts: [],
      handheld: { columns: 2, tiles: "colours", order: "home_first" },
      till: { columns: 4, tiles: "colours", order: "menu_first" },
    },
    root: { members: [{ kind: "product", menuItemId: "item", productId: "private-product" }] },
    offers: { item: dish },
  };
}
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
it("keeps section order and places directly included members in place", () => {
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
it("keeps separately priced extras and option names with their own declarations", () => {
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
              customerName: { es: "Bread ES" },
              kitchenName: "KITCHEN BREAD",
              variantName: "Staff size",
              variantCustomerName: null,
              variantKitchenName: "KITCHEN SIZE",
            },
            portion: "2.000",
            unit,
            name: "Ignore combined",
            customerName: null,
            kitchenName: "KITCHEN",
            price: "1.50",
            vatClass: "general",
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
          unit: "ea",
          allergens: { nuts: { kinds: ["almonds"] } },
          dietary: ["vegetarian"],
        },
      ],
    },
    { kind: "options", name: "Cooking", labels: ["Rare"] },
  ]);
});

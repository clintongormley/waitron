import { describe, expect, it } from "vitest";
import type { ModifierSnapshot } from "@waitron/shared";
import type { OptionLabel, OptionList, ResolvedExtraList } from "@waitron/catalogue";
import {
  buildLineExtras,
  sameModifierSelections,
  selectionsFromSnapshots,
  type ExtraProductFacts,
} from "./modifier-selection.js";

const snapshots: ModifierSnapshot[] = [
  {
    modifierId: "extras",
    type: "extras",
    name: { en: "Extras" },
    choices: [
      { choiceId: "a", name: { en: "A" }, quantity: 1 },
      { choiceId: "b", name: { en: "B" }, quantity: 2 },
    ],
  },
  {
    modifierId: "milk",
    type: "options",
    name: { en: "Milk" },
    choiceId: "oat",
    choiceName: { en: "Oat" },
  },
];

it("compares recorded answers independently of object, modifier and choice ordering", () => {
  expect(
    sameModifierSelections(
      [
        { choiceId: "oat", type: "options", modifierId: "milk" },
        {
          choices: [
            { quantity: 2, choiceId: "b" },
            { quantity: 1, choiceId: "a" },
          ],
          type: "extras",
          modifierId: "extras",
        },
      ],
      snapshots,
    ),
  ).toBe(true);
});

it.each(
  [
    null,
    {},
    [],
    [null, null],
    [{}, {}],
    [selectionsFromSnapshots(snapshots)[0], selectionsFromSnapshots(snapshots)[0]],
    [{ modifierId: "extras", type: "extras" }, selectionsFromSnapshots(snapshots)[1]],
    [
      { modifierId: "extras", type: "extras", choices: null },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      {
        modifierId: "extras",
        type: "extras",
        choices: [
          { choiceId: "a", quantity: 1 },
          { choiceId: "a", quantity: 1 },
        ],
      },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      {
        modifierId: "extras",
        type: "extras",
        choices: [
          { choiceId: "a", quantity: 2 },
          { choiceId: "b", quantity: 2 },
        ],
      },
      selectionsFromSnapshots(snapshots)[1],
    ],
    [
      selectionsFromSnapshots(snapshots)[0],
      { modifierId: "milk", type: "options", choiceId: "soy" },
    ],
    [
      selectionsFromSnapshots(snapshots)[0],
      { modifierId: "milk", type: "options", choiceId: "oat", unexpected: true },
    ],
  ].map((value) => ({ value })),
)("requires new validation for malformed or changed answers (%#)", ({ value }) => {
  expect(sameModifierSelections(value, snapshots)).toBe(false);
});

// Every name in these fixtures reads differently from every other name in them, so an assertion
// cannot pass by reading the wrong one of a list's, a label's or a product's three names
// (CLAUDE.md §4).
const mediumRare: OptionLabel = {
  id: "label-medium-rare",
  name: "Medium rare staff",
  customerName: { en: "Medium rare diner", es: "Al punto cliente" },
  kitchenName: "MR kitchen",
  available: true,
};
const cooked: OptionList = {
  id: "list-cooked",
  name: "Cooked staff",
  customerName: { en: "How cooked? diner", es: "Punto cliente" },
  kitchenName: "Cook kitchen",
  defaultLabelId: null,
  active: true,
  labels: [
    mediumRare,
    {
      id: "label-well-done",
      name: "Well done staff",
      customerName: { en: "Well done diner" },
      kitchenName: "WD kitchen",
      available: true,
    },
  ],
};
const sauce: OptionList = {
  id: "list-sauce",
  name: "Sauce staff",
  customerName: { en: "Sauce diner" },
  kitchenName: "Sauce kitchen",
  defaultLabelId: null,
  active: true,
  labels: [
    {
      id: "label-pepper",
      name: "Pepper staff",
      customerName: { en: "Pepper diner" },
      kitchenName: "Pepper kitchen",
      available: true,
    },
  ],
};

const breads: ResolvedExtraList = {
  id: "list-breads",
  name: "Breads staff",
  customerName: { en: "Breads diner" },
  kitchenName: "Breads kitchen",
  minPicks: 0,
  maxPicks: null,
  active: true,
  items: [
    {
      id: "item-sourdough",
      productId: "product-sourdough",
      maxQuantity: 2,
      preselected: false,
      price: "1.50",
    },
    { id: "item-rye", productId: "product-rye", maxQuantity: 1, preselected: false, price: "0.00" },
  ],
};
const drinks: ResolvedExtraList = {
  id: "list-drinks",
  name: "Drinks staff",
  customerName: { en: "Drinks diner" },
  kitchenName: "Drinks kitchen",
  minPicks: 0,
  maxPicks: null,
  active: true,
  // 4.50, not the wine product's own unit price: the projection has already settled the menu → list
  // item → product chain into this field (packages/catalogue/src/extra-projection.ts).
  items: [
    {
      id: "item-wine",
      productId: "product-wine",
      maxQuantity: 3,
      preselected: false,
      price: "4.50",
    },
  ],
};

// The wine is a 21% product (`general`) while the dish it is added to is a 10% one (`reduced`).
// `buildLineExtras` is never handed the dish's class at all, so what this fixture pins here is that
// the child reads the PRODUCT's; the dish-beside-extra pairing itself belongs to working-order.ts,
// the next slice.
const products = new Map<string, ExtraProductFacts>([
  [
    "product-wine",
    {
      id: "product-wine",
      name: "Wine staff",
      descriptions: { en: "Wine diner", es: "Vino cliente" },
      kitchenName: "Wine kitchen",
      vatClass: "general",
    },
  ],
  [
    "product-sourdough",
    {
      id: "product-sourdough",
      name: "Sourdough staff",
      descriptions: { en: "Sourdough diner" },
      kitchenName: "Sourdough kitchen",
      vatClass: "reduced",
    },
  ],
  [
    "product-rye",
    {
      id: "product-rye",
      name: "Rye staff",
      descriptions: { en: "Rye diner" },
      kitchenName: "Rye kitchen",
      vatClass: "reduced",
    },
  ],
]);

describe("buildLineExtras", () => {
  it("freezes the list's and the chosen label's three names onto one snapshot, carrying no id", () => {
    const { optionSnapshots } = buildLineExtras(
      { extras: [], options: [cooked] },
      products,
      { options: [{ listId: "list-cooked", labelId: "label-medium-rare" }] },
      "en",
    );
    expect(optionSnapshots).toEqual([
      {
        listName: { en: "Cooked staff" },
        listCustomerName: { en: "How cooked? diner", es: "Punto cliente" },
        listKitchenName: "Cook kitchen",
        labelName: { en: "Medium rare staff" },
        labelCustomerName: { en: "Medium rare diner", es: "Al punto cliente" },
        labelKitchenName: "MR kitchen",
      },
    ]);
    // Neither the list's id nor the label's reaches the line, so editing or deleting either cannot
    // rewrite a saved order (spec §2.3).
    expect(JSON.stringify(optionSnapshots)).not.toContain("list-cooked");
    expect(JSON.stringify(optionSnapshots)).not.toContain("label-medium-rare");
  });

  it("widens the two staff names under the default language it is given", () => {
    const { optionSnapshots } = buildLineExtras(
      { extras: [], options: [cooked] },
      products,
      { options: [{ listId: "list-cooked", labelId: "label-medium-rare" }] },
      "es",
    );
    expect(optionSnapshots[0]!.listName).toEqual({ es: "Cooked staff" });
    expect(optionSnapshots[0]!.labelName).toEqual({ es: "Medium rare staff" });
  });

  it("turns a pick into a child carrying the product's own three names, VAT class and the resolved price", () => {
    const { extraChildren } = buildLineExtras(
      { extras: [drinks], options: [] },
      products,
      { extras: [{ listId: "list-drinks", picks: [{ productId: "product-wine", quantity: 2 }] }] },
      "en",
    );
    expect(extraChildren).toEqual([
      {
        productId: "product-wine",
        name: "Wine staff",
        descriptions: { en: "Wine diner", es: "Vino cliente" },
        kitchenName: "Wine kitchen",
        price: "4.50",
        // The wine's own 21% class, not the 10% of the dish this is an extra on.
        vatClass: "general",
        // The picks per dish as sent — this function never multiplies by the dish count.
        quantity: 2,
      },
    ]);
  });

  it("refuses an unanswered required options list", () => {
    expect(() =>
      buildLineExtras({ extras: [], options: [cooked] }, products, {}, "en"),
    ).toThrowError(
      expect.objectContaining({
        code: "options.label_required",
        params: { optionListId: "list-cooked" },
      }),
    );
  });

  it("refuses a pick past the list item's own cap", () => {
    expect(() =>
      buildLineExtras(
        { extras: [breads], options: [] },
        products,
        {
          extras: [
            { listId: "list-breads", picks: [{ productId: "product-sourdough", quantity: 3 }] },
          ],
        },
        "en",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "extras.limit_exceeded",
        params: { extraListId: "list-breads" },
      }),
    );
  });

  it("refuses a pick whose product the caller resolved no facts for", () => {
    expect(() =>
      buildLineExtras(
        { extras: [drinks], options: [] },
        new Map(),
        {
          extras: [{ listId: "list-drinks", picks: [{ productId: "product-wine", quantity: 1 }] }],
        },
        "en",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "product.not_found",
        params: { productId: "product-wine" },
      }),
    );
  });

  it("neither asks nor answers an inactive list", () => {
    const { extraChildren, optionSnapshots } = buildLineExtras(
      {
        // An inactive extras list demanding a pick, and an inactive options list: both would
        // refuse this empty request if they were asked.
        extras: [{ ...breads, active: false, minPicks: 1 }],
        options: [{ ...cooked, active: false }],
      },
      products,
      {},
      "en",
    );
    expect(extraChildren).toEqual([]);
    expect(optionSnapshots).toEqual([]);
  });

  it("orders children and snapshots by what is offered, never by what was sent", () => {
    const { extraChildren, optionSnapshots } = buildLineExtras(
      { extras: [breads, drinks], options: [cooked, sauce] },
      products,
      {
        extras: [
          { listId: "list-drinks", picks: [{ productId: "product-wine", quantity: 1 }] },
          {
            listId: "list-breads",
            picks: [
              { productId: "product-rye", quantity: 1 },
              { productId: "product-sourdough", quantity: 1 },
            ],
          },
        ],
        options: [
          { listId: "list-sauce", labelId: "label-pepper" },
          { listId: "list-cooked", labelId: "label-well-done" },
        ],
      },
      "en",
    );
    // Offered list order first, then each list's own item order — the wire sent both the lists and
    // the breads picks the other way round.
    expect(extraChildren.map((child) => child.name)).toEqual([
      "Sourdough staff",
      "Rye staff",
      "Wine staff",
    ]);
    expect(optionSnapshots.map((snapshot) => snapshot.listName.en)).toEqual([
      "Cooked staff",
      "Sauce staff",
    ]);
  });
});

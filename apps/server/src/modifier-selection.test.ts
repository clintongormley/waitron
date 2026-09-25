import { describe, expect, it } from "vitest";
import type { OptionLabel, OptionList, ResolvedExtraList } from "@waitron/catalogue";
import {
  buildLineExtras,
  matchExtraChildren,
  sameOptionSelections,
  type ExtraProductFacts,
} from "./modifier-selection.js";

// Every name in these fixtures reads differently from every other name in them, so an assertion
// cannot pass by reading the wrong one of a list's, a label's or a product's three names
// (CLAUDE.md §3).
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
  // 4.50, not the wine product's own unit price: the projection has already settled the price.
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
    // rewrite a saved order.
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

// The two comparators below decide whether a held-order edit is quantity-only. The REBUILT side of
// each comparison comes out of `buildLineExtras` rather than being written by hand, so it cannot
// drift from the shape the order path actually freezes. The STORED side is hand-written wherever it
// stands for a `working_order_lines` row, which `matchExtraChildren` takes and this file cannot
// produce.
const freeze = (
  offered: { extras?: ResolvedExtraList[]; options?: OptionList[] },
  requested: { extras?: unknown; options?: unknown },
) =>
  buildLineExtras(
    { extras: offered.extras ?? [], options: offered.options ?? [] },
    products,
    requested,
    "en",
  );

describe("sameOptionSelections", () => {
  it("matches the same two answers whichever order each side lists them in", () => {
    const stored = freeze(
      { options: [cooked, sauce] },
      {
        options: [
          { listId: cooked.id, labelId: mediumRare.id },
          { listId: sauce.id, labelId: "label-pepper" },
        ],
      },
    ).optionSnapshots;
    // What the SAME answers freeze to after the dish's attachment list is reordered: both
    // validators answer in the offered order, so the two arrays hold the same entries transposed.
    const frozen = freeze(
      { options: [sauce, cooked] },
      {
        options: [
          { listId: cooked.id, labelId: mediumRare.id },
          { listId: sauce.id, labelId: "label-pepper" },
        ],
      },
    ).optionSnapshots;

    // Without this line the case would pass on a comparison that reads position, because nothing
    // else here shows the two arrays actually came back transposed.
    expect(frozen).not.toEqual(stored);
    expect(sameOptionSelections(frozen, stored)).toBe(true);
  });

  it("differs when the label chosen from one list changed", () => {
    const stored = freeze(
      { options: [cooked] },
      { options: [{ listId: cooked.id, labelId: mediumRare.id }] },
    ).optionSnapshots;
    const frozen = freeze(
      { options: [cooked] },
      { options: [{ listId: cooked.id, labelId: "label-well-done" }] },
    ).optionSnapshots;

    expect(sameOptionSelections(frozen, stored)).toBe(false);
  });

  it("differs when one side repeats an answer the other gives once", () => {
    const [cookedAnswer] = freeze(
      { options: [cooked] },
      { options: [{ listId: cooked.id, labelId: mediumRare.id }] },
    ).optionSnapshots;
    const [sauceAnswer] = freeze(
      { options: [sauce] },
      { options: [{ listId: sauce.id, labelId: "label-pepper" }] },
    ).optionSnapshots;

    expect(
      sameOptionSelections([cookedAnswer!, cookedAnswer!], [cookedAnswer!, sauceAnswer!]),
    ).toBe(false);
  });

  it("differs when the line froze an answer the edit no longer gives", () => {
    const [cookedAnswer] = freeze(
      { options: [cooked] },
      { options: [{ listId: cooked.id, labelId: mediumRare.id }] },
    ).optionSnapshots;
    const [sauceAnswer] = freeze(
      { options: [sauce] },
      { options: [{ listId: sauce.id, labelId: "label-pepper" }] },
    ).optionSnapshots;

    expect(sameOptionSelections([cookedAnswer!], [cookedAnswer!, sauceAnswer!])).toBe(false);
  });

  it("differs when a list's own wording changed, the picks being all the line remembers", () => {
    const stored = freeze(
      { options: [cooked] },
      { options: [{ listId: cooked.id, labelId: mediumRare.id }] },
    ).optionSnapshots;
    const frozen = freeze(
      { options: [{ ...cooked, name: "Renamed staff" }] },
      { options: [{ listId: cooked.id, labelId: mediumRare.id }] },
    ).optionSnapshots;

    expect(sameOptionSelections(frozen, stored)).toBe(false);
  });
});

describe("matchExtraChildren", () => {
  it("pairs each pick with its own stored child whichever order the two sides are in", () => {
    const { extraChildren } = freeze(
      { extras: [drinks, breads] },
      {
        extras: [
          { listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 2 }] },
          { listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] },
        ],
      },
    );
    // The stored rows are in the order the lists were offered BEFORE the reorder — breads first —
    // while `extraChildren` now comes back drinks first.
    const children = [
      { productId: "product-sourdough", quantity: "6.000", unitPriceGross: "1.50" },
      { productId: "product-wine", quantity: "3.000", unitPriceGross: "4.50" },
    ];

    const paired = matchExtraChildren([drinks, breads], extraChildren, children, "3");

    expect(paired?.map(({ pick, child }) => [pick.productId, child.unitPriceGross])).toEqual([
      ["product-wine", "4.50"],
      ["product-sourdough", "1.50"],
    ]);
  });

  it("reads a stored child's quantity as the dish count times the picks per dish", () => {
    const { extraChildren } = freeze(
      { extras: [breads] },
      { extras: [{ listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 2 }] }] },
    );

    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [{ productId: "product-sourdough", quantity: "6.000" }],
        "3",
      ),
    ).not.toBeNull();
    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [{ productId: "product-sourdough", quantity: "4.000" }],
        "3",
      ),
    ).toBeNull();
  });

  it("refuses a pairing when a pick names a product no stored child holds", () => {
    const { extraChildren } = freeze(
      { extras: [breads] },
      { extras: [{ listId: breads.id, picks: [{ productId: "product-rye", quantity: 1 }] }] },
    );

    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [{ productId: "product-sourdough", quantity: "1.000" }],
        "1",
      ),
    ).toBeNull();
  });

  it("refuses a pairing when two picks name the same product, whichever list offered it", () => {
    // The same wine on two lists at two prices. Nothing on a stored child says which list it came
    // from, so a pairing that knows only the product and the quantity can hand the row sold at 9.00
    // the pick that was made off the 4.50 one — which is a different bill, not a reordering.
    const premiumDrinks: ResolvedExtraList = {
      ...drinks,
      id: "list-drinks-premium",
      items: [{ ...drinks.items[0]!, id: "item-wine-premium", price: "9.00" }],
    };
    const { extraChildren } = freeze(
      { extras: [drinks, premiumDrinks] },
      {
        extras: [
          { listId: drinks.id, picks: [{ productId: "product-wine", quantity: 2 }] },
          { listId: premiumDrinks.id, picks: [{ productId: "product-wine", quantity: 1 }] },
        ],
      },
    );

    expect(
      matchExtraChildren(
        [drinks, premiumDrinks],
        extraChildren,
        [
          { productId: "product-wine", quantity: "1.000", unitPriceGross: "4.50" },
          { productId: "product-wine", quantity: "2.000", unitPriceGross: "9.00" },
        ],
        "1",
      ),
    ).toBeNull();
  });

  it("refuses a pairing when the stored line holds a child the edit no longer picks", () => {
    const { extraChildren } = freeze(
      { extras: [breads] },
      { extras: [{ listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 1 }] }] },
    );

    // Leaving a stored child unpaired would leave its row's quantity behind on the preserve path,
    // so dropping a pick has to take the replacement path instead.
    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [
          { productId: "product-sourdough", quantity: "1.000" },
          { productId: "product-rye", quantity: "1.000" },
        ],
        "1",
      ),
    ).toBeNull();
  });

  it("refuses a pairing when the stored line holds fewer children than there are picks", () => {
    const { extraChildren } = freeze(
      { extras: [breads] },
      {
        extras: [
          {
            listId: breads.id,
            picks: [
              { productId: "product-sourdough", quantity: 1 },
              { productId: "product-rye", quantity: 1 },
            ],
          },
        ],
      },
    );

    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [{ productId: "product-sourdough", quantity: "1.000" }],
        "1",
      ),
    ).toBeNull();
  });

  it("refuses a pairing when two of the dish's lists offer the picked product", () => {
    // ONE pick, so nothing here is ambiguous on the picks side — the ambiguity is in the OFFER, and
    // a pick that moved from one of these lists to the other looks exactly like this one.
    const premiumDrinks: ResolvedExtraList = {
      ...drinks,
      id: "list-drinks-premium",
      items: [{ ...drinks.items[0]!, id: "item-wine-premium", price: "9.00" }],
    };
    const { extraChildren } = freeze(
      { extras: [drinks, premiumDrinks] },
      { extras: [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }] },
    );

    expect(
      matchExtraChildren(
        [drinks, premiumDrinks],
        extraChildren,
        [{ productId: "product-wine", quantity: "1.000", unitPriceGross: "4.50" }],
        "1",
      ),
    ).toBeNull();
    // The same pick against the same stored child pairs when only ONE list offers the wine.
    expect(
      matchExtraChildren(
        [drinks],
        extraChildren,
        [{ productId: "product-wine", quantity: "1.000", unitPriceGross: "4.50" }],
        "1",
      ),
    ).not.toBeNull();
  });

  it("pairs when the only other list offering the picked product is inactive", () => {
    const retiredDrinks: ResolvedExtraList = {
      ...drinks,
      id: "list-drinks-retired",
      active: false,
      items: [{ ...drinks.items[0]!, id: "item-wine-retired", price: "9.00" }],
    };
    const { extraChildren } = freeze(
      { extras: [drinks] },
      { extras: [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }] },
    );

    expect(
      matchExtraChildren(
        [drinks, retiredDrinks],
        extraChildren,
        [{ productId: "product-wine", quantity: "1.000", unitPriceGross: "4.50" }],
        "1",
      )?.map(({ pick, child }) => [pick.productId, child.unitPriceGross]),
    ).toEqual([["product-wine", "4.50"]]);
  });

  it("pairs a pick whose product no list offers any more", () => {
    const { extraChildren } = freeze(
      { extras: [drinks] },
      { extras: [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }] },
    );

    expect(
      matchExtraChildren(
        [breads],
        extraChildren,
        [{ productId: "product-wine", quantity: "1.000", unitPriceGross: "4.50" }],
        "1",
      )?.map(({ pick, child }) => [pick.productId, child.unitPriceGross]),
    ).toEqual([["product-wine", "4.50"]]);
  });
});

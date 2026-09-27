import { describe, expect, it } from "vitest";
import type { OptionLabel, OptionList, ResolvedExtraList } from "@waitron/catalogue";
import {
  buildLineExtras,
  editLineExtras,
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
        // The list the pick was taken from, so a stored child can be matched to its own list.
        listId: "list-drinks",
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

// The two comparisons below decide what an edit of a saved line keeps. The REBUILT options side
// comes out of `buildLineExtras` rather than being written by hand, so it cannot drift from the
// shape the order path actually freezes. The STORED side is hand-written wherever it stands for a
// `working_order_lines` row, which `editLineExtras` takes and this file cannot produce.
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

describe("editLineExtras", () => {
  // The wine on a second list at another price, for the cases where two lists offer one product.
  const premiumDrinks: ResolvedExtraList = {
    ...drinks,
    id: "list-drinks-premium",
    items: [{ ...drinks.items[0]!, id: "item-wine-premium", price: "9.00" }],
  };
  type Child = {
    productId: string | null;
    extraListId: string | null;
    quantity: string;
    unitPriceGross: string;
  };
  const child = (
    productId: string,
    extraListId: string | null,
    quantity: string,
    unitPriceGross = "0.10",
  ): Child => ({ productId, extraListId, quantity, unitPriceGross });
  /** The edit, as what it keeps (by the price each kept child was sold at), adds and removes. */
  const edit = (
    offered: ResolvedExtraList[],
    extras: unknown,
    children: Child[],
    dishQuantity = "1",
  ) => {
    const result = editLineExtras(offered, products, extras, { children, dishQuantity });
    return {
      kept: result.kept.map(({ child, perDish }) => [
        child.productId,
        child.unitPriceGross,
        perDish,
      ]),
      added: result.added.map((pick) => [pick.listId, pick.productId, pick.price, pick.quantity]),
      removed: result.removed.map((each) => each.unitPriceGross),
    };
  };

  it("keeps each stored child whose pick is unchanged, whichever order the two sides are in", () => {
    // The stored rows are in the order the lists were offered BEFORE a reorder — breads first —
    // while the lists are now offered drinks first.
    expect(
      edit(
        [drinks, breads],
        [
          { listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] },
          { listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 2 }] },
        ],
        [
          child("product-sourdough", breads.id, "6.000", "1.50"),
          child("product-wine", drinks.id, "3.000", "4.50"),
        ],
        "3",
      ),
    ).toEqual({
      kept: [
        ["product-wine", "4.50", 1],
        ["product-sourdough", "1.50", 2],
      ],
      added: [],
      removed: [],
    });
  });

  it("reads a stored child's quantity as the dish count times the picks per dish", () => {
    const extras = [
      { listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 2 }] },
    ];

    expect(edit([breads], extras, [child("product-sourdough", breads.id, "6.000")], "3")).toEqual({
      kept: [["product-sourdough", "0.10", 2]],
      added: [],
      removed: [],
    });
    expect(edit([breads], extras, [child("product-sourdough", breads.id, "4.000")], "3")).toEqual({
      kept: [],
      added: [[breads.id, "product-sourdough", "1.50", 2]],
      removed: ["0.10"],
    });
  });

  it("adds a pick of a product no stored child holds, priced from its list now, and removes the child", () => {
    expect(
      edit(
        [breads],
        [{ listId: breads.id, picks: [{ productId: "product-rye", quantity: 1 }] }],
        [child("product-sourdough", breads.id, "1.000")],
      ),
    ).toEqual({ kept: [], added: [[breads.id, "product-rye", "0.00", 1]], removed: ["0.10"] });
  });

  it("keeps two picks of one product with the child taken from each one's own list", () => {
    expect(
      edit(
        [drinks, premiumDrinks],
        [
          { listId: drinks.id, picks: [{ productId: "product-wine", quantity: 2 }] },
          { listId: premiumDrinks.id, picks: [{ productId: "product-wine", quantity: 1 }] },
        ],
        [
          child("product-wine", premiumDrinks.id, "1.000", "9.00"),
          child("product-wine", drinks.id, "2.000", "4.50"),
        ],
      ),
    ).toEqual({
      kept: [
        ["product-wine", "4.50", 2],
        ["product-wine", "9.00", 1],
      ],
      added: [],
      removed: [],
    });
  });

  it("keeps neither child when two picks of one product swapped counts between their lists", () => {
    // A pairing on product and quantity alone would hand the 4.50 pick the row sold at 9.00, which
    // is a different bill. Both are new picks, each priced from its own list.
    expect(
      edit(
        [drinks, premiumDrinks],
        [
          { listId: drinks.id, picks: [{ productId: "product-wine", quantity: 2 }] },
          { listId: premiumDrinks.id, picks: [{ productId: "product-wine", quantity: 1 }] },
        ],
        [
          child("product-wine", drinks.id, "1.000", "4.50"),
          child("product-wine", premiumDrinks.id, "2.000", "9.00"),
        ],
      ),
    ).toEqual({
      kept: [],
      added: [
        [drinks.id, "product-wine", "4.50", 2],
        [premiumDrinks.id, "product-wine", "9.00", 1],
      ],
      removed: ["4.50", "9.00"],
    });
  });

  it("removes a stored child the edit no longer picks, and keeps the rest", () => {
    expect(
      edit(
        [breads],
        [{ listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 1 }] }],
        [
          child("product-sourdough", breads.id, "1.000", "1.50"),
          child("product-rye", breads.id, "1.000", "0.00"),
        ],
      ),
    ).toEqual({ kept: [["product-sourdough", "1.50", 1]], added: [], removed: ["0.00"] });
  });

  it("keeps the child it has and adds a pick it lacks", () => {
    expect(
      edit(
        [breads],
        [
          {
            listId: breads.id,
            picks: [
              { productId: "product-sourdough", quantity: 1 },
              { productId: "product-rye", quantity: 1 },
            ],
          },
        ],
        [child("product-sourdough", breads.id, "1.000", "1.50")],
      ),
    ).toEqual({
      kept: [["product-sourdough", "1.50", 1]],
      added: [[breads.id, "product-rye", "0.00", 1]],
      removed: [],
    });
  });

  it("keeps the child from the pick's own list when two of the dish's lists offer the product", () => {
    expect(
      edit(
        [drinks, premiumDrinks],
        [{ listId: premiumDrinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }],
        [child("product-wine", premiumDrinks.id, "1.000", "9.00")],
      ),
    ).toEqual({ kept: [["product-wine", "9.00", 1]], added: [], removed: [] });
  });

  it("treats a pick naming a different list from the stored child's as a new pick", () => {
    // The same product and count, moved from one list to the other: priced from the list it names.
    expect(
      edit(
        [drinks, premiumDrinks],
        [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }],
        [child("product-wine", premiumDrinks.id, "1.000", "9.00")],
      ),
    ).toEqual({
      kept: [],
      added: [[drinks.id, "product-wine", "4.50", 1]],
      removed: ["9.00"],
    });
  });

  it("keeps no stored child that records no list", () => {
    expect(
      edit(
        [drinks],
        [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }],
        [child("product-wine", null, "1.000", "4.50")],
      ),
    ).toEqual({
      kept: [],
      added: [[drinks.id, "product-wine", "4.50", 1]],
      removed: ["4.50"],
    });
  });

  it("keeps a child whose list no longer offers the product, or is gone, and refuses a new pick there", () => {
    const extras = [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 1 }] }];
    const stored = [child("product-wine", drinks.id, "1.000", "4.50")];

    expect(edit([{ ...drinks, items: [] }], extras, stored)).toEqual({
      kept: [["product-wine", "4.50", 1]],
      added: [],
      removed: [],
    });
    expect(edit([], extras, stored)).toEqual({
      kept: [["product-wine", "4.50", 1]],
      added: [],
      removed: [],
    });
    expect(() =>
      edit(
        [],
        [{ listId: drinks.id, picks: [{ productId: "product-wine", quantity: 2 }] }],
        stored,
      ),
    ).toThrow(expect.objectContaining({ code: "extras.invalid" }));
  });

  it("keeps picks above caps the list has since lowered, and refuses a new pick past them", () => {
    const lowered: ResolvedExtraList = {
      ...breads,
      maxPicks: 1,
      items: breads.items.map((item) => ({ ...item, maxQuantity: 1 })),
    };
    const stored = [child("product-sourdough", breads.id, "2.000", "1.50")];
    const kept = { listId: breads.id, picks: [{ productId: "product-sourdough", quantity: 2 }] };

    expect(edit([lowered], [kept], stored)).toEqual({
      kept: [["product-sourdough", "1.50", 2]],
      added: [],
      removed: [],
    });
    expect(() =>
      edit(
        [lowered],
        [{ ...kept, picks: [...kept.picks, { productId: "product-rye", quantity: 1 }] }],
        stored,
      ),
    ).toThrow(expect.objectContaining({ code: "extras.limit_exceeded" }));
  });
});

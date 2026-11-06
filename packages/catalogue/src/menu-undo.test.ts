import { describe, expect, it } from "vitest";
import { HOME_DISPLAY_DEFAULTS } from "./device-home.js";
import type {
  MenuChange,
  MenuChangeBody,
  MenuDocument,
  MenuPreview,
} from "./menu-document-types.js";
import { menuChangeActions } from "./menu-undo.js";

function document(menuName: string): MenuDocument {
  return {
    format: 3,
    menuId: "menu-dinner",
    menuName,
    root: { members: [] },
    offers: {},
    home: {
      shortcuts: [],
      handheld: { ...HOME_DISPLAY_DEFAULTS.handheld },
      till: { ...HOME_DISPLAY_DEFAULTS.till },
    },
  };
}

function change(id: string, body: MenuChangeBody): MenuChange {
  return { ...body, id, targets: { before: [], after: [] } } as MenuChange;
}

function preview(changes: MenuChange[], { published = true } = {}): MenuPreview {
  return {
    clashes: [],
    hash: "hash-now",
    changes,
    warnings: [],
    status: published
      ? {
          state: "changed",
          clashes: 0,
          version: 1,
          publishedAt: "2026-11-01T10:00:00.000Z",
          hash: "hash-live",
        }
      : { state: "unpublished", clashes: 0 },
    document: document("Dinner menu"),
    live: published ? { versionId: "version-1", document: document("Dinner") } : null,
  };
}

function actionsFor(changes: MenuChange[], options?: { published?: boolean }) {
  return menuChangeActions({ preview: preview(changes, options), languages: ["en"] });
}

const drinks = { id: "menu-drinks", name: "Drinks" };

/** One change of every kind this menu can make, none of whose Undo is built yet. */
const thisMenuChanges: MenuChange[] = [
  change("m-rename", {
    kind: "menu_renamed",
    from: "Dinner",
    to: "Dinner menu",
    source: "this_menu",
  }),
  change("m-price", {
    kind: "price_changed",
    productId: "burger",
    name: "Burger",
    from: "12.00",
    to: "13.50",
    inheritedPrice: "12.00",
    source: "this_menu",
  }),
  change("m-variants", {
    kind: "product_changed",
    productId: "burger",
    name: "Burger",
    fields: ["variants"],
    source: "this_menu",
  }),
  change("m-section", {
    kind: "section_changed",
    sectionId: "mains",
    name: "Mains",
    fields: ["names", "color"],
    source: "this_menu",
  }),
  change("m-home", { kind: "home_display_changed", device: "handheld", source: "this_menu" }),
  change("m-added", {
    kind: "product_added",
    productId: "fries",
    name: "Fries",
    under: ["Mains"],
    source: "this_menu",
  }),
  change("m-removed", {
    kind: "product_removed",
    productId: "salad",
    name: "Salad",
    under: ["Mains"],
    source: "this_menu",
  }),
  change("m-moved", {
    kind: "product_moved",
    productId: "soup",
    name: "Soup",
    from: [["Mains"]],
    to: [["Starters"]],
    source: "this_menu",
  }),
  change("m-section-added", {
    kind: "section_added",
    sectionId: "desserts",
    parentSectionIds: [],
    name: "Desserts",
    under: [],
    source: "this_menu",
  }),
  change("m-section-removed", {
    kind: "section_removed",
    sectionId: "sides",
    parentSectionIds: [],
    name: "Sides",
    under: [],
    source: "this_menu",
  }),
  change("m-order", {
    kind: "order_changed",
    listSectionId: null,
    list: [],
    source: "this_menu",
  }),
  change("m-shortcuts", { kind: "home_shortcuts_changed", source: "this_menu" }),
];

describe("menuChangeActions", () => {
  it("answers one entry per change id", () => {
    const actions = actionsFor(thisMenuChanges);
    expect([...actions.keys()]).toEqual(thisMenuChanges.map((c) => c.id));
  });

  it("sends a shared product's change to its product editor", () => {
    const actions = actionsFor([
      change("p-changed", {
        kind: "product_changed",
        productId: "lemonade",
        name: "Lemonade",
        fields: ["names", "image"],
        source: "shared_product",
      }),
      change("p-price", {
        kind: "price_changed",
        productId: "burger",
        name: "Burger",
        from: "12.00",
        to: "12.50",
        source: "shared_product",
      }),
    ]);
    expect(actions.get("p-changed")).toEqual({ kind: "edit_product", productId: "lemonade" });
    expect(actions.get("p-price")).toEqual({ kind: "edit_product", productId: "burger" });
  });

  it("sends an extras item's unit change to the item's product editor", () => {
    const actions = actionsFor([
      change("p-unit", {
        kind: "extra_unit_changed",
        productId: "cheese",
        name: "Cheese",
        listId: "toppings",
        listName: "Toppings",
        from: {
          name: {},
          abbreviation: {},
          staffName: "Each",
          staffAbbreviation: "",
          precision: 0,
        },
        to: { name: {}, abbreviation: {}, staffName: "Gram", staffAbbreviation: "g", precision: 0 },
        source: "shared_product",
      }),
    ]);
    expect(actions.get("p-unit")).toEqual({ kind: "edit_product", productId: "cheese" });
  });

  it("sends an extras item's portion or maximum to the extras list it is set on", () => {
    const actions = actionsFor([
      change("p-portion", {
        kind: "extra_portion_changed",
        productId: "cheese",
        name: "Cheese",
        listId: "toppings",
        listName: "Toppings",
        from: { portion: "1", abbreviation: {} },
        to: { portion: "2", abbreviation: {} },
        source: "shared_product",
      }),
      change("p-max", {
        kind: "extra_max_quantity_changed",
        productId: "cheese",
        name: "Cheese",
        listId: "sauces",
        listName: "Sauces",
        from: null,
        to: 3,
        source: "shared_product",
      }),
    ]);
    expect(actions.get("p-portion")).toEqual({ kind: "edit_extras_list", listId: "toppings" });
    expect(actions.get("p-max")).toEqual({ kind: "edit_extras_list", listId: "sauces" });
  });

  it("offers nothing for a deleted product, whose editor refuses every save", () => {
    const actions = actionsFor([
      change("p-deleted", {
        kind: "product_deleted",
        productId: "olives",
        name: "Olives",
        source: "shared_product",
      }),
      change("p-removed", {
        kind: "product_removed",
        productId: "crisps",
        name: "Crisps",
        under: ["Snacks"],
        source: "shared_product",
      }),
    ]);
    expect(actions.get("p-deleted")).toEqual({ kind: "none" });
    expect(actions.get("p-removed")).toEqual({ kind: "none" });
  });

  it("sends an included menu's structural change to that menu's Structure tab", () => {
    const actions = actionsFor([
      change("i-order", {
        kind: "order_changed",
        listSectionId: "drinks-root",
        list: ["Cola", "Lemonade"],
        source: "included_menu",
        includedMenu: drinks,
      }),
      change("i-section", {
        kind: "section_changed",
        sectionId: "soft",
        name: "Soft drinks",
        fields: ["names"],
        source: "included_menu",
        includedMenu: drinks,
      }),
    ]);
    const structure = { kind: "edit_menu", menuId: "menu-drinks", tab: "structure" };
    expect(actions.get("i-order")).toEqual(structure);
    expect(actions.get("i-section")).toEqual(structure);
  });

  it("sends an included menu's price change to that menu's Price overrides tab", () => {
    const actions = actionsFor([
      change("i-price", {
        kind: "price_changed",
        productId: "lemonade",
        name: "Lemonade",
        from: "3.00",
        to: "3.50",
        source: "included_menu",
        includedMenu: drinks,
      }),
      change("i-variants", {
        kind: "product_changed",
        productId: "lemonade",
        name: "Lemonade",
        fields: ["variants"],
        source: "included_menu",
        includedMenu: drinks,
      }),
    ]);
    const prices = { kind: "edit_menu", menuId: "menu-drinks", tab: "prices" };
    expect(actions.get("i-price")).toEqual(prices);
    expect(actions.get("i-variants")).toEqual(prices);
  });

  it("offers nothing for an included menu's change that names no menu", () => {
    const actions = actionsFor([
      change("i-anonymous", {
        kind: "order_changed",
        listSectionId: "drinks-root",
        list: ["Cola", "Lemonade"],
        source: "included_menu",
      }),
    ]);
    expect(actions.get("i-anonymous")).toEqual({ kind: "none" });
  });

  it("offers no Undo on a menu that has never been published", () => {
    const actions = actionsFor(thisMenuChanges, { published: false });
    for (const { id } of thisMenuChanges) expect(actions.get(id), id).toEqual({ kind: "none" });
  });

  it("offers no Undo to rename a menu that has never been published", () => {
    const rename = thisMenuChanges.filter(({ kind }) => kind === "menu_renamed");
    expect(actionsFor(rename, { published: false }).get("m-rename")).toEqual({ kind: "none" });
  });

  it("offers no Undo for a change of this menu whose Undo is not built", () => {
    const built = new Set(["menu_renamed", "home_display_changed", "section_changed"]);
    const notBuilt = thisMenuChanges.filter(({ kind }) => !built.has(kind));
    const actions = actionsFor(notBuilt);
    for (const { id } of notBuilt) expect(actions.get(id), id).toEqual({ kind: "none" });
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MenuTarget } from "@waitron/shared";
import type { MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountMenuPreview as mountWidget,
} from "./test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("es-ES");
  cleanupWidgets();
});

const status: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

const DOCUMENT = menuDocument(
  [
    documentProduct("mi-burger", "p-burger"),
    documentSection("s-drinks", "Drinks", [documentProduct("mi-lemonade", "p-lemonade")]),
  ],
  { "p-burger": "Burger", "p-lemonade": "Lemonade" },
);

const BURGER_TARGET: MenuTarget = {
  kind: "product",
  sectionIds: [],
  menuItemId: "mi-burger",
  productId: "p-burger",
  field: { kind: "summary" },
};

const sharedPrice: MenuChange = {
  id: "shared-price",
  targets: { before: [BURGER_TARGET], after: [BURGER_TARGET] },
  kind: "price_changed",
  productId: "p-burger",
  name: "Burger",
  from: "12.00",
  to: "13.00",
  source: "shared_product",
};
const includedOrder: MenuChange = {
  id: "included-order",
  targets: { before: [], after: [] },
  kind: "order_changed",
  listSectionId: "s-drinks",
  list: ["Drinks"],
  source: "included_menu",
  includedMenu: { id: "m-drinks", name: "Drinks" },
};
const includedPrice: MenuChange = {
  id: "included-price",
  targets: { before: [], after: [] },
  kind: "price_changed",
  productId: "p-lemonade",
  name: "Lemonade",
  from: "2.80",
  to: "3.00",
  source: "included_menu",
  includedMenu: { id: "m-drinks", name: "Drinks" },
};
const extraPortion: MenuChange = {
  id: "extra-portion",
  targets: { before: [], after: [] },
  kind: "extra_portion_changed",
  productId: "p-cheese",
  name: "Cheese",
  listId: "x-toppings",
  listName: "Toppings",
  from: { portion: "1", abbreviation: {} },
  to: { portion: "2", abbreviation: {} },
  source: "shared_product",
};
const deleted: MenuChange = {
  id: "deleted",
  targets: { before: [], after: [] },
  kind: "product_deleted",
  productId: "p-old",
  name: "Old dish",
  source: "shared_product",
};
const ownRename: MenuChange = {
  id: "own-rename",
  targets: { before: [], after: [] },
  kind: "menu_renamed",
  from: "Lunch",
  to: "Lunch Menu",
  source: "this_menu",
};

function preview(changes: MenuChange[]): MenuPreview {
  return {
    setMenuProblems: [],
    live: null,
    clashes: [],
    hash: "b".repeat(64),
    changes,
    warnings: [],
    status,
    document: DOCUMENT,
  };
}

async function mount(changes: MenuChange[], published = false) {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status,
    preview: {
      ...preview(changes),
      live: published ? { versionId: "v-2", document: DOCUMENT } : null,
    },
  });
  return el;
}

const editLink = (el: MenuPreviewPanel, id: string) =>
  el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[data-edit-change="${id}"]`);
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Clicks the link and reports whether anything before the test's own listener stopped the
 * browser's handling; the test's listener always stops it, so the test page stays put. */
function click(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  let prevented = false;
  const read = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  const keep = (event: Event) => event.preventDefault();
  window.addEventListener("click", keep);
  link.addEventListener("click", read);
  try {
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }),
    );
  } finally {
    window.removeEventListener("click", keep);
    link.removeEventListener("click", read);
  }
  return prevented;
}

it("offers Edit product on a shared-product change and opens the product editor on a plain click", async () => {
  const el = await mount([sharedPrice]);
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  const link = editLink(el, "shared-price")!;
  expect(text(link)).toBe("Edit product");
  expect(link.getAttribute("href")).toBe("/products/product/p-burger");
  expect(link.hasAttribute("data-own-click")).toBe(true);
  expect(click(link)).toBe(true);
  expect(heard.mock.calls).toEqual([[{ productId: "p-burger" }]]);
});

it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
  "leaves an Edit product %s click to the browser",
  async (modifier) => {
    const el = await mount([sharedPrice]);
    const heard = vi.fn();
    el.addEventListener("wt-edit-product", heard);
    expect(click(editLink(el, "shared-price")!, { [modifier]: true })).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  },
);

it("offers Edit {menu} on an included-menu change, to its Structure tab, as a plain link", async () => {
  const el = await mount([includedOrder]);
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", heard);
  const link = editLink(el, "included-order")!;
  expect(text(link)).toBe("Edit Drinks");
  expect(link.getAttribute("href")).toBe("/menus/menu/m-drinks/view/structure");
  expect(link.hasAttribute("data-own-click")).toBe(false);
  expect(click(link)).toBe(false);
  expect(click(link, { metaKey: true })).toBe(false);
  expect(heard).not.toHaveBeenCalled();
});

it("sends an included menu's price change to that menu's Price overrides tab", async () => {
  const el = await mount([includedPrice]);
  expect(editLink(el, "included-price")!.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/prices",
  );
});

it("sends an extras item's portion change to its extras list", async () => {
  const el = await mount([extraPortion]);
  const link = editLink(el, "extra-portion")!;
  expect(text(link)).toBe("Edit extras list");
  expect(link.getAttribute("href")).toBe("/modifiers/view/extras/list/x-toppings");
  expect(link.hasAttribute("data-own-click")).toBe(false);
});

it("offers no Edit link on a deleted product or on a price changed by this menu", async () => {
  const el = await mount([deleted, { ...sharedPrice, id: "own-price", source: "this_menu" }]);
  expect(el.shadowRoot!.querySelector(`[data-change-row="deleted"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelector(`[data-change-row="own-price"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll("a[data-edit-change]")).toHaveLength(0);
});

it("puts the Edit link after View and before Hide", async () => {
  const el = await mount([sharedPrice]);
  const row = el.shadowRoot!.querySelector(`[data-change-row="shared-price"]`)!;
  expect(
    [...row.querySelectorAll("a")].map((link) =>
      link.hasAttribute("data-change-id")
        ? "view"
        : link.hasAttribute("data-edit-change")
          ? "edit"
          : link.hasAttribute("data-hide-change")
            ? "hide"
            : "other",
    ),
  ).toEqual(["view", "edit", "hide"]);
});

it("keeps View, Hide and Edit on unpublished changes without an Undo action", async () => {
  const el = await mount([ownRename, sharedPrice, includedPrice], true);
  const row = el.shadowRoot!.querySelector('[data-change-row="own-rename"]')!;
  expect([...row.querySelectorAll("a, button")].map(text)).toEqual(["(View)", "Hide"]);
  expect(editLink(el, "shared-price")?.getAttribute("href")).toBe("/products/product/p-burger");
  expect(editLink(el, "included-price")?.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/prices",
  );
});

it("keeps each row action on one line in a narrow pane, wrapping the row between them", async () => {
  setLocale("es-ES");
  const el = await mount([ownRename, sharedPrice], true);
  el.style.display = "block";
  el.style.inlineSize = "80px";
  await el.updateComplete;
  const actions = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>(
      "a[data-change-id], a[data-edit-change], a[data-hide-change]",
    ),
  ];
  expect(actions).toHaveLength(5);
  const lines = (node: HTMLElement) => new Set([...node.getClientRects()].map((r) => r.top)).size;
  expect(actions.map((node) => [text(node), lines(node)])).toEqual(
    actions.map((node) => [text(node), 1]),
  );
  const edit = editLink(el, "shared-price")!.getBoundingClientRect();
  const hide = el
    .shadowRoot!.querySelector(`a[data-hide-change="shared-price"]`)!
    .getBoundingClientRect();
  expect(hide.top).toBeGreaterThan(edit.top);
});

it("links an extras item's unit to the product and its maximum to the extras list", async () => {
  const unit = {
    staffName: "Each",
    staffAbbreviation: "",
    name: {},
    abbreviation: {},
    precision: 0,
  };
  const el = await mount([
    {
      ...extraPortion,
      id: "extra-unit",
      kind: "extra_unit_changed",
      from: unit,
      to: { ...unit, staffName: "Gram", staffAbbreviation: "g" },
    },
    { ...extraPortion, id: "extra-max", kind: "extra_max_quantity_changed", from: null, to: 3 },
  ]);
  expect(editLink(el, "extra-unit")?.getAttribute("href")).toBe("/products/product/p-cheese");
  expect(editLink(el, "extra-max")?.getAttribute("href")).toBe(
    "/modifiers/view/extras/list/x-toppings",
  );
});

it("links included variants to Price overrides and included structural edits to Structure", async () => {
  const el = await mount([
    {
      id: "included-variants",
      targets: { before: [], after: [] },
      kind: "product_changed",
      productId: "p-lemonade",
      name: "Lemonade",
      fields: ["variants"],
      source: "included_menu",
      includedMenu: { id: "m-drinks", name: "Drinks" },
    },
    {
      id: "included-mixed",
      targets: { before: [], after: [] },
      kind: "product_changed",
      productId: "p-lemonade",
      name: "Lemonade",
      fields: ["variants", "names"],
      source: "included_menu",
      includedMenu: { id: "m-drinks", name: "Drinks" },
    },
    {
      id: "included-section",
      targets: { before: [], after: [] },
      kind: "section_changed",
      sectionId: "s-drinks",
      name: "Drinks",
      fields: ["names"],
      source: "included_menu",
      includedMenu: { id: "m-drinks", name: "Drinks" },
    },
    {
      id: "included-product",
      targets: { before: [], after: [] },
      kind: "product_removed",
      productId: "p-lemonade",
      name: "Lemonade",
      under: ["Drinks"],
      source: "included_menu",
      includedMenu: { id: "m-drinks", name: "Drinks" },
    },
    { ...includedOrder, id: "unnamed-include", includedMenu: undefined },
    { ...deleted, id: "removed", kind: "product_removed", under: ["Drinks"] },
  ]);
  expect(editLink(el, "included-variants")?.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/prices",
  );
  expect(editLink(el, "included-mixed")?.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/structure",
  );
  expect(editLink(el, "included-section")?.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/structure",
  );
  expect(editLink(el, "included-product")?.getAttribute("href")).toBe(
    "/menus/menu/m-drinks/view/structure",
  );
  expect(editLink(el, "unnamed-include")).toBeNull();
  expect(editLink(el, "removed")).toBeNull();
});

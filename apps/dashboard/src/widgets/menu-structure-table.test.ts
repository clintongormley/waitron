import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { CategorySummary, MenuHome, MenuStructureNode, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
beforeEach(async () => {
  await page.viewport(1280, 844);
});

/** The three names read differently (docs/developers/products.md), so a row showing the
 * customer-facing or kitchen name where the staff name belongs fails. */
function product(id: string, name: string, image: string | null = null): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: null,
    primaryCategoryId: null,
    name,
    customerName: { es: `${name} para clientes`, en: `${name} for guests` },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: `${name.toUpperCase()} COCINA`,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image,
    color: null,
    variants: [],
  };
}

const products: Product[] = [
  product("p-lager", "Lager"),
  product("p-lemonade", "Lemonade"),
  product("p-burger", "Burger", "burger.webp"),
  product("p-rioja", "Rioja"),
];

const productNode = (memberId: string, productId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "product", productId },
});

/** A section's customer names read differently from its internal name. */
function drinksNode(memberId: string): MenuStructureNode {
  return {
    memberId,
    ref: { kind: "section", sectionId: "s-drinks" },
    internalName: "Drinks",
    names: { en: "Something to drink", es: "Bebidas frías" },
    image: null,
    color: null,
    ownerMenuId: "menu-lunch",
    children: [
      productNode("m-lager", "p-lager"),
      {
        memberId: "m-beer",
        ref: { kind: "section", sectionId: "s-beer" },
        internalName: "Beer",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children: [productNode("m-lager-2", "p-lager")],
      },
      productNode("m-lemonade", "p-lemonade"),
    ],
  };
}

const favourites = (): MenuStructureNode => ({
  memberId: "m-fav",
  ref: { kind: "section", sectionId: "s-fav" },
  internalName: "Favourites",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [productNode("m-fav-lemonade", "p-lemonade"), drinksNode("m-fav-drinks")],
});

/** Lunch: Burger, Drinks (with Beer inside) and Favourites (which holds Drinks again). */
function lunchNodes(): MenuStructureNode[] {
  return [productNode("m-burger", "p-burger"), drinksNode("m-drinks"), favourites()];
}

/** Wines is another menu, included at Lunch's top level. */
function wines(): MenuStructureNode {
  return {
    memberId: "included-wine",
    ref: { kind: "section", sectionId: "wine-root" },
    internalName: "Wines",
    includedMenuId: "wine",
    ownerMenuId: "wine",
    children: [
      {
        memberId: "wine-red",
        ref: { kind: "section", sectionId: "red-wines" },
        internalName: "Red wines",
        ownerMenuId: "wine",
        children: [productNode("wine-rioja", "p-rioja")],
      },
      productNode("wine-lager", "p-lager"),
    ],
  };
}

async function mount(props: Partial<MenuStructureTable> = {}) {
  const { el } = await mountWidget<MenuStructureTable>("dashboard-menu-structure-table", {
    nodes: lunchNodes(),
    products,
    menuName: "Lunch Menu",
    ...props,
  });
  await settle(el);
  return el;
}

function table(el: MenuStructureTable) {
  return el.shadowRoot!.querySelector("wt-data-table")!;
}

function inTable<T extends Element = HTMLElement>(
  el: MenuStructureTable,
  selector: string,
): T | null {
  return table(el).shadowRoot!.querySelector<T>(selector);
}

function all<T extends Element = HTMLElement>(el: MenuStructureTable, selector: string): T[] {
  return [...table(el).shadowRoot!.querySelectorAll<T>(selector)];
}

async function settle(el: MenuStructureTable): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await el.updateComplete;
    await table(el).updateComplete;
  }
}

function row(el: MenuStructureTable, key: string): HTMLElement | null {
  return inTable(el, `tr[data-row-key="${CSS.escape(key)}"]`);
}

/** The rows drawn, as their keys, in order. */
function shown(el: MenuStructureTable): string[] {
  return all(el, "tbody tr[data-row-key]").map((tr) => tr.dataset.rowKey!);
}

function nameOf(el: MenuStructureTable, key: string): string {
  return row(el, key)!
    .querySelector('[data-test="name"], [data-test="root-name"]')!
    .textContent!.trim();
}

async function toggle(el: MenuStructureTable, key: string): Promise<void> {
  row(el, key)!.querySelector<HTMLButtonElement>(".row-activate")!.click();
  await settle(el);
}

/** The data-test names of what a row's ⋮ holds, in order. */
function menuItems(el: MenuStructureTable, key: string): string[] {
  const menu = inTable(el, `[data-test="actions-${CSS.escape(key)}"]`)!;
  return [...menu.children]
    .filter((child) => child.hasAttribute("data-test"))
    .map((child) => child.getAttribute("data-test")!);
}

function item(el: MenuStructureTable, test: string): HTMLElement {
  return inTable(el, `[data-test="${CSS.escape(test)}"]`)!;
}

function listen(el: MenuStructureTable, name: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

const menuLabel = (name: string) => t("menus.menu_prefix").replace("{name}", name);

it("draws the menu first, then its members a level deeper, in menu order", async () => {
  const el = await mount();
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
  expect(nameOf(el, "root")).toBe(menuLabel("Lunch Menu"));
  expect(row(el, "root")!.getAttribute("aria-level")).toBe("1");
  for (const key of ["m-burger", "m-drinks", "m-fav"])
    expect(row(el, key)!.getAttribute("aria-level")).toBe("2");
  expect(["m-burger", "m-drinks", "m-fav"].map((key) => nameOf(el, key))).toEqual([
    "Burger",
    "Drinks",
    "Favourites",
  ]);

  el.nodes = [favourites(), productNode("m-burger", "p-burger"), drinksNode("m-drinks")];
  await settle(el);
  expect(shown(el)).toEqual(["root", "m-fav", "m-burger", "m-drinks"]);
});

it("starts with sections closed and opens and closes one by a click on its row, by staff names", async () => {
  const el = await mount();
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
  await toggle(el, "m-drinks");
  expect(shown(el)).toEqual([
    "root",
    "m-burger",
    "m-drinks",
    "m-drinks/m-lager",
    "m-drinks/m-beer",
    "m-drinks/m-lemonade",
    "m-fav",
  ]);
  expect(
    ["m-drinks/m-lager", "m-drinks/m-beer", "m-drinks/m-lemonade"].map((key) => nameOf(el, key)),
  ).toEqual(["Lager", "Beer", "Lemonade"]);
  expect(row(el, "m-drinks/m-lager")!.getAttribute("aria-level")).toBe("3");
  const text = table(el).shadowRoot!.textContent!;
  for (const wrong of ["Bebidas", "Something to drink", "for guests", "COCINA"])
    expect(text).not.toContain(wrong);
  expect(row(el, "m-drinks")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    t("menus.collapse").replace("{name}", "Drinks"),
  );
  await toggle(el, "m-drinks");
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
  expect(row(el, "m-drinks")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    t("menus.expand").replace("{name}", "Drinks"),
  );
});

it("opens and closes each place a section is shown on its own", async () => {
  const el = await mount();
  await toggle(el, "m-fav");
  await toggle(el, "m-fav/m-fav-drinks");
  expect(shown(el)).toEqual([
    "root",
    "m-burger",
    "m-drinks",
    "m-fav",
    "m-fav/m-fav-lemonade",
    "m-fav/m-fav-drinks",
    "m-fav/m-fav-drinks/m-lager",
    "m-fav/m-fav-drinks/m-beer",
    "m-fav/m-fav-drinks/m-lemonade",
  ]);
  await toggle(el, "m-drinks");
  await toggle(el, "m-fav/m-fav-drinks");
  expect(shown(el)).toEqual([
    "root",
    "m-burger",
    "m-drinks",
    "m-drinks/m-lager",
    "m-drinks/m-beer",
    "m-drinks/m-lemonade",
    "m-fav",
    "m-fav/m-fav-lemonade",
    "m-fav/m-fav-drinks",
  ]);
});

it("offers the adds on the root and on each place an owned section is shown, naming that list", async () => {
  const el = await mount();
  const adds = listen(el, "wt-structure-add");
  expect(menuItems(el, "root")).toEqual([
    "new-section-root",
    "include-menu-root",
    "open-add-products-root",
  ]);
  expect(
    ["new-section-root", "include-menu-root", "open-add-products-root"].map((test) =>
      item(el, test).textContent!.trim(),
    ),
  ).toEqual([t("menus.new_section"), t("menus.include_menu"), t("sections.add_products")]);
  item(el, "new-section-root").click();
  item(el, "include-menu-root").click();
  item(el, "open-add-products-root").click();
  item(el, "open-add-products-m-drinks").click();
  await toggle(el, "m-fav");
  item(el, "new-section-m-fav/m-fav-drinks").click();
  expect(adds).toEqual([
    { action: "new-section", path: [] },
    { action: "include-menu", path: [] },
    { action: "add-products", path: [] },
    { action: "add-products", path: ["m-drinks"] },
    { action: "new-section", path: ["m-fav", "m-fav-drinks"] },
  ]);
  expect(inTable(el, '[data-test="actions-root"]')!.getAttribute("label")).toBe(
    `${t("members.actions")}: ${menuLabel("Lunch Menu")}`,
  );
});

it("offers Edit and Delete on an owned section and Remove on a product, naming the holding list", async () => {
  const el = await mount();
  const edits = listen(el, "wt-member-edit");
  const deletes = listen(el, "wt-member-delete");
  const removes = listen(el, "wt-member-remove");
  expect(menuItems(el, "m-drinks")).toEqual([
    "new-section-m-drinks",
    "include-menu-m-drinks",
    "open-add-products-m-drinks",
    "edit-m-drinks",
    "delete-m-drinks",
  ]);
  expect(inTable(el, '[data-test="actions-m-drinks"] hr[part~="menu-divider"]')).not.toBeNull();
  item(el, "edit-m-drinks").click();
  item(el, "delete-m-drinks").click();
  expect(edits).toEqual([{ sectionId: "s-drinks", path: ["m-drinks"] }]);
  expect(deletes).toEqual([{ sectionId: "s-drinks", path: ["m-drinks"] }]);

  expect(menuItems(el, "m-burger")).toEqual(["remove-m-burger"]);
  expect(item(el, "remove-m-burger").textContent!.trim()).toBe(
    t("members.remove_from").replace("{list}", "Lunch Menu"),
  );
  await toggle(el, "m-drinks");
  expect(menuItems(el, "m-drinks/m-lemonade")).toEqual(["remove-m-drinks/m-lemonade"]);
  expect(item(el, "remove-m-drinks/m-lemonade").textContent!.trim()).toBe(
    t("members.remove_from").replace("{list}", "Drinks"),
  );
  item(el, "remove-m-drinks/m-lemonade").click();
  expect(removes).toEqual([{ path: ["m-drinks"], memberId: "m-lemonade" }]);
});

it("draws an included menu read-only, with a link to its own editor and a way to remove it", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()] });
  const removes = listen(el, "wt-member-remove");
  const edits = listen(el, "wt-structure-edit");
  expect(nameOf(el, "included-wine")).toBe(menuLabel("Wines"));
  expect(item(el, "read-only-included-wine").textContent!.trim()).toBe(t("menus.read_only_here"));
  expect(menuItems(el, "included-wine")).toEqual(["source-included-wine", "remove-included-wine"]);
  const link = item(el, "source-included-wine");
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe("/manage/menus/menu/wine/view/structure");
  expect(link.textContent!.trim()).toBe(t("menus.edit_included").replace("{name}", "Wines"));
  expect(item(el, "remove-included-wine").textContent!.trim()).toBe(t("menus.remove_included"));
  item(el, "remove-included-wine").click();
  expect(removes).toEqual([{ path: [], memberId: "included-wine" }]);
  // The included menu's own row is one of Lunch's members, so it can be moved like any other.
  expect(row(el, "included-wine")!.querySelector('[part~="drag-grip"]')).not.toBeNull();

  await toggle(el, "included-wine");
  await toggle(el, "included-wine/wine-red");
  const inside = [
    "included-wine/wine-red",
    "included-wine/wine-red/wine-rioja",
    "included-wine/wine-lager",
  ];
  expect(shown(el).slice(-4)).toEqual(["included-wine", ...inside]);
  for (const key of inside) {
    const tr = row(el, key)!;
    expect(tr.querySelector('[part~="drag-grip"]'), key).toBeNull();
    expect(tr.querySelector('[part~="grip-space"]'), key).not.toBeNull();
    expect(tr.querySelector("wt-row-actions"), key).toBeNull();
    expect(tr.querySelector('[data-test="name"]')!.getAttribute("part")!.split(" "), key).toContain(
      "read-only",
    );
    expect(tr.querySelector('[data-test="kind"]')!.getAttribute("part")!.split(" "), key).toContain(
      "read-only",
    );
  }
  await toggle(el, "included-wine/wine-red");
  expect(shown(el)).not.toContain("included-wine/wine-red/wine-rioja");
  // Nothing inside another menu can be the list being edited here.
  expect(edits).toEqual([]);
});

it("opens the way to the current section and marks only its name current", async () => {
  const el = await mount({ current: ["m-drinks", "m-beer"] });
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
  expect(row(el, "m-drinks/m-beer")!.getAttribute("aria-expanded")).toBe("true");
  expect(shown(el)).toContain("m-drinks/m-beer/m-lager-2");
  const marked = all(el, '[aria-current="true"]');
  expect(marked).toHaveLength(1);
  expect(marked[0]!.textContent!.trim()).toBe("Beer");
  expect(marked[0]!.getAttribute("part")!.split(" ")).toContain("current");
  expect(getComputedStyle(marked[0]!).textDecorationLine).toContain("underline");
  expect(Number(getComputedStyle(marked[0]!).fontWeight)).toBeGreaterThan(
    Number(getComputedStyle(row(el, "m-drinks")!.querySelector('[data-test="name"]')!).fontWeight),
  );

  el.current = ["m-fav", "m-fav-drinks"];
  await settle(el);
  expect(row(el, "m-fav")!.getAttribute("aria-expanded")).toBe("true");
  expect(row(el, "m-fav/m-fav-drinks")!.getAttribute("aria-expanded")).toBe("true");
  expect(
    all(el, '[aria-current="true"]').map((name) => name.closest("tr")!.dataset.rowKey),
  ).toEqual(["m-fav/m-fav-drinks"]);

  el.current = [];
  await settle(el);
  expect(all(el, '[aria-current="true"]').map((name) => name.dataset.test)).toEqual(["root-name"]);
});

it("reports opening a section, and closing the current one or one holding it, as the place to edit", async () => {
  const el = await mount({ current: ["m-drinks", "m-beer"] });
  const edits = listen(el, "wt-structure-edit");
  await toggle(el, "m-fav");
  expect(edits).toEqual([{ path: ["m-fav"] }]);
  await toggle(el, "m-fav");
  expect(edits).toHaveLength(1);
  await toggle(el, "m-drinks/m-beer");
  expect(edits).toEqual([{ path: ["m-fav"] }, { path: ["m-drinks"] }]);

  el.current = ["m-drinks", "m-beer"];
  await settle(el);
  edits.length = 0;
  await toggle(el, "m-drinks");
  expect(edits).toEqual([{ path: [] }]);
});

it("reports the top level as the place to edit when Collapse all hides the current section", async () => {
  const el = await mount({ current: ["m-drinks", "m-beer"] });
  const edits = listen(el, "wt-structure-edit");
  const button = () => inTable(el, ".expand-all")!;
  expect(button().textContent!.trim()).toBe(t("folders.expand_all"));
  button().click();
  await settle(el);
  expect(edits).toEqual([]);
  expect(button().textContent!.trim()).toBe(t("folders.collapse_all"));
  button().click();
  await settle(el);
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
  expect(edits).toEqual([{ path: [] }]);
});

it("keeps the current section open when a refresh gives it its first member", async () => {
  const starters = (children: MenuStructureNode[]): MenuStructureNode => ({
    memberId: "m-starters",
    ref: { kind: "section", sectionId: "s-starters" },
    internalName: "Starters",
    ownerMenuId: "menu-lunch",
    children,
  });
  const el = await mount({ nodes: [...lunchNodes(), starters([])], current: ["m-starters"] });
  const edits = listen(el, "wt-structure-edit");
  el.nodes = [...lunchNodes(), starters([productNode("m-soup", "p-burger")])];
  await settle(el);
  expect(row(el, "m-starters")!.getAttribute("aria-expanded")).toBe("true");
  expect(shown(el)).toContain("m-starters/m-soup");
  expect(edits).toEqual([]);
});

it("disables every row action and grip while busy, and a click on one sends nothing", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()], busy: true });
  await toggle(el, "m-drinks");
  const sent: string[] = [];
  for (const name of ["wt-structure-add", "wt-member-remove", "wt-member-edit", "wt-member-delete"])
    el.addEventListener(name, () => sent.push(name));
  const buttons = all(el, "wt-row-actions wt-button");
  expect(buttons.length).toBeGreaterThan(10);
  for (const button of buttons) {
    expect((button as HTMLElement & { disabled: boolean }).disabled, button.dataset.test).toBe(
      true,
    );
    button.click();
  }
  const grips = all<HTMLButtonElement>(el, '[part~="drag-grip"]');
  expect(grips.length).toBeGreaterThan(3);
  for (const grip of grips) expect(grip.disabled, grip.dataset.test).toBe(true);
  expect(sent).toEqual([]);

  el.busy = false;
  await settle(el);
  expect(
    all(el, "wt-row-actions wt-button").every(
      (button) => !(button as HTMLElement & { disabled: boolean }).disabled,
    ),
  ).toBe(true);
});

it("shows an empty menu as its root row, saying so, with its menu of adds", async () => {
  const el = await mount({ nodes: [] });
  expect(shown(el)).toEqual(["root"]);
  expect(nameOf(el, "root")).toBe(menuLabel("Lunch Menu"));
  expect(item(el, "empty").textContent!.trim()).toBe(t("menus.structure_empty"));
  expect(menuItems(el, "root")).toEqual([
    "new-section-root",
    "include-menu-root",
    "open-add-products-root",
  ]);
});

it("focuses a row's menu, or its nearest drawn ancestor's when the row is gone", async () => {
  const el = await mount({ current: ["m-drinks", "m-beer"] });
  const focused = () => (table(el).shadowRoot!.activeElement as HTMLElement | null)?.dataset.test;
  el.focusRowMenu("m-drinks/m-beer");
  expect(focused()).toBe("actions-m-drinks/m-beer");

  el.nodes = [productNode("m-burger", "p-burger"), { ...drinksNode("m-drinks"), children: [] }];
  await settle(el);
  el.focusRowMenu("m-drinks/m-beer");
  expect(focused()).toBe("actions-m-drinks");

  el.focusRowMenu("m-gone/m-also-gone");
  expect(focused()).toBe("actions-root");
  el.focusRowMenu("m-drinks");
  el.focusRowMenu("root");
  expect(focused()).toBe("actions-root");
  // Before it is drawn there is no menu to focus, and asking is harmless.
  document.createElement("dashboard-menu-structure-table").focusRowMenu("root");
});

it("keeps every row's menu on a phone's screen", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    await page.viewport(390, 844);
    expect(window.innerWidth).toBe(390);
    const el = await mount({
      nodes: [...lunchNodes(), productNode("m-long", "p-long"), wines()],
      products: [...products, product("p-long", "Menú-del-mediodía-de-lunes-a-viernes-con-postre")],
      current: ["m-drinks"],
    });
    // Nine rows fit in the phone's height, so each menu can be found where it is drawn.
    expect(shown(el)).toHaveLength(9);
    expectRowMenusOnScreen(table(el), 9, 'wt-row-actions[data-test^="actions-"]');
  } finally {
    await page.viewport(width, height);
  }
});

it("names a section it has no name for as no longer available", async () => {
  const el = await mount({
    nodes: [{ memberId: "m-lost", ref: { kind: "section", sectionId: "s-lost" } }],
  });
  expect(nameOf(el, "m-lost")).toBe(t("members.missing"));
  expect(shown(el)).toEqual(["root", "m-lost"]);
});

it("names the root apart from its members", async () => {
  const el = await mount();
  expect(row(el, "root")!.querySelector('[data-test="root-name"]')!.textContent!.trim()).toBe(
    menuLabel("Lunch Menu"),
  );
  expect(row(el, "root")!.querySelector('[data-test="name"]')).toBeNull();
  expect(all(el, '[data-test="name"]').map((name) => name.textContent!.trim())).toEqual([
    "Burger",
    "Drinks",
    "Favourites",
  ]);
});

/** Every kind of row the tree draws, four levels deep: the menu, a product with a photo and ones
 * without, owned sections, an included menu, and a section and products inside it. */
const DEEP_ROWS = [
  "root",
  "m-burger",
  "m-drinks",
  "m-drinks/m-lager",
  "m-drinks/m-beer",
  "m-drinks/m-beer/m-lager-2",
  "m-drinks/m-lemonade",
  "m-fav",
  "included-wine",
  "included-wine/wine-red",
  "included-wine/wine-red/wine-rioja",
  "included-wine/wine-lager",
];

async function mountDeep(props: Partial<MenuStructureTable> = {}) {
  const el = await mount({ nodes: [...lunchNodes(), wines()], ...props });
  for (const key of ["m-drinks", "m-drinks/m-beer", "included-wine", "included-wine/wine-red"]) {
    table(el).setExpanded(key, true);
    await settle(el);
  }
  expect(shown(el)).toEqual(DEEP_ROWS);
  return el;
}

/** Where a row's name text, grip slot and leading slot start, and where their middles are. */
function pieces(el: MenuStructureTable, key: string) {
  const tr = row(el, key)!;
  const box = (rect: DOMRect | undefined) =>
    rect && { left: rect.left, middle: rect.top + rect.height / 2 };
  const text = document.createRange();
  text.selectNodeContents(tr.querySelector('[data-test="name"], [data-test="root-name"]')!);
  return {
    level: Number(tr.getAttribute("aria-level")),
    grip: box(
      tr.querySelector('[part~="drag-grip"], [part~="grip-space"]')?.getBoundingClientRect(),
    ),
    media: box(
      tr
        .querySelector('[part~="folder-frame"], [part~="thumb-frame"], [part~="thumb-placeholder"]')
        ?.getBoundingClientRect(),
    ),
    name: box(text.getBoundingClientRect())!,
    stack: box(tr.querySelector('[part~="name-stack"]')!.getBoundingClientRect())!,
  };
}

it.each([1280, 390].flatMap((width) => [true, false].map((reordering) => ({ width, reordering }))))(
  "starts every name one even step further in per level, the menu, sections, included menus and products alike ($width px, reordering: $reordering)",
  async ({ width, reordering }) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 844);
      const el = await mountDeep({ reordering });
      const rows = DEEP_ROWS.map((key) => ({ key, ...pieces(el, key) }));
      const step = rows.find(({ level }) => level === 2)!.name.left - rows[0]!.name.left;
      expect(step).toBeGreaterThan(0);
      for (const { key, level, name } of rows)
        expect(name.left, key).toBeCloseTo(rows[0]!.name.left + (level - 1) * step, 0);
      for (const current of rows) {
        const twin = rows.find(
          (other) => other.level === current.level && other.key !== current.key,
        );
        if (!twin) continue;
        if (reordering) expect(current.grip?.left, current.key).toBeCloseTo(twin.grip!.left, 0);
        else expect(current.grip, current.key).toBeUndefined();
        expect(current.media?.left, current.key).toBeCloseTo(twin.media!.left, 0);
      }
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it("keeps a blank grip slot on the menu's row, so its name starts where the Products tree's All products does", async () => {
  const el = await mountDeep();
  const tr = row(el, "root")!;
  expect(tr.querySelector('[part~="grip-space"]')).not.toBeNull();
  const tokens = getComputedStyle(el);
  const tap = parseFloat(tokens.getPropertyValue("--wt-tap-min"));
  const gap = parseFloat(tokens.getPropertyValue("--wt-space-3"));
  expect(tap).toBeGreaterThan(0);
  const start = tr.querySelector(".tree-cell")!.getBoundingClientRect().left;
  // The control column precedes the name cell; its arrow and media slot stay inside it.
  expect(pieces(el, "root").name.left - start).toBeCloseTo(2 * tap + gap, 0);
});

// The name and any note under it (an included menu's "read only here") are centred as one.
it.each([true, false])(
  "lines each row's grip, leading slot and name up on one middle (reordering: %s)",
  async (reordering) => {
    const el = await mountDeep({ reordering });
    for (const key of DEEP_ROWS) {
      const { grip, media, stack } = pieces(el, key);
      if (reordering) expect(Math.abs(grip!.middle - media!.middle), key).toBeLessThanOrEqual(1);
      else expect(grip, key).toBeUndefined();
      expect(Math.abs(stack.middle - media!.middle), key).toBeLessThanOrEqual(3);
    }
  },
);

it.each([1280, 390].flatMap((width) => [true, false].map((reordering) => ({ width, reordering }))))(
  "lines a section's swatch and name up with its arrow and its Type on one middle ($width px, reordering: $reordering)",
  async ({ width, reordering }) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 844);
      const el = await mountDeep({ reordering });
      const middle = (rect: DOMRect) => rect.top + rect.height / 2;
      const textMiddle = (node: Element) => {
        const text = document.createRange();
        text.selectNodeContents(node);
        return middle(text.getBoundingClientRect());
      };
      for (const key of ["m-drinks", "m-drinks/m-beer", "m-fav", "included-wine/wine-red"]) {
        const tr = row(el, key)!;
        const arrow = middle(
          tr.querySelector(".tree-arrow, .tree-toggle")!.getBoundingClientRect(),
        );
        const kind = textMiddle(tr.querySelector('[data-test="kind"]')!);
        const swatch = middle(tr.querySelector('[part~="color-swatch"]')!.getBoundingClientRect());
        const name = textMiddle(tr.querySelector('[data-test="name"]')!);
        for (const [what, at] of [
          ["swatch", swatch],
          ["name", name],
        ] as const) {
          // The table lines its larger arrow glyph up by baseline, which put the arrow's middle
          // 2.5 px above the Type text's in every row measured.
          expect(Math.abs(at - arrow), `${key} ${what} to arrow`).toBeLessThanOrEqual(3);
          expect(Math.abs(at - kind), `${key} ${what} to Type`).toBeLessThanOrEqual(2);
        }
      }
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it.each([1280, 390])(
  "puts the Name heading over the menu's name, also at phone width, where the tree's arrow slot narrows (%ipx)",
  async (width) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 844);
      const el = await mountDeep();
      for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
      expect(table(el).hasAttribute("narrow")).toBe(width === 390);
      const heading = inTable(el, 'thead [part~="tree-heading"]')!;
      expect(heading.textContent!.trim()).toBe(t("members.name"));
      expect(heading.getBoundingClientRect().left).toBeCloseTo(pieces(el, "root").name.left, 0);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

function grip(el: MenuStructureTable, key: string): HTMLButtonElement {
  return inTable<HTMLButtonElement>(el, `[data-test="drag-${CSS.escape(key)}"]`)!;
}

/** The data-test of what has focus inside the table. */
function focusedInTable(el: MenuStructureTable): string | undefined {
  return (table(el).shadowRoot!.activeElement as HTMLElement | null)?.dataset.test;
}

async function press(el: MenuStructureTable, key: string, which: "ArrowUp" | "ArrowDown") {
  grip(el, key).focus();
  await userEvent.keyboard(`{${which}}`);
  await settle(el);
}

function announced(el: MenuStructureTable): string {
  return el.shadowRoot!.querySelector('[role="status"]')!.textContent!;
}

const reordered = (item: string, index: number, total: number) =>
  t("action.reordered")
    .replace("{item}", item)
    .replace("{index}", String(index))
    .replace("{total}", String(total));

it("moves a member a place with the arrow keys on its grip, shown at once and announced, keeping focus", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  await press(el, "m-burger", "ArrowDown");
  expect(moves).toEqual([{ path: [], memberId: "m-burger", to: 1 }]);
  expect(shown(el)).toEqual(["root", "m-drinks", "m-burger", "m-fav"]);
  expect(focusedInTable(el)).toBe("drag-m-burger");
  expect(announced(el)).toBe(reordered("Burger", 2, 3));

  // The second press works from the order on screen, not the order the host last sent.
  await userEvent.keyboard("{ArrowDown}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 2 });
  expect(shown(el)).toEqual(["root", "m-drinks", "m-fav", "m-burger"]);
  expect(focusedInTable(el)).toBe("drag-m-burger");

  await userEvent.keyboard("{ArrowUp}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 1 });
  expect(announced(el)).toBe(reordered("Burger", 2, 3));
  await userEvent.keyboard("{ArrowUp}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 0 });
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
  expect(announced(el)).toBe(reordered("Burger", 1, 3));
  expect(moves).toHaveLength(4);
});

it("sends nothing for ArrowUp on the first member or ArrowDown on the last", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  await press(el, "m-burger", "ArrowUp");
  await press(el, "m-fav", "ArrowDown");
  expect(moves).toEqual([]);
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
});

it("moves a member within its own section, leaving the top level alone", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  await toggle(el, "m-drinks");
  await press(el, "m-drinks/m-lager", "ArrowDown");
  expect(moves).toEqual([{ path: ["m-drinks"], memberId: "m-lager", to: 1 }]);
  expect(shown(el)).toEqual([
    "root",
    "m-burger",
    "m-drinks",
    "m-drinks/m-beer",
    "m-drinks/m-lager",
    "m-drinks/m-lemonade",
    "m-fav",
  ]);
  expect(focusedInTable(el)).toBe("drag-m-drinks/m-lager");
  expect(announced(el)).toBe(reordered("Lager", 2, 3));
});

it("shows a move in a section everywhere that section is shown", async () => {
  const el = await mount();
  await toggle(el, "m-drinks");
  await press(el, "m-drinks/m-lager", "ArrowDown");
  await toggle(el, "m-fav");
  await toggle(el, "m-fav/m-fav-drinks");
  expect(shown(el).filter((key) => key.startsWith("m-fav/m-fav-drinks/"))).toEqual([
    "m-fav/m-fav-drinks/m-beer",
    "m-fav/m-fav-drinks/m-lager",
    "m-fav/m-fav-drinks/m-lemonade",
  ]);
});

it("carries an open section's members with it when it moves", async () => {
  const el = await mount();
  await toggle(el, "m-drinks");
  await press(el, "m-drinks", "ArrowUp");
  expect(shown(el)).toEqual([
    "root",
    "m-drinks",
    "m-drinks/m-lager",
    "m-drinks/m-beer",
    "m-drinks/m-lemonade",
    "m-burger",
    "m-fav",
  ]);
  expect(focusedInTable(el)).toBe("drag-m-drinks");
});

it("draws what a new nodes value says, dropping the moves it showed before", async () => {
  const el = await mount();
  await press(el, "m-burger", "ArrowDown");
  expect(shown(el)).toEqual(["root", "m-drinks", "m-burger", "m-fav"]);
  el.nodes = lunchNodes();
  await settle(el);
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
});

function keyOn(el: MenuStructureTable, key: string, which: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: which,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  grip(el, key).dispatchEvent(event);
  return event;
}

it("keeps an arrow on a grip from scrolling the page, even at the end of the list", async () => {
  const el = await mount();
  expect(keyOn(el, "m-burger", "ArrowUp").defaultPrevented).toBe(true);
  expect(keyOn(el, "m-burger", "ArrowDown").defaultPrevented).toBe(true);
  expect(keyOn(el, "m-burger", "Tab").defaultPrevented).toBe(false);
});

it("moves nothing by key while busy", async () => {
  const el = await mount({ busy: true });
  const moves = listen(el, "wt-member-move");
  keyOn(el, "m-burger", "ArrowDown");
  await settle(el);
  expect(moves).toEqual([]);
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
});

/** Sends a pointer event from `target`, placed over `over` (by default the target itself). */
function pointer(
  target: Element,
  type: string,
  over: Element = target,
  init: PointerEventInit = {},
): PointerEvent {
  const box = over.getBoundingClientRect();
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId: 1,
    clientX: box.x + 8,
    clientY: box.y + box.height / 2,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** Where a pointer over the row lands: its name. */
function nameAt(el: MenuStructureTable, key: string): HTMLElement {
  return row(el, key)!.querySelector<HTMLElement>('[data-test="name"], [data-test="root-name"]')!;
}

/** The rows with `part` on themselves or one of their cells. */
function marked(el: MenuStructureTable, part: string): string[] {
  return [
    ...new Set(all(el, `[part~="${part}"]`).map((mark) => mark.closest("tr")!.dataset.rowKey!)),
  ];
}

function ghost(el: MenuStructureTable): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-ghost"]');
}

describe("with reordering off", () => {
  const HOME_WITH_SHORTCUT: MenuHome = {
    homeSectionId: "s-home",
    shortcuts: [
      {
        memberId: "t-one",
        position: 0,
        ref: { kind: "product", productId: "p-burger" },
        missingName: null,
        name: "Burger",
        reachable: true,
      },
    ],
    handheld: { columns: 3, tiles: "colours", order: "home_first" },
    till: { columns: 6, tiles: "colours", order: "home_first" },
  };

  it.each([1280, 390])(
    "draws no grip or grip space on any row, and puts the Name heading over the menu's name (%ipx)",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const el = await mountDeep({ reordering: false });
        el.home = HOME_WITH_SHORTCUT;
        await settle(el);
        for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
        await toggle(el, "home");
        expect(shown(el)).toContain("home/t-one");
        expect(all(el, "tbody tr[data-row-key]").length).toBe(DEEP_ROWS.length + 2);
        expect(all(el, '[part~="drag-grip"], [part~="grip-space"]')).toEqual([]);
        expect(table(el).hasAttribute("narrow")).toBe(width === 390);
        const heading = inTable(el, 'thead [part~="tree-heading"]')!;
        expect(heading.getBoundingClientRect().left).toBeCloseTo(pieces(el, "root").name.left, 0);
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  it("ends a drag held when the mode turns off, sending no move and leaving no row marked", async () => {
    const el = await mount();
    const moves = listen(el, "wt-member-move");
    const from = grip(el, "m-burger");
    pointer(from, "pointerdown");
    pointer(from, "pointermove", nameAt(el, "m-fav"));
    await settle(el);
    expect(marked(el, "dragging")).toEqual(["m-burger"]);
    el.reordering = false;
    await settle(el);
    pointer(nameAt(el, "m-fav"), "pointerup");
    await settle(el);
    expect(moves).toEqual([]);
    expect(marked(el, "dragging")).toEqual([]);
    expect(marked(el, "drop-gap-after")).toEqual([]);
    expect(ghost(el)).toBeNull();
  });
});

it("drags a member below a sibling, marking it, with a ghost and a gap, and sends one move on release", async () => {
  const el = await mount();
  await toggle(el, "m-fav");
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  expect(pointer(from, "pointerdown").defaultPrevented).toBe(true);
  expect(pointer(from, "pointermove", nameAt(el, "m-drinks")).defaultPrevented).toBe(true);
  const last = pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(row(el, "m-burger")!.part.contains("dragging")).toBe(true);
  expect(row(el, "m-burger")!.getAttribute("aria-disabled")).toBe("true");
  expect(ghost(el)!.textContent!.trim()).toBe("Burger");
  const placed = new DOMMatrixReadOnly(ghost(el)!.style.transform);
  expect(placed.e).toBeCloseTo(last.clientX, 1);
  expect(placed.f).toBeCloseTo(last.clientY, 1);
  expect(marked(el, "drop-gap-after")).toEqual(["m-fav/m-fav-drinks"]);
  expect(marked(el, "drop-gap-before")).toEqual([]);
  const gapCell = row(el, "m-fav/m-fav-drinks")!.querySelector("td")!;
  expect(getComputedStyle(gapCell).borderBottomStyle).toBe("dashed");

  pointer(from, "pointerup", nameAt(el, "m-fav"));
  await settle(el);
  expect(moves).toEqual([{ path: [], memberId: "m-burger", to: 2 }]);
  expect(shown(el)).toEqual([
    "root",
    "m-drinks",
    "m-fav",
    "m-fav/m-fav-lemonade",
    "m-fav/m-fav-drinks",
    "m-burger",
  ]);
  expect(marked(el, "dragging")).toEqual([]);
  expect(row(el, "m-burger")!.hasAttribute("aria-disabled")).toBe(false);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  expect(ghost(el)).toBeNull();
});

it("shows the gap before the sibling when dragging upwards", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-fav");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-burger"));
  await settle(el);
  expect(marked(el, "drop-gap-before")).toEqual(["m-burger"]);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-burger"));
  expect(moves).toEqual([{ path: [], memberId: "m-fav", to: 0 }]);
});

it("offers no gap over a row outside the dragged member's own list, and a release there sends nothing", async () => {
  const el = await mount();
  await toggle(el, "m-drinks");
  await toggle(el, "m-fav");
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-drinks/m-lager");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-drinks/m-lemonade"));
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual(["m-drinks/m-lemonade"]);
  for (const key of ["m-fav/m-fav-lemonade", "m-burger", "m-drinks", "root"]) {
    pointer(from, "pointermove", nameAt(el, key));
    await settle(el);
    expect([...marked(el, "drop-gap-after"), ...marked(el, "drop-gap-before")], key).toEqual([]);
  }
  pointer(from, "pointerup", nameAt(el, "root"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(shown(el).filter((key) => key.startsWith("m-drinks/"))).toEqual([
    "m-drinks/m-lager",
    "m-drinks/m-beer",
    "m-drinks/m-lemonade",
  ]);
});

it("cancels a drag on Escape, sending nothing, and the click that ends it toggles nothing", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-drinks"));
  await settle(el);
  expect(marked(el, "dragging")).toEqual(["m-burger"]);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
  await settle(el);
  expect(marked(el, "dragging")).toEqual(["m-burger"]);
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  expect(ghost(el)).toBeNull();
  // A person lets go of the button a moment after Esc, never within the same task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  pointer(from, "pointerup", nameAt(el, "m-drinks"));
  row(el, "m-drinks")!
    .querySelector(".row-activate")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  await settle(el);
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
  expect(moves).toEqual([]);
});

it("toggles nothing with the click a release sends", async () => {
  const el = await mount();
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-drinks"));
  pointer(from, "pointerup", nameAt(el, "m-drinks"));
  row(el, "m-drinks")!
    .querySelector(".row-activate")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  await settle(el);
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await toggle(el, "m-drinks");
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
});

it("sends nothing when the pointer is cancelled", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  pointer(from, "pointercancel", nameAt(el, "m-fav"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(marked(el, "dragging")).toEqual([]);
  expect(ghost(el)).toBeNull();
});

it("sends nothing when a drag is released where it started", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  pointer(from, "pointermove", nameAt(el, "m-burger"));
  await settle(el);
  expect([...marked(el, "drop-gap-after"), ...marked(el, "drop-gap-before")]).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-burger"));
  expect(moves).toEqual([]);
});

it("maps a row to the sibling holding it by whole member ids, not by a shared prefix", async () => {
  const el = await mount({
    nodes: [
      productNode("m-burger", "p-burger"),
      { ...favourites(), children: [productNode("m-fav-lemonade", "p-lemonade")] },
      drinksNode("m-fav-drinks"),
    ],
  });
  await toggle(el, "m-fav-drinks");
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav-drinks/m-lager"));
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual(["m-fav-drinks/m-lemonade"]);
  pointer(from, "pointerup", nameAt(el, "m-fav-drinks/m-lager"));
  expect(moves).toEqual([{ path: [], memberId: "m-burger", to: 2 }]);
});

it("has no grip on the menu's own row, only the grip's blank space", async () => {
  const el = await mount();
  expect(row(el, "root")!.querySelector('[part~="drag-grip"]')).toBeNull();
  expect(row(el, "root")!.querySelector('[part~="grip-space"]')).not.toBeNull();
});

it("starts no drag while busy or from a button other than the main one", async () => {
  const el = await mount({ busy: true });
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-fav"));

  el.busy = false;
  await settle(el);
  pointer(from, "pointerdown", from, { button: 2 });
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-fav"));
  expect(moves).toEqual([]);
});

it("sends nothing from a drag released after the tree turned busy", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  el.busy = true;
  await settle(el);
  pointer(from, "pointerup", nameAt(el, "m-fav"));
  expect(moves).toEqual([]);
});

it("hands the page's cursor back when removed mid-drag", async () => {
  const el = await mount();
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  expect(document.body.style.cursor).toBe("grabbing");
  el.remove();
  expect(document.body.style.cursor).not.toBe("grabbing");
});

it("starts no drag for a press that barely moves, and leaves the click after it alone", async () => {
  const el = await mount();
  const from = grip(el, "m-burger");
  const box = from.getBoundingClientRect();
  pointer(from, "pointerdown");
  pointer(from, "pointermove", from, { clientX: box.x + 10, clientY: box.y + box.height / 2 + 2 });
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  expect(ghost(el)).toBeNull();
  pointer(from, "pointerup");
  await toggle(el, "m-drinks");
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
});

it("follows only the pointer that started the drag", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"), { pointerId: 2 });
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  pointer(from, "pointerup", nameAt(el, "m-fav"), { pointerId: 2 });
  await settle(el);
  expect(marked(el, "dragging")).toEqual(["m-burger"]);
  expect(moves).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-fav"));
  expect(moves).toEqual([{ path: [], memberId: "m-burger", to: 2 }]);
});

it("keeps the marks on the right rows when a refresh redraws the tree mid-drag", async () => {
  const el = await mount();
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  el.nodes = [favourites(), productNode("m-burger", "p-burger"), drinksNode("m-drinks")];
  await settle(el);
  expect(marked(el, "dragging")).toEqual(["m-burger"]);
  // Favourites is now above Burger, so the gap is before it.
  expect(marked(el, "drop-gap-before")).toEqual(["m-fav"]);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  pointer(from, "pointercancel");
});

it("offers no gap while the pointer is over no row", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual(["m-fav"]);
  const below = table(el).getBoundingClientRect().bottom + 40;
  expect(below).toBeLessThan(window.innerHeight);
  pointer(from, "pointermove", from, { clientY: below });
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  expect(marked(el, "dragging")).toEqual(["m-burger"]);
  pointer(from, "pointerup", from, { clientY: below });
  expect(moves).toEqual([]);
});

it("sends nothing for a drag whose member a refresh removed", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  el.nodes = [drinksNode("m-drinks"), favourites()];
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual([]);
  // Burger's grip has left the page, so the pointer's events now come from the row under it.
  expect(from.isConnected).toBe(false);
  pointer(nameAt(el, "m-fav"), "pointermove");
  await settle(el);
  expect([...marked(el, "drop-gap-after"), ...marked(el, "drop-gap-before")]).toEqual([]);
  pointer(nameAt(el, "m-fav"), "pointerup");
  expect(moves).toEqual([]);
});

it("sends nothing when released straight after a refresh removed the dragged member", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  el.nodes = [drinksNode("m-drinks"), favourites()];
  await settle(el);
  pointer(nameAt(el, "m-fav"), "pointerup");
  expect(moves).toEqual([]);
});

it("starts no drag, and throws nothing, when a refresh removes a pressed member before it moves", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.message);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  try {
    pointer(grip(el, "m-burger"), "pointerdown");
    el.nodes = [drinksNode("m-drinks"), favourites()];
    await settle(el);
    pointer(nameAt(el, "m-fav"), "pointermove");
    await settle(el);
    expect(errors).toEqual([]);
    expect(document.body.style.cursor).not.toBe("grabbing");
    expect(ghost(el)).toBeNull();
    expect(marked(el, "dragging")).toEqual([]);
    pointer(nameAt(el, "m-fav"), "pointerup");
    expect(moves).toEqual([]);
  } finally {
    window.removeEventListener("error", onError);
  }
});

it("sends nothing when released after a refresh removed the sibling it would have moved beside", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  pointer(grip(el, "m-burger"), "pointerdown");
  pointer(grip(el, "m-burger"), "pointermove", nameAt(el, "m-fav"));
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual(["m-fav"]);
  el.nodes = [productNode("m-burger", "p-burger"), drinksNode("m-drinks")];
  await settle(el);
  pointer(grip(el, "m-burger"), "pointerup", nameAt(el, "m-drinks"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(document.body.style.cursor).not.toBe("grabbing");
  expect(shown(el)).toEqual(["root", "m-burger", "m-drinks"]);
});

function popupOpen(el: MenuStructureTable, key: string): boolean {
  return inTable(el, `[data-test="actions-${CSS.escape(key)}"]`)!
    .shadowRoot!.querySelector("[popover]")!
    .matches(":popover-open");
}

async function openMenu(el: MenuStructureTable, key: string): Promise<void> {
  inTable<HTMLElementTagNameMap["wt-row-actions"]>(
    el,
    `[data-test="actions-${CSS.escape(key)}"]`,
  )!.show();
  await settle(el);
  expect(popupOpen(el, key), key).toBe(true);
}

it("closes a row's menu after an action is chosen, and the choice opens or closes no row", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()] });
  await toggle(el, "m-drinks");
  const removes = listen(el, "wt-member-remove");
  const adds = listen(el, "wt-structure-add");

  await openMenu(el, "m-drinks/m-lemonade");
  item(el, "remove-m-drinks/m-lemonade").click();
  await settle(el);
  expect(popupOpen(el, "m-drinks/m-lemonade")).toBe(false);

  await openMenu(el, "included-wine");
  item(el, "remove-included-wine").click();
  await settle(el);
  expect(popupOpen(el, "included-wine")).toBe(false);
  expect(removes).toEqual([
    { path: ["m-drinks"], memberId: "m-lemonade" },
    { path: [], memberId: "included-wine" },
  ]);

  await openMenu(el, "m-drinks");
  item(el, "new-section-m-drinks").click();
  await settle(el);
  expect(popupOpen(el, "m-drinks")).toBe(false);
  expect(adds).toEqual([{ action: "new-section", path: ["m-drinks"] }]);
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
  expect(row(el, "included-wine")!.getAttribute("aria-expanded")).toBe("false");
});

describe("colour swatches", () => {
  const categories: CategorySummary[] = [
    { id: "c-drinks", name: "Bebidas", parentId: null, color: "#256bb1" },
    { id: "c-soft", name: "Refrescos", parentId: "c-drinks", color: null },
  ];
  /** Lager has its own colour, Lemonade takes its category's parent's, and Burger has none. */
  const coloured: Product[] = [
    { ...product("p-lager", "Lager"), color: "#b12525", categoryId: "c-soft" },
    { ...product("p-lemonade", "Lemonade"), categoryId: "c-soft" },
    product("p-burger", "Burger", "burger.webp"),
    product("p-rioja", "Rioja"),
  ];
  const paintedLunch = (): MenuStructureNode[] =>
    lunchNodes().map((node) =>
      node.memberId === "m-drinks" ? { ...node, color: "#aa3300" } : node,
    );

  async function mountColoured(props: Partial<MenuStructureTable> = {}) {
    return mount({ products: coloured, categories, nodes: paintedLunch(), ...props });
  }
  const swatchOf = (el: MenuStructureTable, key: string) =>
    row(el, key)!.querySelector<HTMLElement>(`[data-test="color-${CSS.escape(key)}"]`)!;
  const chipOf = (el: MenuStructureTable, key: string) =>
    swatchOf(el, key).querySelector<HTMLElement>('[part~="color-swatch"]')!;
  function sentEvents(el: MenuStructureTable): unknown[] {
    const sent: unknown[] = [];
    for (const name of [
      "wt-product-color",
      "wt-member-edit",
      "wt-structure-edit",
      "wt-member-move",
    ])
      el.addEventListener(name, (event) => sent.push([name, (event as CustomEvent).detail]));
    return sent;
  }

  it("paints a product's own colour, else its category's, else draws it outlined", async () => {
    const el = await mountColoured();
    await toggle(el, "m-drinks");
    expect(getComputedStyle(chipOf(el, "m-drinks/m-lager")).backgroundColor).toBe(
      "rgb(177, 37, 37)",
    );
    expect(getComputedStyle(chipOf(el, "m-drinks/m-lemonade")).backgroundColor).toBe(
      "rgb(37, 107, 177)",
    );
    expect(chipOf(el, "m-burger").part.contains("color-swatch")).toBe(true);
    expect(chipOf(el, "m-burger").part.contains("empty")).toBe(true);
    expect(getComputedStyle(chipOf(el, "m-burger")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(chipOf(el, "m-burger")).borderTopWidth).toBe("1px");

    el.categories = [{ ...categories[0]!, color: "#2a8a3e" }, categories[1]!];
    await settle(el);
    expect(getComputedStyle(chipOf(el, "m-drinks/m-lemonade")).backgroundColor).toBe(
      "rgb(42, 138, 62)",
    );
  });

  it("draws a colour that is not lowercase #rrggbb as none, so it never reaches the style", async () => {
    const malformed = "#256bb1;position:fixed;inset:0";
    const el = await mountColoured({
      products: coloured.map((item) =>
        item.id === "p-burger" ? { ...item, color: malformed } : item,
      ),
      nodes: lunchNodes().map((node) =>
        node.memberId === "m-drinks" ? { ...node, color: malformed } : node,
      ),
    });
    for (const key of ["m-burger", "m-drinks"]) {
      const chip = chipOf(el, key);
      expect(getComputedStyle(chip).position, key).toBe("static");
      expect(getComputedStyle(chip).backgroundColor, key).toBe("rgba(0, 0, 0, 0)");
      expect(chip.hasAttribute("style"), key).toBe(false);
      expect(chip.part.contains("color-swatch"), key).toBe(true);
      expect(chip.part.contains("empty"), key).toBe(true);
    }
  });

  it("draws product and section media before their names", async () => {
    const el = await mountColoured();
    const nameOf = (key: string) =>
      row(el, key)!.querySelector('[part~="name-stack"]')!.getBoundingClientRect();
    expect(swatchOf(el, "m-burger").getBoundingClientRect().right).toBeLessThanOrEqual(
      nameOf("m-burger").left,
    );
    expect(swatchOf(el, "m-drinks").getBoundingClientRect().right).toBeLessThanOrEqual(
      nameOf("m-drinks").left,
    );
  });

  it.each(
    [1280, 390].flatMap((width) => [true, false].map((reordering) => ({ width, reordering }))),
  )(
    "draws no folder icon and puts each section's swatch in its leading slot, before its name ($width px, reordering: $reordering)",
    async ({ width, reordering }) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const red = { ...wines() };
        red.children = red.children!.map((child) =>
          child.memberId === "wine-red" ? { ...child, color: "#7a1f3d" } : child,
        );
        const el = await mountColoured({ reordering, nodes: [...paintedLunch(), red] });
        await toggle(el, "included-wine");
        expect(
          table(el).shadowRoot!.querySelectorAll('tbody tr wt-icon[name="folder"]'),
        ).toHaveLength(0);
        for (const [key, part] of [
          ["m-drinks", "swatch-button"],
          ["included-wine", "swatch-box"],
          ["included-wine/wine-red", "swatch-box"],
        ] as const) {
          const swatch = swatchOf(el, key);
          expect(swatch.getAttribute("part"), key).toBe(part);
          expect(swatch.closest('[part~="folder-frame"]'), key).not.toBeNull();
          const name = row(el, key)!.querySelector('[part~="name-stack"]')!.getBoundingClientRect();
          expect(swatch.getBoundingClientRect().right, key).toBeLessThanOrEqual(name.left);
        }
        if (width === 1280) {
          const nameLeft = (key: string) => {
            const text = document.createRange();
            text.selectNodeContents(row(el, key)!.querySelector('[data-test="name"]')!);
            return text.getBoundingClientRect().left;
          };
          expect(nameLeft("m-drinks")).toBeCloseTo(nameLeft("m-burger"), 0);
        }
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );

  it("sends a product's colour request from its swatch, toggling no row and starting no drag", async () => {
    const el = await mountColoured();
    await toggle(el, "m-drinks");
    const sent = sentEvents(el);
    const swatch = swatchOf(el, "m-drinks/m-lemonade");
    expect(swatch.tagName).toBe("WT-ROW-ACTIONS");
    await (swatch as HTMLElementTagNameMap["wt-row-actions"]).updateComplete;
    expect(swatch.getAttribute("label")).toBe(
      t("product.media_actions").replace("{name}", "Lemonade"),
    );
    await userEvent.click(swatch.shadowRoot!.querySelector("button")!);
    expect(sent).toEqual([]);
    swatch.querySelector<HTMLElement>('[data-test="media-colour"]')!.click();
    await settle(el);
    expect(sent).toEqual([["wt-product-color", { productId: "p-lemonade" }]]);
    expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");

    pointer(swatch, "pointerdown");
    pointer(swatch, "pointermove", nameAt(el, "m-fav"));
    pointer(swatch, "pointerup", nameAt(el, "m-fav"));
    await settle(el);
    expect(ghost(el)).toBeNull();
    expect(sent).toEqual([["wt-product-color", { productId: "p-lemonade" }]]);
  });

  it("paints a section's own colour, and its swatch asks for the section's Edit without opening or closing it", async () => {
    const el = await mountColoured();
    const sent = sentEvents(el);
    expect(getComputedStyle(chipOf(el, "m-drinks")).backgroundColor).toBe("rgb(170, 51, 0)");
    expect(chipOf(el, "m-fav").getAttribute("part")).toBe("color-swatch empty");
    const swatch = swatchOf(el, "m-drinks");
    expect(swatch.tagName).toBe("BUTTON");
    expect(swatch.getAttribute("aria-label")).toBe(
      t("folders.edit_color").replace("{name}", "Drinks"),
    );
    const edits = listen(el, "wt-member-edit");
    item(el, "edit-m-drinks").click();
    expect(edits).toEqual([{ sectionId: "s-drinks", path: ["m-drinks"] }]);
    sent.length = 0;

    await userEvent.click(swatch);
    await settle(el);
    expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
    expect(sent).toEqual([["wt-member-edit", edits[0]]]);
    await toggle(el, "m-drinks");
    sent.length = 0;
    await userEvent.click(swatchOf(el, "m-drinks"));
    await settle(el);
    expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
    expect(sent).toEqual([["wt-member-edit", edits[0]]]);
  });

  it("draws the swatches inside an included menu as colour alone, not as buttons", async () => {
    const red = { ...wines() };
    red.children = red.children!.map((child) =>
      child.memberId === "wine-red" ? { ...child, color: "#7a1f3d" } : child,
    );
    const el = await mountColoured({
      nodes: [...paintedLunch(), red],
      products: coloured.map((each) =>
        each.id === "p-rioja" ? { ...each, color: "#4a2a6b" } : each,
      ),
    });
    await toggle(el, "included-wine");
    await toggle(el, "included-wine/wine-red");
    const sent = sentEvents(el);
    for (const [key, colour] of [
      ["included-wine", "rgba(0, 0, 0, 0)"],
      ["included-wine/wine-red", "rgb(122, 31, 61)"],
      ["included-wine/wine-red/wine-rioja", "rgb(74, 42, 107)"],
    ] as const) {
      const swatch = swatchOf(el, key);
      expect(swatch.tagName, key).not.toBe("BUTTON");
      expect(swatch.querySelector("button"), key).toBeNull();
      expect(getComputedStyle(chipOf(el, key)).backgroundColor, key).toBe(colour);
      swatch.click();
    }
    await settle(el);
    expect(sent).toEqual([]);
  });

  it("draws a product it has no record of as an outlined box, not a button", async () => {
    const el = await mountColoured({
      nodes: [productNode("m-gone", "p-gone"), ...paintedLunch()],
    });
    const sent = sentEvents(el);
    const swatch = swatchOf(el, "m-gone");
    expect(swatch.tagName).not.toBe("BUTTON");
    expect(swatch.querySelector("button")).toBeNull();
    expect(chipOf(el, "m-gone").part.contains("color-swatch")).toBe(true);
    expect(chipOf(el, "m-gone").part.contains("empty")).toBe(true);
    swatch.click();
    expect(sent).toEqual([]);
  });

  it("disables the swatches while busy, and a click on one sends nothing", async () => {
    const el = await mountColoured({ busy: true });
    const sent = sentEvents(el);
    for (const key of ["m-burger", "m-drinks"]) {
      const swatch = swatchOf(el, key) as HTMLButtonElement;
      const trigger = swatch.shadowRoot?.querySelector("button") ?? swatch;
      expect((trigger as HTMLButtonElement).disabled, key).toBe(true);
      swatch.click();
    }
    expect(sent).toEqual([]);
  });
});

describe("the Device Home Page row", () => {
  /** Burger and Drinks are on the menu; Chips is no longer reached by it. */
  const home = (): MenuHome => ({
    homeSectionId: "s-home",
    shortcuts: [
      {
        memberId: "t-burger",
        position: 0,
        ref: { kind: "product", productId: "p-burger" },
        missingName: null,
        name: "Burger",
        reachable: true,
      },
      {
        memberId: "t-drinks",
        position: 1,
        ref: { kind: "section", sectionId: "s-drinks" },
        missingName: null,
        name: "Drinks",
        reachable: true,
      },
      {
        memberId: "t-chips",
        position: 2,
        ref: { kind: "product", productId: "p-chips" },
        missingName: "Chips",
        name: "Chips",
        reachable: false,
      },
    ],
    handheld: { columns: 3, tiles: "colours", order: "home_first" },
    till: { columns: 6, tiles: "colours", order: "home_first" },
  });

  const SHORTCUT_KEYS = ["home/t-burger", "home/t-drinks", "home/t-chips"];

  const openHome = (el: MenuStructureTable) => toggle(el, "home");

  /** Each event with how it was sent, so a non-bubbling or uncomposed one fails. */
  function sentAs(el: MenuStructureTable, name: string) {
    const seen: { detail: unknown; bubbles: boolean; composed: boolean }[] = [];
    el.addEventListener(name, (event) => {
      const { detail, bubbles, composed } = event as CustomEvent;
      seen.push({ detail, bubbles, composed });
    });
    return seen;
  }

  const sent = (detail: unknown) => ({ detail, bubbles: true, composed: true });

  it("puts a fixed Device Home Page row first, above the menu", async () => {
    const el = await mount({ home: home() });
    expect(shown(el)).toEqual(["home", "root", "m-burger", "m-drinks", "m-fav"]);
    expect(nameOf(el, "home")).toBe(t("home.row"));
    expect(row(el, "home")!.getAttribute("aria-level")).toBe("1");
    expect(row(el, "root")!.getAttribute("aria-level")).toBe("1");
    // The menu's top level is current; the Device Home Page row is not part of it.
    expect(row(el, "home")!.querySelector('[aria-current="true"]')).toBeNull();
    expect(row(el, "root")!.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(row(el, "home")!.querySelector('[part~="grip-space"]')).not.toBeNull();
    expect(row(el, "home")!.querySelector('[part~="folder-frame"]')).not.toBeNull();
    expect(row(el, "home")!.querySelector('[data-test="home-empty"]')).toBeNull();

    el.home = { ...home(), shortcuts: [] };
    await settle(el);
    expect(item(el, "home-empty").textContent!.trim()).toBe(t("home.empty"));

    el.home = null;
    await settle(el);
    expect(shown(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);
    expect((await mount()).home).toBeNull();
  });

  it("lists the shortcuts under it, in order, by name and kind, marking a missing one", async () => {
    const el = await mount({ home: home() });
    expect(row(el, "home")!.getAttribute("aria-expanded")).toBe("false");
    expect(row(el, "home")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
      t("menus.expand").replace("{name}", t("home.row")),
    );
    await openHome(el);
    expect(row(el, "home")!.getAttribute("aria-expanded")).toBe("true");
    expect(shown(el)).toEqual(["home", ...SHORTCUT_KEYS, "root", "m-burger", "m-drinks", "m-fav"]);
    expect(SHORTCUT_KEYS.map((key) => nameOf(el, key))).toEqual([
      "Burger",
      "Drinks",
      t("home.missing").replace("{name}", "Chips"),
    ]);
    expect(
      SHORTCUT_KEYS.map((key) => row(el, key)!.querySelector('[data-test="kind"]')!.textContent),
    ).toEqual([t("members.kind_product"), t("members.kind_section"), t("members.missing")]);
    for (const key of SHORTCUT_KEYS) {
      const shortcut = row(el, key)!;
      expect(shortcut.getAttribute("aria-level"), key).toBe("2");
      expect(shortcut.hasAttribute("aria-expanded"), key).toBe(false);
      expect(shortcut.querySelector(".row-activate, .tree-toggle"), key).toBeNull();
      expect(
        shortcut.querySelector('[part~="swatch-box"], [part~="swatch-button"]'),
        key,
      ).toBeNull();
    }
    row(el, "home/t-drinks")!.querySelector<HTMLElement>('[data-test="name"]')!.click();
    await settle(el);
    expect(shown(el)).toEqual(["home", ...SHORTCUT_KEYS, "root", "m-burger", "m-drinks", "m-fav"]);
  });

  it("names a missing shortcut by the name it was kept under, else by its target's name", async () => {
    const shortcuts = home().shortcuts;
    const el = await mount({
      home: {
        ...home(),
        shortcuts: [
          { ...shortcuts[0]!, reachable: false, missingName: null },
          { ...shortcuts[1]!, reachable: false, missingName: "Dinner Menu › Drinks" },
        ],
      },
    });
    await openHome(el);
    expect(["home/t-burger", "home/t-drinks"].map((key) => nameOf(el, key))).toEqual([
      t("home.missing").replace("{name}", "Burger"),
      t("home.missing").replace("{name}", "Dinner Menu › Drinks"),
    ]);
  });

  it("offers only the two adds on the Device Home Page row", async () => {
    const el = await mount({ home: home() });
    const adds = sentAs(el, "wt-shortcut-add");
    expect(menuItems(el, "home")).toEqual([
      "add-product-shortcut-home",
      "add-section-shortcut-home",
    ]);
    expect(item(el, "add-product-shortcut-home").textContent!.trim()).toBe(t("home.add_product"));
    expect(item(el, "add-section-shortcut-home").textContent!.trim()).toBe(t("home.add_section"));
    await openMenu(el, "home");
    item(el, "add-product-shortcut-home").click();
    await settle(el);
    expect(popupOpen(el, "home")).toBe(false);
    item(el, "add-section-shortcut-home").click();
    expect(adds).toEqual([sent({ kind: "product" }), sent({ kind: "section" })]);
    expect(row(el, "home")!.getAttribute("aria-expanded")).toBe("false");
    expect(row(el, "home")!.querySelector('[part~="drag-grip"]')).toBeNull();
    expect(
      row(el, "home")!.querySelector('[part~="swatch-box"], [part~="swatch-button"]'),
    ).toBeNull();
  });

  it("removes a shortcut from its ⋮, which holds Remove alone, a missing one included", async () => {
    const el = await mount({ home: home() });
    const removes = sentAs(el, "wt-shortcut-remove");
    await openHome(el);
    for (const key of SHORTCUT_KEYS) expect(menuItems(el, key)).toEqual([`remove-${key}`]);
    expect(item(el, "remove-home/t-chips").textContent!.trim()).toBe(t("home.remove"));
    item(el, "remove-home/t-chips").click();
    item(el, "remove-home/t-burger").click();
    expect(removes).toEqual([sent({ memberId: "t-chips" }), sent({ memberId: "t-burger" })]);
  });

  it("moves a shortcut by keyboard within the shortcuts only", async () => {
    const el = await mount({ home: home() });
    const moves = sentAs(el, "wt-shortcut-move");
    const memberMoves = listen(el, "wt-member-move");
    await openHome(el);
    await press(el, "home/t-burger", "ArrowDown");
    expect(moves).toEqual([sent({ memberId: "t-burger", to: 1 })]);
    expect(shown(el).slice(0, 4)).toEqual([
      "home",
      "home/t-drinks",
      "home/t-burger",
      "home/t-chips",
    ]);
    expect(announced(el)).toBe(reordered("Burger", 2, 3));
    expect(focusedInTable(el)).toBe("drag-home/t-burger");

    await press(el, "home/t-drinks", "ArrowUp");
    expect(moves).toHaveLength(1);

    // A new value from the host replaces the order the move showed.
    el.home = home();
    await settle(el);
    expect(shown(el).slice(0, 4)).toEqual(["home", ...SHORTCUT_KEYS]);

    // A shortcut dropped on another shortcut moves; across the two lists nothing is offered.
    const shortcut = grip(el, "home/t-burger");
    pointer(shortcut, "pointerdown");
    pointer(shortcut, "pointermove", nameAt(el, "home/t-drinks"));
    await settle(el);
    expect(marked(el, "drop-gap-after")).toEqual(["home/t-drinks"]);
    for (const key of ["m-drinks", "root", "home"]) {
      pointer(shortcut, "pointermove", nameAt(el, key));
      await settle(el);
      expect([...marked(el, "drop-gap-after"), ...marked(el, "drop-gap-before")], key).toEqual([]);
    }
    pointer(shortcut, "pointerup", nameAt(el, "m-drinks"));
    await settle(el);

    const member = grip(el, "m-burger");
    pointer(member, "pointerdown");
    pointer(member, "pointermove", nameAt(el, "home/t-drinks"));
    await settle(el);
    expect([...marked(el, "drop-gap-after"), ...marked(el, "drop-gap-before")]).toEqual([]);
    pointer(member, "pointerup", nameAt(el, "home/t-drinks"));
    await settle(el);

    pointer(shortcut, "pointerdown");
    pointer(shortcut, "pointermove", nameAt(el, "home/t-chips"));
    pointer(shortcut, "pointerup", nameAt(el, "home/t-chips"));
    await settle(el);
    expect(moves).toEqual([
      sent({ memberId: "t-burger", to: 1 }),
      sent({ memberId: "t-burger", to: 2 }),
    ]);
    expect(memberMoves).toEqual([]);
  });

  it("keeps a moved shortcut's place when only the menu's nodes are refreshed", async () => {
    const el = await mount({ home: home() });
    await openHome(el);
    await press(el, "home/t-burger", "ArrowDown");
    const moved = ["home", "home/t-drinks", "home/t-burger", "home/t-chips"];
    expect(shown(el).slice(0, 4)).toEqual(moved);

    el.nodes = lunchNodes();
    await settle(el);
    expect(shown(el).slice(0, 4)).toEqual(moved);
  });

  it("disables the grips and actions while busy", async () => {
    const el = await mount({ home: home(), busy: true });
    await openHome(el);
    const events: string[] = [];
    for (const name of ["wt-shortcut-add", "wt-shortcut-remove", "wt-shortcut-move"])
      el.addEventListener(name, () => events.push(name));
    for (const key of ["home", ...SHORTCUT_KEYS])
      for (const button of [
        ...inTable(el, `[data-test="actions-${CSS.escape(key)}"]`)!.querySelectorAll("wt-button"),
      ]) {
        expect((button as HTMLElement & { disabled: boolean }).disabled, key).toBe(true);
        (button as HTMLElement).click();
      }
    for (const key of SHORTCUT_KEYS) expect(grip(el, key).disabled, key).toBe(true);
    keyOn(el, "home/t-burger", "ArrowDown");
    await settle(el);
    expect(events).toEqual([]);
    expect(shown(el).slice(0, 4)).toEqual(["home", ...SHORTCUT_KEYS]);
  });
});

describe("A303 tree media slots", () => {
  it.each([1280, 440, 390])(
    "uses equal section and product boxes, hiding both at %i px only when narrow",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const el = await mount({ reordering: false });
        el.style.width = `${width}px`;
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        await vi.waitFor(() => expect(table.hasAttribute("narrow")).toBe(width <= 440));
        const chip = row(el, "m-drinks")!.querySelector<HTMLElement>('[part~="color-swatch"]')!;
        const photo = row(el, "m-burger")!.querySelector<HTMLElement>('[part~="thumb-frame"]')!;
        const slot = chip.closest<HTMLElement>('[part~="folder-frame"]')!;
        if (width <= 440) {
          expect(slot.getBoundingClientRect().width).toBe(0);
          expect(photo.getBoundingClientRect().width).toBe(0);
          for (const swatch of table.shadowRoot!.querySelectorAll(
            '[part~="swatch-button"], [part~="swatch-box"]',
          )) {
            expect(swatch.getBoundingClientRect().width).toBe(0);
          }
        } else {
          const a = chip.getBoundingClientRect(),
            b = photo.getBoundingClientRect();
          expect(a.width).toBeGreaterThan(0);
          expect(a.width).toBe(b.width);
          expect(a.height).toBe(b.height);
        }
      } finally {
        await page.viewport(before.width, before.height);
      }
    },
  );
});

it.each([390, 1280])(
  "aligns Structure grips in the first column at every depth at %s px",
  async (width) => {
    await page.viewport(width, 844);
    const el = await mountDeep();
    const grips = all<HTMLElement>(el, '[part~="drag-grip"]');
    expect(grips.length).toBeGreaterThan(3);
    for (const grip of grips) {
      expect(grip.getBoundingClientRect().left).toBeCloseTo(
        grips[0]!.getBoundingClientRect().left,
        0,
      );
      expect(grip.closest("td")).toBe(grip.closest("tr")!.querySelector("td"));
    }
  },
);

describe("Structure product media", () => {
  it("uses a leading inherited photo ring and links to the product editor's photo field", async () => {
    const el = await mount({
      products: [{ ...products[2]!, categoryId: "c1" }],
      categories: [{ id: "c1", parentId: null, name: "Food", color: "#256bb1" }],
    });
    const media = row(el, "m-burger")!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="color-m-burger"]',
    );
    expect(media).not.toBeNull();
    expect(media!.tagName).toBe("WT-ROW-ACTIONS");
    await media!.updateComplete;
    const frame = media!.querySelector<HTMLElement>('[data-test="thumb"]')!;
    expect(getComputedStyle(frame).borderTopColor).toBe("rgb(37, 107, 177)");
    expect(parseFloat(getComputedStyle(frame).borderTopWidth)).toBeGreaterThan(1);
    expect(media!.querySelector("a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/p-burger?field=image",
    );
    await userEvent.click(media!.shadowRoot!.querySelector("button")!);
    await userEvent.keyboard("{Escape}");
    expect(media!.shadowRoot!.activeElement).toBe(media!.shadowRoot!.querySelector("button"));
  });
});

import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { chooseOption, expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { CategorySummary, MenuHome, MenuStructureNode, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

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
    names: { en: "Wines to share", es: "Vinos para compartir" },
    image: null,
    color: null,
    includedMenuId: "wine",
    ownerMenuId: "wine",
    folder: { showAsFolder: true, overrides: { names: { en: "The wine cellar" } } },
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
  return row(el, key)!.querySelector('[data-test="name"]')!.textContent!.trim();
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

/** The notes under a row's name, as their text. */
function notesOf(el: MenuStructureTable, key: string): string[] {
  return [...row(el, key)!.querySelectorAll('[part~="note"]')].map((note) =>
    note.textContent!.trim(),
  );
}

function listen(el: MenuStructureTable, name: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(name, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

const menuLabel = (name: string) => t("menus.menu_prefix").replace("{name}", name);

it("draws the menu's members as the top-level rows, in menu order, with no row for the menu itself", async () => {
  const el = await mount();
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  for (const key of ["m-burger", "m-drinks", "m-fav"])
    expect(row(el, key)!.getAttribute("aria-level")).toBe("1");
  expect(["m-burger", "m-drinks", "m-fav"].map((key) => nameOf(el, key))).toEqual([
    "Burger",
    "Drinks",
    "Favourites",
  ]);
  expect(inTable(el, '[data-test="root-name"]')).toBeNull();
  expect(table(el).shadowRoot!.textContent!).not.toContain(menuLabel("Lunch Menu"));
  // A top-level section has its arrow; a product has none.
  for (const key of ["m-drinks", "m-fav"])
    expect(row(el, key)!.getAttribute("aria-expanded"), key).toBe("false");
  expect(row(el, "m-burger")!.hasAttribute("aria-expanded")).toBe(false);
  // Every top-level row's swatch sits in one column.
  const lefts = ["m-burger", "m-drinks", "m-fav"].map(
    (key) =>
      row(el, key)!
        .querySelector(
          '[part~="folder-frame"], [part~="thumb-frame"], [part~="thumb-placeholder"]',
        )!
        .getBoundingClientRect().left,
  );
  for (const left of lefts) expect(left).toBeCloseTo(lefts[0]!, 0);

  el.nodes = [favourites(), productNode("m-burger", "p-burger"), drinksNode("m-drinks")];
  await settle(el);
  expect(shown(el)).toEqual(["m-fav", "m-burger", "m-drinks"]);
});

it("starts with sections closed and opens and closes one by a click on its row, by staff names", async () => {
  const el = await mount();
  expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
  await toggle(el, "m-drinks");
  expect(shown(el)).toEqual([
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
  expect(row(el, "m-drinks/m-lager")!.getAttribute("aria-level")).toBe("2");
  const text = table(el).shadowRoot!.textContent!;
  for (const wrong of ["Bebidas", "Something to drink", "for guests", "COCINA"])
    expect(text).not.toContain(wrong);
  expect(row(el, "m-drinks")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    t("menus.collapse").replace("{name}", "Drinks"),
  );
  await toggle(el, "m-drinks");
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(row(el, "m-drinks")!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    t("menus.expand").replace("{name}", "Drinks"),
  );
});

it("opens and closes each place a section is shown on its own", async () => {
  const el = await mount();
  await toggle(el, "m-fav");
  await toggle(el, "m-fav/m-fav-drinks");
  expect(shown(el)).toEqual([
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

/** What the widget draws itself, outside its table: the toolbar's Add ⋮ and the empty box's adds. */
function own<T extends Element = HTMLElement>(el: MenuStructureTable, test: string): T | null {
  return el.shadowRoot!.querySelector<T>(`[data-test="${CSS.escape(test)}"]`);
}

it("offers the top-level adds in the toolbar's Add ⋮ and on each place an owned section is shown, naming that list", async () => {
  const el = await mount();
  const adds = listen(el, "wt-structure-add");
  const toolbar = own<HTMLElementTagNameMap["wt-row-actions"]>(el, "toolbar-adds")!;
  expect(toolbar.localName).toBe("wt-row-actions");
  expect(toolbar.getAttribute("slot")).toBe("toolbar-end");
  expect(toolbar.icon).toBe("plus");
  expect(toolbar.getAttribute("label")).toBe(t("menus.add_to_menu"));
  expect(
    [...toolbar.children]
      .filter((child) => child.hasAttribute("data-test"))
      .map((child) => child.getAttribute("data-test")),
  ).toEqual(["new-section-top", "include-menu-top", "open-add-products-top"]);
  expect(
    ["new-section-top", "include-menu-top", "open-add-products-top"].map((test) =>
      own(el, test)!.textContent!.trim(),
    ),
  ).toEqual([t("menus.new_section"), t("menus.include_menu"), t("sections.add_products")]);
  // The table draws the toolbar's end slot, so the Add ⋮ is on screen.
  expect(toolbar.assignedSlot).not.toBeNull();
  expect(toolbar.getBoundingClientRect().width).toBeGreaterThan(0);
  own(el, "new-section-top")!.click();
  own(el, "include-menu-top")!.click();
  own(el, "open-add-products-top")!.click();
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
  expect(inTable(el, '[data-test="actions-root"]')).toBeNull();
});

it("keeps a button the host puts in the toolbar's end after the Add ⋮", async () => {
  const el = await mount();
  const done = document.createElement("button");
  done.slot = "toolbar-end";
  done.textContent = "Done";
  el.append(done);
  await settle(el);
  const toolbar = own(el, "toolbar-adds")!;
  expect(done.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(done.getBoundingClientRect().left).toBeGreaterThan(toolbar.getBoundingClientRect().right);
  // In the order a keyboard reaches them, too.
  expect(
    toolbar.compareDocumentPosition(done.assignedSlot!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
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

  expect(menuItems(el, "m-burger")).toEqual(["edit-product-m-burger", "remove-m-burger"]);
  expect(item(el, "remove-m-burger").textContent!.trim()).toBe(
    t("members.remove_from").replace("{list}", "Lunch Menu"),
  );
  await toggle(el, "m-drinks");
  expect(menuItems(el, "m-drinks/m-lemonade")).toEqual([
    "edit-product-m-drinks/m-lemonade",
    "remove-m-drinks/m-lemonade",
  ]);
  expect(item(el, "remove-m-drinks/m-lemonade").textContent!.trim()).toBe(
    t("members.remove_from").replace("{list}", "Drinks"),
  );
  item(el, "remove-m-drinks/m-lemonade").click();
  expect(removes).toEqual([{ path: ["m-drinks"], memberId: "m-lemonade" }]);
});

it("draws an included menu read-only, its menu offering Open, Edit and Remove", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()] });
  const removes = listen(el, "wt-member-remove");
  const edits = listen(el, "wt-structure-edit");
  expect(nameOf(el, "included-wine")).toBe(menuLabel("Wines"));
  expect(item(el, "read-only-included-wine")).toBeNull();
  expect(notesOf(el, "included-wine")).toEqual([t("menus.include_as_folder")]);
  expect(menuItems(el, "included-wine")).toEqual([
    "source-included-wine",
    "edit-included-wine",
    "remove-included-wine",
  ]);
  const link = item(el, "source-included-wine");
  expect(link.tagName).toBe("A");
  expect(link.getAttribute("href")).toBe("/manage/menus/menu/wine/view/structure");
  expect(link.textContent!.trim()).toBe(t("menus.open_included").replace("{name}", "Wines"));
  expect(item(el, "edit-included-wine").textContent!.trim()).toBe(t("action.edit"));
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

it("draws an included menu's Open link as the same entry as its Edit and Remove", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()] });
  const menu = inTable<HTMLElementTagNameMap["wt-row-actions"]>(
    el,
    '[data-test="actions-included-wine"]',
  )!;
  menu.show();
  const link = item(el, "source-included-wine");
  const look = (entry: Element) => {
    const style = getComputedStyle(entry);
    return {
      border: [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
      background: style.backgroundColor,
      color: style.color,
      decoration: style.textDecorationLine,
      start: style.justifyContent,
      width: entry.getBoundingClientRect().width,
    };
  };
  for (const test of ["edit-included-wine", "remove-included-wine"]) {
    const button = item(el, test).shadowRoot!.querySelector("button")!;
    expect(look(link), test).toEqual(look(button));
  }
});

it("Edit sends wt-include-edit with the list's path and the member", async () => {
  const nested = lunchNodes().map((node) =>
    node.memberId === "m-drinks" ? { ...node, children: [...node.children!, wines()] } : node,
  );
  const el = await mount({ nodes: [...nested, wines()] });
  const includeEdits = listen(el, "wt-include-edit");
  const otherEdits = [
    listen(el, "wt-member-edit"),
    listen(el, "wt-structure-edit"),
    listen(el, "wt-member-remove"),
  ];
  item(el, "edit-included-wine").click();
  await toggle(el, "m-drinks");
  otherEdits.forEach((seen) => (seen.length = 0));
  item(el, "edit-m-drinks/included-wine").click();
  expect(includeEdits).toEqual([
    { path: [], memberId: "included-wine" },
    { path: ["m-drinks"], memberId: "included-wine" },
  ]);
  expect(otherEdits).toEqual([[], [], []]);

  el.busy = true;
  await settle(el);
  item(el, "edit-included-wine").click();
  expect(includeEdits).toHaveLength(2);
});

it("the row says whether the include is a folder or shown directly", async () => {
  const el = await mount({ nodes: [...lunchNodes(), wines()] });
  expect(item(el, "folder-setting-included-wine").textContent!.trim()).toBe(
    t("menus.include_as_folder"),
  );
  expect(nameOf(el, "included-wine")).toBe(menuLabel("Wines"));

  const cava: MenuStructureNode = {
    memberId: "wine-cava",
    ref: { kind: "section", sectionId: "cava-root" },
    internalName: "Cava",
    includedMenuId: "cava",
    ownerMenuId: "cava",
    folder: { showAsFolder: false, overrides: {} },
    children: [],
  };
  el.nodes = [
    ...lunchNodes(),
    {
      ...wines(),
      folder: { showAsFolder: false, overrides: { names: { en: "The wine cellar" } } },
      children: [...wines().children!, cava],
    },
  ];
  await settle(el);
  expect(item(el, "folder-setting-included-wine").textContent!.trim()).toBe(
    t("menus.include_direct"),
  );
  expect(nameOf(el, "included-wine")).toBe(menuLabel("Wines"));
  expect(item(el, "read-only-included-wine")).toBeNull();
  expect(notesOf(el, "included-wine")).toEqual([t("menus.include_direct")]);
  // An include inside an included menu belongs to that menu's page, so it says nothing here.
  await toggle(el, "included-wine");
  expect(nameOf(el, "included-wine/wine-cava")).toBe(menuLabel("Cava"));
  expect(row(el, "included-wine/wine-cava")!.querySelector('[part~="note"]')).toBeNull();
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
  // The menu's own top level has no row, so nothing is marked.
  expect(all(el, '[aria-current="true"]')).toEqual([]);
  expect(all(el, '[part~="current"]')).toEqual([]);
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
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
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
  for (const name of [
    "wt-structure-add",
    "wt-member-remove",
    "wt-member-edit",
    "wt-member-delete",
    "wt-include-edit",
  ])
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

it("shows an empty menu as the table's empty box, saying so, with the three adds under it", async () => {
  const el = await mount({ nodes: [] });
  const adds = listen(el, "wt-structure-add");
  expect(shown(el)).toEqual([]);
  expect(inTable(el, ".empty .message")!.textContent!.trim()).toBe(t("menus.structure_empty"));
  expect(table(el).shadowRoot!.textContent!).not.toContain(menuLabel("Lunch Menu"));
  // The table draws no toolbar while empty, so the adds are in the box instead.
  expect(own(el, "toolbar-adds")).toBeNull();
  const tests = ["new-section-empty", "include-menu-empty", "open-add-products-empty"];
  const buttons = tests.map((test) => own(el, test)!);
  for (const button of buttons) {
    expect(button.localName).toBe("wt-button");
    expect(button.closest('[slot="empty-action"]')!.assignedSlot).not.toBeNull();
    expect(button.getBoundingClientRect().width).toBeGreaterThan(0);
  }
  expect(buttons.map((button) => button.textContent!.trim())).toEqual([
    t("menus.new_section"),
    t("menus.include_menu"),
    t("sections.add_products"),
  ]);
  for (const button of buttons) button.click();
  expect(adds).toEqual([
    { action: "new-section", path: [] },
    { action: "include-menu", path: [] },
    { action: "add-products", path: [] },
  ]);

  el.busy = true;
  await settle(el);
  for (const button of buttons) {
    expect((button as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    button.click();
  }
  expect(adds).toHaveLength(3);

  el.busy = false;
  el.nodes = lunchNodes();
  await settle(el);
  for (const test of tests) expect(own(el, test), test).toBeNull();
  expect(own(el, "toolbar-adds")).not.toBeNull();
});

it("disables the toolbar's adds while busy, and a click on one sends nothing", async () => {
  const el = await mount({ busy: true });
  const adds = listen(el, "wt-structure-add");
  for (const test of ["new-section-top", "include-menu-top", "open-add-products-top"]) {
    const button = own<HTMLElement & { disabled: boolean }>(el, test)!;
    expect(button.disabled, test).toBe(true);
    button.click();
  }
  expect(adds).toEqual([]);
});

it("focuses a row's menu, or its nearest drawn ancestor's, or the toolbar's Add ⋮ for the top level or when none is drawn", async () => {
  const el = await mount({ current: ["m-drinks", "m-beer"] });
  const focused = () => (table(el).shadowRoot!.activeElement as HTMLElement | null)?.dataset.test;
  const focusedOwn = () => (el.shadowRoot!.activeElement as HTMLElement | null)?.dataset.test;
  el.focusRowMenu("m-drinks/m-beer");
  expect(focused()).toBe("actions-m-drinks/m-beer");

  el.nodes = [productNode("m-burger", "p-burger"), { ...drinksNode("m-drinks"), children: [] }];
  await settle(el);
  el.focusRowMenu("m-drinks/m-beer");
  expect(focused()).toBe("actions-m-drinks");
  expect(focusedOwn()).toBe(undefined);

  el.focusRowMenu("m-gone/m-also-gone");
  expect(focusedOwn()).toBe("toolbar-adds");
  el.focusRowMenu("m-drinks");
  expect(focused()).toBe("actions-m-drinks");
  el.focusRowMenu("");
  expect(focusedOwn()).toBe("toolbar-adds");
  // Before it is drawn there is no menu to focus, and asking is harmless.
  document.createElement("dashboard-menu-structure-table").focusRowMenu("");
});

it("focuses the empty box's first add when the menu is empty", async () => {
  const el = await mount();
  el.nodes = [];
  await settle(el);
  for (const key of ["", "m-drinks/m-beer"]) {
    (document.activeElement as HTMLElement | null)?.blur();
    el.focusRowMenu(key);
    expect((el.shadowRoot!.activeElement as HTMLElement | null)?.dataset.test, key).toBe(
      "new-section-empty",
    );
  }
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
    // Eight rows fit in the phone's height, so each menu can be found where it is drawn.
    expect(shown(el)).toHaveLength(8);
    expectRowMenusOnScreen(table(el), 8, 'wt-row-actions[data-test^="actions-"]');
    // The toolbar's Add ⋮ too.
    const adds = own(el, "toolbar-adds")!.shadowRoot!.querySelector("button")!;
    const at = adds.getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.right).toBeLessThanOrEqual(window.innerWidth);
  } finally {
    await page.viewport(width, height);
  }
});

it("names a section it has no name for as no longer available", async () => {
  const el = await mount({
    nodes: [{ memberId: "m-lost", ref: { kind: "section", sectionId: "s-lost" } }],
  });
  expect(nameOf(el, "m-lost")).toBe(t("members.missing"));
  expect(shown(el)).toEqual(["m-lost"]);
});

it("names only the members, with no name drawn for the menu itself", async () => {
  const el = await mount();
  expect(all(el, '[data-test="root-name"]')).toEqual([]);
  expect(all(el, '[data-test="name"]').map((name) => name.textContent!.trim())).toEqual([
    "Burger",
    "Drinks",
    "Favourites",
  ]);
});

/** Every kind of row the tree draws, three levels deep: a product with a photo and ones without,
 * owned sections, an included menu, and a section and products inside it. */
const DEEP_ROWS = [
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
  text.selectNodeContents(tr.querySelector('[data-test="name"]')!);
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
  "starts every name one even step further in per level, sections, included menus and products alike ($width px, reordering: $reordering)",
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

it("puts a real grip on every top-level row, the included menu's too, and starts each name after the arrow and media slots", async () => {
  const el = await mountDeep();
  const offsets = ["m-burger", "m-drinks", "m-fav", "included-wine"].map((key) => {
    const tr = row(el, key)!;
    expect(tr.querySelector('[part~="drag-grip"]'), key).not.toBeNull();
    expect(tr.querySelector('[part~="grip-space"]'), key).toBeNull();
    return pieces(el, key).name.left - tr.querySelector(".tree-cell")!.getBoundingClientRect().left;
  });
  const tokens = getComputedStyle(el);
  const tap = parseFloat(tokens.getPropertyValue("--wt-tap-min"));
  const gap = parseFloat(tokens.getPropertyValue("--wt-space-3"));
  expect(tap).toBeGreaterThan(0);
  // The control column precedes the name cell; the arrow and media slot stay inside it.
  for (const offset of offsets) expect(offset).toBeCloseTo(2 * tap + gap, 0);
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
  "puts the Name heading over the first top-level name, also at phone width, where the tree's arrow slot narrows (%ipx)",
  async (width) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 844);
      const el = await mountDeep();
      for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
      expect(table(el).hasAttribute("narrow")).toBe(width === 390);
      const heading = inTable(el, 'thead [part~="tree-heading"]')!;
      expect(heading.textContent!.trim()).toBe(t("members.name"));
      expect(heading.getBoundingClientRect().left).toBeCloseTo(pieces(el, "m-burger").name.left, 0);
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

async function press(
  el: MenuStructureTable,
  key: string,
  which: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
) {
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
  expect(shown(el)).toEqual(["m-drinks", "m-burger", "m-fav"]);
  expect(focusedInTable(el)).toBe("drag-m-burger");
  expect(announced(el)).toBe(reordered("Burger", 2, 3));

  // The second press works from the order on screen, not the order the host last sent.
  await userEvent.keyboard("{ArrowDown}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 2 });
  expect(shown(el)).toEqual(["m-drinks", "m-fav", "m-burger"]);
  expect(focusedInTable(el)).toBe("drag-m-burger");

  await userEvent.keyboard("{ArrowUp}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 1 });
  expect(announced(el)).toBe(reordered("Burger", 2, 3));
  await userEvent.keyboard("{ArrowUp}");
  await settle(el);
  expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 0 });
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(announced(el)).toBe(reordered("Burger", 1, 3));
  expect(moves).toHaveLength(4);
});

it("sends nothing for ArrowUp on the first member or ArrowDown on the last", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  await press(el, "m-burger", "ArrowUp");
  await press(el, "m-fav", "ArrowDown");
  expect(moves).toEqual([]);
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
});

it("moves a member within its own section, leaving the top level alone", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  await toggle(el, "m-drinks");
  await press(el, "m-drinks/m-lager", "ArrowDown");
  expect(moves).toEqual([{ path: ["m-drinks"], memberId: "m-lager", to: 1 }]);
  expect(shown(el)).toEqual([
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
  expect(shown(el)).toEqual(["m-drinks", "m-burger", "m-fav"]);
  el.nodes = lunchNodes();
  await settle(el);
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
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
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
});

describe("moving into or out of a section by key", () => {
  const movedInto = (item: string, section: string) =>
    t("action.moved_into").replace("{item}", item).replace("{section}", section);
  const movedOut = (item: string, list: string) =>
    t("action.moved_out").replace("{item}", item).replace("{list}", list);

  /** Lunch after Lemonade left Drinks for the top level, after Drinks. */
  function lemonadeOutNodes(): MenuStructureNode[] {
    const drinks = drinksNode("m-drinks");
    drinks.children = drinks.children!.filter((child) => child.memberId !== "m-lemonade");
    return [
      productNode("m-burger", "p-burger"),
      drinks,
      productNode("m-lemonade", "p-lemonade"),
      favourites(),
    ];
  }

  it("lists all four arrows as the grip's shortcuts", async () => {
    const el = await mount();
    expect(grip(el, "m-burger").getAttribute("aria-keyshortcuts")).toBe(
      "ArrowUp ArrowDown ArrowLeft ArrowRight",
    );
  });

  it("keeps ArrowLeft and ArrowRight on a grip from scrolling the page, even when they move nothing", async () => {
    const el = await mount();
    expect(keyOn(el, "m-burger", "ArrowLeft").defaultPrevented).toBe(true);
    expect(keyOn(el, "m-burger", "ArrowRight").defaultPrevented).toBe(true);
  });

  it("ArrowRight moves a member into the section drawn directly above it, at its end, and announces it", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    await press(el, "m-drinks/m-lemonade", "ArrowRight");
    expect(intos).toEqual([
      { from: ["m-drinks"], memberId: "m-lemonade", to: ["m-drinks", "m-beer"] },
    ]);
    expect(moves).toEqual([]);
    expect(announced(el)).toBe(movedInto("Lemonade", "Beer"));
    // The host answers with the menu read again; nothing moves before that.
    expect(shown(el)).toEqual([
      "m-burger",
      "m-drinks",
      "m-drinks/m-lager",
      "m-drinks/m-beer",
      "m-drinks/m-lemonade",
      "m-fav",
    ]);
  });

  it.each([
    ["the first member, with nothing above it", lunchNodes, "m-burger"],
    ["a product above", lunchNodes, "m-drinks"],
    ["a section above that sits inside the moved section elsewhere", lunchNodes, "m-fav"],
    [
      "an included menu above",
      () => [...lunchNodes(), wines(), productNode("m-rioja", "p-rioja")],
      "m-rioja",
    ],
    [
      "a section above already holding the product",
      () => [drinksNode("m-drinks"), productNode("m-lager-top", "p-lager")],
      "m-lager-top",
    ],
    [
      "a product no longer in the catalogue",
      () => [drinksNode("m-drinks"), productNode("m-gone", "p-gone")],
      "m-gone",
    ],
  ])("ArrowRight sends and announces nothing with %s", async (_, nodes, key) => {
    const el = await mount({ nodes: nodes() });
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    await press(el, key, "ArrowRight");
    expect(intos).toEqual([]);
    expect(moves).toEqual([]);
    expect(announced(el)).toBe("");
  });

  it("ArrowLeft moves a member out of its section to the place after that section, and announces it", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    await press(el, "m-drinks/m-lemonade", "ArrowLeft");
    expect(intos).toEqual([{ from: ["m-drinks"], memberId: "m-lemonade", to: [], position: 2 }]);
    expect(moves).toEqual([]);
    expect(announced(el)).toBe(movedOut("Lemonade", "Lunch Menu"));
  });

  it("ArrowLeft out of a nested section names that section's list and counts the order on screen", async () => {
    const el = await mount();
    await toggle(el, "m-fav");
    await toggle(el, "m-fav/m-fav-drinks");
    const intos = listen(el, "wt-member-move-into");
    await press(el, "m-fav/m-fav-drinks/m-beer", "ArrowLeft");
    expect(intos).toEqual([
      { from: ["m-fav", "m-fav-drinks"], memberId: "m-beer", to: ["m-fav"], position: 2 },
    ]);
    expect(announced(el)).toBe(movedOut("Beer", "Favourites"));

    // Drinks moves above Burger on screen before the host answers; the place counts that order.
    await toggle(el, "m-drinks");
    await press(el, "m-drinks", "ArrowUp");
    await press(el, "m-drinks/m-lemonade", "ArrowLeft");
    expect(intos.at(-1)).toEqual({
      from: ["m-drinks"],
      memberId: "m-lemonade",
      to: [],
      position: 1,
    });
  });

  it.each([
    ["at the top level", lunchNodes, [], "m-burger"],
    [
      "into a list already holding the product",
      lunchNodes,
      ["m-drinks", "m-drinks/m-beer"],
      "m-drinks/m-beer/m-lager-2",
    ],
    [
      "for a product no longer in the catalogue",
      () => {
        const drinks = drinksNode("m-drinks");
        drinks.children!.push(productNode("m-gone", "p-gone"));
        return [drinks];
      },
      ["m-drinks"],
      "m-drinks/m-gone",
    ],
  ])("ArrowLeft sends and announces nothing %s", async (_, nodes, open, key) => {
    const el = await mount({ nodes: nodes() });
    for (const section of open) await toggle(el, section);
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    await press(el, key, "ArrowLeft");
    expect(intos).toEqual([]);
    expect(moves).toEqual([]);
    expect(announced(el)).toBe("");
  });

  it("focuses the moved row's grip once the host is no longer busy after the menu is read again", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    await press(el, "m-drinks/m-lemonade", "ArrowLeft");
    el.busy = true;
    await settle(el);
    el.nodes = lemonadeOutNodes();
    await settle(el);
    expect(shown(el)).toContain("m-lemonade");
    expect(focusedInTable(el)).not.toBe("drag-m-lemonade");
    el.busy = false;
    await settle(el);
    expect(focusedInTable(el)).toBe("drag-m-lemonade");
  });

  it("waits for the menu read again, not only for the host to stop being busy", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    await press(el, "m-drinks/m-lemonade", "ArrowLeft");
    el.busy = true;
    await settle(el);
    el.busy = false;
    await settle(el);
    grip(el, "m-burger").focus();
    el.busy = true;
    await settle(el);
    el.nodes = lemonadeOutNodes();
    el.busy = false;
    await settle(el);
    expect(focusedInTable(el)).toBe("drag-m-lemonade");
  });

  it("focuses the moved row's grip inside the section the host opens for it", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    await press(el, "m-drinks/m-lemonade", "ArrowRight");
    el.busy = true;
    await settle(el);
    const drinks = drinksNode("m-drinks");
    const lemonade = drinks.children!.pop()!;
    drinks.children![1]!.children!.push(lemonade);
    el.nodes = [productNode("m-burger", "p-burger"), drinks, favourites()];
    el.current = ["m-drinks", "m-beer"];
    el.busy = false;
    await settle(el);
    expect(focusedInTable(el)).toBe("drag-m-drinks/m-beer/m-lemonade");
  });

  it("focuses the grip where the member was when the menu read again does not move it", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    await press(el, "m-drinks/m-lemonade", "ArrowLeft");
    // Focus can leave the grip while the host waits; it comes back all the same.
    grip(el, "m-burger").focus();
    el.busy = true;
    await settle(el);
    el.nodes = lunchNodes();
    el.busy = false;
    await settle(el);
    expect(focusedInTable(el)).toBe("drag-m-drinks/m-lemonade");
  });

  it("leaves a same-list move's focus alone when a later read of the menu arrives", async () => {
    const el = await mount();
    await press(el, "m-burger", "ArrowDown");
    grip(el, "m-fav").focus();
    el.nodes = [drinksNode("m-drinks"), productNode("m-burger", "p-burger"), favourites()];
    await settle(el);
    expect(focusedInTable(el)).toBe("drag-m-fav");
  });
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
  return row(el, key)!.querySelector<HTMLElement>('[data-test="name"]')!;
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

type Band = "top" | "middle" | "bottom";

/** A pointer height inside the row: its top quarter, its middle, or its bottom quarter. */
function at(el: MenuStructureTable, key: string, band: Band): PointerEventInit {
  const box = row(el, key)!.getBoundingClientRect();
  const y = {
    top: box.top + box.height / 8,
    middle: box.top + box.height / 2,
    bottom: box.bottom - box.height / 8,
  }[band];
  return { clientY: y };
}

async function dragOver(
  el: MenuStructureTable,
  from: Element,
  key: string,
  band: Band,
): Promise<void> {
  pointer(from, "pointermove", nameAt(el, key), at(el, key, band));
  await settle(el);
}

/** Every drop mark drawn: the gaps and the row a drop would go into. */
function drops(el: MenuStructureTable) {
  return {
    before: marked(el, "drop-gap-before"),
    after: marked(el, "drop-gap-after"),
    into: marked(el, "drop-target"),
  };
}

const noDrop = { before: [], after: [], into: [] };

describe("with reordering off", () => {
  it.each([1280, 390])(
    "draws no grip or grip space on any row, and puts the Name heading over the first top-level name (%ipx)",
    async (width) => {
      const before = { width: window.innerWidth, height: window.innerHeight };
      try {
        await page.viewport(width, 844);
        const el = await mountDeep({ reordering: false });
        for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
        expect(all(el, "tbody tr[data-row-key]").length).toBe(DEEP_ROWS.length);
        expect(all(el, '[part~="drag-grip"], [part~="grip-space"]')).toEqual([]);
        expect(table(el).hasAttribute("narrow")).toBe(width === 390);
        const heading = inTable(el, 'thead [part~="tree-heading"]')!;
        expect(heading.getBoundingClientRect().left).toBeCloseTo(
          pieces(el, "m-burger").name.left,
          0,
        );
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
    pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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

it("offers a gap beside a row outside the dragged member's own list by the pointer's half, and a release there sends one move into that list", async () => {
  const el = await mount();
  await toggle(el, "m-drinks");
  await toggle(el, "m-fav");
  const moves = listen(el, "wt-member-move");
  const intos = listen(el, "wt-member-move-into");
  const from = grip(el, "m-drinks/m-lager");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-drinks/m-lemonade"));
  await settle(el);
  expect(drops(el)).toEqual({ ...noDrop, after: ["m-drinks/m-lemonade"] });
  const visits: [string, Band, Partial<ReturnType<typeof drops>>][] = [
    ["m-fav/m-fav-lemonade", "top", { before: ["m-fav/m-fav-lemonade"] }],
    ["m-fav/m-fav-lemonade", "bottom", { after: ["m-fav/m-fav-lemonade"] }],
    ["m-burger", "top", { before: ["m-burger"] }],
    ["m-burger", "bottom", { after: ["m-burger"] }],
    ["m-drinks", "top", { before: ["m-drinks"] }],
    ["m-drinks", "bottom", { after: ["m-drinks/m-lemonade"] }],
    ["m-fav", "top", { before: ["m-fav"] }],
    ["m-fav", "bottom", { after: ["m-fav/m-fav-drinks"] }],
  ];
  for (const [key, band, expected] of visits) {
    await dragOver(el, from, key, band);
    expect(drops(el), `${key} ${band}`).toEqual({ ...noDrop, ...expected });
  }
  pointer(from, "pointerup", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(intos).toEqual([{ from: ["m-drinks"], memberId: "m-lager", to: [], position: 3 }]);
  expect(shown(el)).toEqual([
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

describe("dragging into another list", () => {
  it("offers a gap before or after a row inside another open section, and sends its place there", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-burger");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-lemonade", "top");
    expect(drops(el)).toEqual({ ...noDrop, before: ["m-drinks/m-lemonade"] });
    await dragOver(el, from, "m-drinks/m-lemonade", "bottom");
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-drinks/m-lemonade"] });
    // The gap drawn under the row makes it taller; the same pointer still means after it.
    pointer(from, "pointermove", nameAt(el, "m-drinks/m-lemonade"), {
      clientY: at(el, "m-drinks/m-lemonade", "top").clientY! + 30,
    });
    await settle(el);
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-drinks/m-lemonade"] });
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-lemonade"));
    await settle(el);
    expect(moves).toEqual([]);
    expect(intos).toEqual([{ from: [], memberId: "m-burger", to: ["m-drinks"], position: 3 }]);
    expect(shown(el)[0]).toBe("m-burger");
    expect(drops(el)).toEqual(noDrop);

    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-lemonade", "top");
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-lemonade"));
    expect(intos.at(-1)).toEqual({ from: [], memberId: "m-burger", to: ["m-drinks"], position: 2 });
    expect(moves).toEqual([]);
  });

  it("puts the gap after an open section's last drawn row, and counts the place in the order on screen", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    await toggle(el, "m-drinks/m-beer");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-burger");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-beer", "bottom");
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-drinks/m-beer/m-lager-2"] });
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-beer"));
    expect(intos).toEqual([{ from: [], memberId: "m-burger", to: ["m-drinks"], position: 2 }]);

    // Lager moves below Beer on screen before the host answers; the place counts that order.
    await press(el, "m-drinks/m-lager", "ArrowDown");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-lager", "top");
    expect(drops(el)).toEqual({ ...noDrop, before: ["m-drinks/m-lager"] });
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-lager"));
    expect(intos.at(-1)).toEqual({ from: [], memberId: "m-burger", to: ["m-drinks"], position: 1 });
  });

  it("moves a product out of a section beside a top-level row, sending the top level as an empty path", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-drinks/m-lemonade");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-burger", "top");
    expect(drops(el)).toEqual({ ...noDrop, before: ["m-burger"] });
    pointer(from, "pointerup", nameAt(el, "m-burger"));
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-burger", "bottom");
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-burger"] });
    pointer(from, "pointerup", nameAt(el, "m-burger"));
    expect(intos).toEqual([
      { from: ["m-drinks"], memberId: "m-lemonade", to: [], position: 0 },
      { from: ["m-drinks"], memberId: "m-lemonade", to: [], position: 1 },
    ]);
    expect(moves).toEqual([]);
  });

  it("marks a closed section in another list over its middle and drops into it at the end, and offers the gap beside it over its quarters", async () => {
    const el = await mount();
    await toggle(el, "m-drinks");
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-burger");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-beer", "middle");
    expect(drops(el)).toEqual({ ...noDrop, into: ["m-drinks/m-beer"] });
    const cells = row(el, "m-drinks/m-beer")!.querySelectorAll("td");
    expect(cells[0]!.part.contains("drop-target")).toBe(true);
    expect([...cells].slice(1).some((cell) => cell.part.contains("drop-target"))).toBe(false);
    expect(getComputedStyle(cells[0]!).borderInlineStartStyle).toBe("solid");
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-beer"));
    await settle(el);
    expect(intos).toStrictEqual([{ from: [], memberId: "m-burger", to: ["m-drinks", "m-beer"] }]);
    expect(drops(el)).toEqual(noDrop);

    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks/m-beer", "top");
    expect(drops(el)).toEqual({ ...noDrop, before: ["m-drinks/m-beer"] });
    await dragOver(el, from, "m-drinks/m-beer", "bottom");
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-drinks/m-beer"] });
    pointer(from, "pointerup", nameAt(el, "m-drinks/m-beer"));
    expect(intos.at(-1)).toEqual({ from: [], memberId: "m-burger", to: ["m-drinks"], position: 2 });
    expect(moves).toEqual([]);
  });

  it("drops into a closed sibling section over its middle, and reorders beside it over its quarters", async () => {
    const el = await mount();
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-burger");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-fav", "middle");
    expect(drops(el)).toEqual({ ...noDrop, into: ["m-fav"] });
    pointer(from, "pointerup", nameAt(el, "m-fav"));
    await settle(el);
    expect(intos).toStrictEqual([{ from: [], memberId: "m-burger", to: ["m-fav"] }]);
    expect(moves).toEqual([]);
    expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);

    for (const band of ["top", "bottom"] as const) {
      pointer(from, "pointerdown");
      await dragOver(el, from, "m-fav", band);
      expect(drops(el), band).toEqual({ ...noDrop, after: ["m-fav"] });
      pointer(from, "pointerup", nameAt(el, "m-fav"));
      await settle(el);
      el.nodes = lunchNodes();
      await settle(el);
    }
    expect(moves).toEqual([
      { path: [], memberId: "m-burger", to: 2 },
      { path: [], memberId: "m-burger", to: 2 },
    ]);
    expect(intos).toHaveLength(1);
  });

  it("drops into an empty section, which draws no arrow, over its middle", async () => {
    const empty: MenuStructureNode = {
      memberId: "m-empty",
      ref: { kind: "section", sectionId: "s-empty" },
      internalName: "Specials",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu-lunch",
      children: [],
    };
    const el = await mount({ nodes: [...lunchNodes(), empty] });
    await toggle(el, "m-drinks");
    expect(row(el, "m-empty")!.hasAttribute("aria-expanded")).toBe(false);
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-drinks/m-lager");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-empty", "middle");
    expect(drops(el)).toEqual({ ...noDrop, into: ["m-empty"] });
    pointer(from, "pointerup", nameAt(el, "m-empty"));
    expect(intos).toStrictEqual([{ from: ["m-drinks"], memberId: "m-lager", to: ["m-empty"] }]);
  });

  it("offers a gap beside an included menu's own row in another list", async () => {
    const el = await mount({ nodes: [...lunchNodes(), wines()] });
    await toggle(el, "m-drinks");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-drinks/m-lemonade");
    pointer(from, "pointerdown");
    await dragOver(el, from, "included-wine", "middle");
    expect(drops(el).into).toEqual([]);
    await dragOver(el, from, "included-wine", "top");
    expect(drops(el)).toEqual({ ...noDrop, before: ["included-wine"] });
    await dragOver(el, from, "included-wine", "bottom");
    expect(drops(el)).toEqual({ ...noDrop, after: ["included-wine"] });
    pointer(from, "pointerup", nameAt(el, "included-wine"));
    expect(intos).toEqual([{ from: ["m-drinks"], memberId: "m-lemonade", to: [], position: 4 }]);
  });

  describe("refuses, drawing nothing and sending nothing on release", () => {
    async function refused(
      el: MenuStructureTable,
      dragged: string,
      places: [string, Band][],
    ): Promise<void> {
      const moves = listen(el, "wt-member-move");
      const intos = listen(el, "wt-member-move-into");
      const from = grip(el, dragged);
      for (const [key, band] of places) {
        pointer(from, "pointerdown");
        await dragOver(el, from, key, band);
        expect(marked(el, "dragging"), `${key} ${band}`).toEqual([dragged]);
        expect(drops(el), `${key} ${band}`).toEqual(noDrop);
        pointer(from, "pointerup", nameAt(el, key), at(el, key, band));
        await settle(el);
        // The click a release sends is held back until the next task.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(moves).toEqual([]);
      expect(intos).toEqual([]);
    }

    it("a section over its own descendants", async () => {
      const el = await mount();
      await toggle(el, "m-drinks");
      await refused(el, "m-drinks", [
        ["m-drinks/m-lager", "top"],
        ["m-drinks/m-lager", "bottom"],
        ["m-drinks/m-beer", "middle"],
        ["m-drinks/m-beer", "bottom"],
      ]);
    });

    it("a section over a list inside it that is drawn somewhere else", async () => {
      const el = await mount();
      await toggle(el, "m-drinks");
      await refused(el, "m-fav", [
        ["m-drinks/m-lager", "top"],
        ["m-drinks/m-lager", "bottom"],
        ["m-drinks/m-beer", "middle"],
        ["m-drinks/m-beer", "top"],
      ]);
    });

    it("a row inside an included menu", async () => {
      const el = await mount({ nodes: [...lunchNodes(), wines()] });
      await toggle(el, "included-wine");
      await refused(el, "m-burger", [
        ["included-wine/wine-lager", "top"],
        ["included-wine/wine-lager", "bottom"],
        ["included-wine/wine-red", "middle"],
        ["included-wine/wine-red", "bottom"],
      ]);
    });

    it("a product over an open or closed list already holding that product", async () => {
      const el = await mount();
      await toggle(el, "m-drinks");
      await toggle(el, "m-fav");
      await refused(el, "m-drinks/m-lemonade", [
        ["m-fav/m-fav-lemonade", "top"],
        ["m-fav/m-fav-lemonade", "bottom"],
      ]);
      await toggle(el, "m-fav");
      await refused(el, "m-drinks/m-lemonade", [["m-fav", "middle"]]);
      // Beer, a closed sibling, already holds Lager.
      await refused(el, "m-drinks/m-lager", [["m-drinks/m-beer", "middle"]]);
    });

    it("a product over the top level already holding that product", async () => {
      const el = await mount({
        nodes: [...lunchNodes(), productNode("m-top-lemonade", "p-lemonade")],
      });
      await toggle(el, "m-drinks");
      await refused(el, "m-drinks/m-lemonade", [
        ["m-burger", "top"],
        ["m-burger", "bottom"],
      ]);
    });

    it("a section over a list already holding that section", async () => {
      const el = await mount();
      await refused(el, "m-drinks", [["m-fav", "middle"]]);
      await toggle(el, "m-fav");
      await refused(el, "m-drinks", [
        ["m-fav/m-fav-lemonade", "top"],
        ["m-fav/m-fav-lemonade", "bottom"],
      ]);
    });

    it("a row of the dragged member's own list drawn in another place", async () => {
      const el = await mount();
      await toggle(el, "m-drinks");
      await toggle(el, "m-fav");
      await toggle(el, "m-fav/m-fav-drinks");
      await refused(el, "m-drinks/m-lager", [
        ["m-fav/m-fav-drinks/m-lemonade", "top"],
        ["m-fav/m-fav-drinks/m-lemonade", "bottom"],
      ]);
    });

    it("a product no longer in the catalogue, over another list", async () => {
      const el = await mount({ nodes: [productNode("m-gone", "p-gone"), ...lunchNodes()] });
      await toggle(el, "m-drinks");
      await refused(el, "m-gone", [
        ["m-drinks/m-lager", "top"],
        ["m-drinks/m-lager", "bottom"],
        ["m-drinks/m-beer", "middle"],
      ]);
    });
  });

  it("reorders a section beside a closed sibling section that lies inside it elsewhere, never into it", async () => {
    const el = await mount();
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-fav");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-drinks", "middle");
    expect(drops(el)).toEqual({ ...noDrop, before: ["m-drinks"] });
    pointer(from, "pointerup", nameAt(el, "m-drinks"));
    expect(moves).toEqual([{ path: [], memberId: "m-fav", to: 1 }]);
    expect(intos).toEqual([]);
  });

  it("still reorders a product no longer in the catalogue among its siblings, never into one", async () => {
    const el = await mount({ nodes: [productNode("m-gone", "p-gone"), ...lunchNodes()] });
    const moves = listen(el, "wt-member-move");
    const intos = listen(el, "wt-member-move-into");
    const from = grip(el, "m-gone");
    pointer(from, "pointerdown");
    await dragOver(el, from, "m-fav", "middle");
    expect(drops(el)).toEqual({ ...noDrop, after: ["m-fav"] });
    pointer(from, "pointerup", nameAt(el, "m-fav"));
    expect(moves).toEqual([{ path: [], memberId: "m-gone", to: 3 }]);
    expect(intos).toEqual([]);
  });
});

it("cancels a drag on Escape, sending nothing, and the click that ends it toggles nothing", async () => {
  const el = await mount();
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-drinks"), at(el, "m-drinks", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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

it("tells a row inside the dragged section by whole member ids, not by a shared prefix", async () => {
  const el = await mount({
    nodes: [
      productNode("m-burger", "p-burger"),
      { ...favourites(), children: [productNode("m-fav-lemonade", "p-lemonade")] },
      drinksNode("m-fav-drinks"),
    ],
  });
  await toggle(el, "m-fav-drinks");
  const moves = listen(el, "wt-member-move");
  const intos = listen(el, "wt-member-move-into");
  const from = grip(el, "m-fav");
  pointer(from, "pointerdown");
  await dragOver(el, from, "m-fav-drinks/m-lager", "bottom");
  expect(drops(el)).toEqual({ ...noDrop, after: ["m-fav-drinks/m-lager"] });
  pointer(from, "pointerup", nameAt(el, "m-fav-drinks/m-lager"));
  expect(intos).toEqual([{ from: [], memberId: "m-fav", to: ["m-fav-drinks"], position: 1 }]);
  expect(moves).toEqual([]);
});

it("draws a grip on every top-level row, and no grip space on any", async () => {
  const el = await mount();
  for (const key of ["m-burger", "m-drinks", "m-fav"]) {
    expect(row(el, key)!.querySelector('[part~="drag-grip"]'), key).not.toBeNull();
    expect(row(el, key)!.querySelector('[part~="grip-space"]'), key).toBeNull();
  }
});

it("starts no drag while busy or from a button other than the main one", async () => {
  const el = await mount({ busy: true });
  const moves = listen(el, "wt-member-move");
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  pointer(from, "pointerup", nameAt(el, "m-fav"));

  el.busy = false;
  await settle(el);
  pointer(from, "pointerdown", from, { button: 2 });
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), { ...at(el, "m-fav", "bottom"), pointerId: 2 });
  await settle(el);
  expect(marked(el, "dragging")).toEqual([]);
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(from, "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
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
  pointer(grip(el, "m-burger"), "pointermove", nameAt(el, "m-fav"), at(el, "m-fav", "bottom"));
  await settle(el);
  expect(marked(el, "drop-gap-after")).toEqual(["m-fav"]);
  el.nodes = [productNode("m-burger", "p-burger"), drinksNode("m-drinks")];
  await settle(el);
  pointer(grip(el, "m-burger"), "pointerup", nameAt(el, "m-drinks"));
  await settle(el);
  expect(moves).toEqual([]);
  expect(document.body.style.cursor).not.toBe("grabbing");
  expect(shown(el)).toEqual(["m-burger", "m-drinks"]);
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

  it("paints the venue default on a product with nothing coloured above it, never on a missing product", async () => {
    const el = await mountColoured({ defaultColor: "#777777" });
    await toggle(el, "m-drinks");
    // Burger has a photo, so its colour paints the ring around it.
    expect(chipOf(el, "m-burger").part.contains("empty")).toBe(false);
    expect(getComputedStyle(chipOf(el, "m-burger")).borderTopColor).toBe("rgb(119, 119, 119)");
    expect(getComputedStyle(chipOf(el, "m-drinks/m-lemonade")).backgroundColor).toBe(
      "rgb(37, 107, 177)",
    );

    el.products = coloured.filter((item) => item.id !== "p-burger");
    await settle(el);
    expect(chipOf(el, "m-burger").part.contains("empty")).toBe(true);
    expect(chipOf(el, "m-burger").hasAttribute("style")).toBe(false);
  });

  it("the swatch shows the folder's fixed colour while it is a folder", async () => {
    const ownColour = { ...wines(), color: "#7a1f3d" };
    const fixed = (showAsFolder: boolean): MenuStructureNode => ({
      ...ownColour,
      folder: { showAsFolder, overrides: { color: "#c0a000" } },
    });
    const el = await mountColoured({ nodes: [...paintedLunch(), fixed(true)] });
    expect(getComputedStyle(chipOf(el, "included-wine")).backgroundColor).toBe("rgb(192, 160, 0)");

    el.nodes = [...paintedLunch(), fixed(false)];
    await settle(el);
    expect(getComputedStyle(chipOf(el, "included-wine")).backgroundColor).toBe("rgb(122, 31, 61)");

    el.nodes = [...paintedLunch(), ownColour];
    await settle(el);
    expect(getComputedStyle(chipOf(el, "included-wine")).backgroundColor).toBe("rgb(122, 31, 61)");
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

  /** Records whether the widget's own handlers cancelled each click on `link`, then cancels it so
   * the test page never navigates. Registered after render, so it runs after the widget's handler. */
  function clicksOn(link: HTMLElement): boolean[] {
    const prevented: boolean[] = [];
    link.addEventListener("click", (event) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    });
    return prevented;
  }

  it("makes a product's swatch a link to its Edit at the photo, toggling no row and starting no drag", async () => {
    const el = await mountColoured();
    await toggle(el, "m-drinks");
    const sent = sentEvents(el);
    const swatch = swatchOf(el, "m-drinks/m-lemonade");
    expect(swatch.tagName).toBe("A");
    expect(swatch.getAttribute("href")).toBe("/manage/catalogue/product/p-lemonade?field=image");
    expect(swatch.getAttribute("aria-label")).toBe(
      t("product.edit_named").replace("{name}", "Lemonade"),
    );
    expect(swatch.querySelector("wt-row-actions, button")).toBeNull();
    const reachedRow: Event[] = [];
    row(el, "m-drinks/m-lemonade")!.addEventListener("click", (event) => reachedRow.push(event));
    const prevented = clicksOn(swatch);
    await userEvent.click(swatch);
    await settle(el);
    expect(prevented).toEqual([false]);
    expect(reachedRow).toEqual([]);
    expect(sent).toEqual([]);
    expect(row(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");

    pointer(swatch, "pointerdown");
    pointer(swatch, "pointermove", nameAt(el, "m-fav"));
    pointer(swatch, "pointerup", nameAt(el, "m-fav"));
    await settle(el);
    expect(ghost(el)).toBeNull();
    expect(sent).toEqual([]);
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
      expect(swatch.tagName, key).not.toBe("A");
      expect(swatch.querySelector("button, a"), key).toBeNull();
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
    expect(swatch.tagName).not.toBe("A");
    expect(swatch.querySelector("button, a")).toBeNull();
    expect(chipOf(el, "m-gone").part.contains("color-swatch")).toBe(true);
    expect(chipOf(el, "m-gone").part.contains("empty")).toBe(true);
    swatch.click();
    expect(sent).toEqual([]);
  });

  it("disables the swatches while busy, and a click on one sends nothing", async () => {
    const el = await mountColoured({ busy: true });
    const sent = sentEvents(el);
    const section = swatchOf(el, "m-drinks") as HTMLButtonElement;
    expect(section.disabled).toBe(true);
    section.click();
    const product = swatchOf(el, "m-burger");
    expect(product.tagName).toBe("A");
    expect(product.getAttribute("aria-disabled")).toBe("true");
    const prevented = clicksOn(product);
    product.click();
    expect(prevented).toEqual([true]);
    expect(sent).toEqual([]);
  });

  it("dims a busy product swatch the way it dims a busy section swatch", async () => {
    const el = await mountColoured({ busy: true });
    const section = getComputedStyle(swatchOf(el, "m-drinks"));
    const product = getComputedStyle(swatchOf(el, "m-burger"));
    expect(Number(section.opacity)).toBeLessThan(1);
    expect(product.opacity).toBe(section.opacity);
    expect(product.cursor).toBe("default");
    el.busy = false;
    await settle(el);
    expect(getComputedStyle(swatchOf(el, "m-burger")).opacity).toBe("1");
    expect(getComputedStyle(swatchOf(el, "m-burger")).cursor).toBe("pointer");
  });
});

describe("without the Device Home Page", () => {
  /** What the table used to draw as its first row: a host still handing it over is ignored. */
  const handedHome: MenuHome = {
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
    ],
    handheld: { columns: 3, tiles: "colours", order: "home_first" },
    till: { columns: 6, tiles: "colours", order: "home_first" },
  };

  it("draws the menu's members as the top-level rows, even when a home is handed to it", async () => {
    const el = await mount();
    Object.assign(el, { home: handedHome });
    await settle(el);
    expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
    for (const key of ["m-burger", "m-drinks", "m-fav"])
      expect(row(el, key)!.getAttribute("aria-level"), key).toBe("1");
    expect(all(el, '[data-test="root-name"]')).toEqual([]);
  });

  it("offers no shortcut add on any row", async () => {
    const el = await mount();
    Object.assign(el, { home: handedHome });
    await settle(el);
    await toggle(el, "m-drinks");
    await toggle(el, "m-fav");
    const adds = all(el, '[data-test*="shortcut"]').map((node) => node.dataset.test);
    expect(adds).toEqual([]);
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
          const media = table.shadowRoot!.querySelectorAll('[part~="product-media"]');
          expect(media.length).toBeGreaterThan(0);
          for (const button of media) expect(button.getBoundingClientRect().width).toBe(0);
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
    const media = row(el, "m-burger")!.querySelector<HTMLAnchorElement>(
      '[data-test="color-m-burger"]',
    );
    expect(media).not.toBeNull();
    expect(media!.tagName).toBe("A");
    const frame = media!.querySelector<HTMLElement>('[data-test="thumb"]')!;
    expect(getComputedStyle(frame).borderTopColor).toBe("rgb(37, 107, 177)");
    expect(parseFloat(getComputedStyle(frame).borderTopWidth)).toBeGreaterThan(1);
    expect(media!.getAttribute("href")).toBe("/manage/catalogue/product/p-burger?field=image");
    media!.focus();
    expect(table(el).shadowRoot!.activeElement).toBe(media);
  });
});

describe("a product row's Available and Edit product", () => {
  /** Burger is available and Lemonade is sold out, so a row reading the wrong product fails. */
  const flagged: Product[] = [
    product("p-lager", "Lager"),
    { ...product("p-lemonade", "Lemonade"), available: false },
    product("p-burger", "Burger", "burger.webp"),
    product("p-rioja", "Rioja"),
  ];
  /** The text of a row's cell under the Available heading. */
  function availableOf(el: MenuStructureTable, key: string): string {
    const heads = all(el, "thead th").map((th) => th.textContent!.trim());
    const index = heads.indexOf(t("editor.available"));
    expect(index, heads.join("|")).toBeGreaterThanOrEqual(0);
    const cells = [...row(el, key)!.children];
    expect(cells.length, key).toBe(heads.length);
    return cells[index]!.textContent!.trim();
  }

  it("shows Available on product rows only, each by its own product's flag", async () => {
    const el = await mount({ products: flagged });
    await toggle(el, "m-drinks");
    const columns = (table(el) as unknown as { columns: { key: string }[] }).columns;
    expect(columns.map((column) => column.key)).toEqual(["name", "kind", "available", "actions"]);
    expect(availableOf(el, "m-burger")).toBe(t("menus.available_yes"));
    expect(availableOf(el, "m-drinks/m-lemonade")).toBe(t("menus.available_no"));
    expect(availableOf(el, "m-drinks/m-lager")).toBe(t("menus.available_yes"));
    for (const key of ["m-drinks", "m-drinks/m-beer"]) expect(availableOf(el, key), key).toBe("");
  });

  it("draws Available in the muted colour of the Type word beside it", async () => {
    const el = await mount();
    el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    const burger = row(el, "m-burger")!;
    const kind = burger.querySelector('[data-test="kind"]')!;
    const available = burger.querySelector('[data-test="available"]')!;
    expect(getComputedStyle(kind).color).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(available).color).toBe(getComputedStyle(kind).color);
  });

  it("shows Available on an included menu's product rows, which keep having no menu", async () => {
    const el = await mount({ nodes: [...lunchNodes(), wines()] });
    await toggle(el, "included-wine");
    expect(availableOf(el, "included-wine/wine-lager")).toBe(t("menus.available_yes"));
    expect(inTable(el, '[data-test="actions-included-wine/wine-lager"]')).toBeNull();
    const parts = (key: string) =>
      row(el, key)!.querySelector('[data-test="available"]')!.getAttribute("part")!.split(" ");
    expect(parts("included-wine/wine-lager")).toEqual(["available", "read-only"]);
    expect(parts("m-burger")).toEqual(["available"]);
  });

  it("shows no Available for a product the list does not hold", async () => {
    const el = await mount({ nodes: [productNode("m-ghost", "p-ghost")] });
    expect(availableOf(el, "m-ghost")).toBe("");
  });

  it("offers Edit product first in a product row's ⋮, and opens that product by click", async () => {
    const el = await mount();
    expect(menuItems(el, "m-burger")).toEqual(["edit-product-m-burger", "remove-m-burger"]);
    const link = item(el, "edit-product-m-burger");
    expect(link.tagName).toBe("A");
    expect(link.textContent!.trim()).toBe(t("product.edit"));
    expect(link.getAttribute("href")).toBe("/manage/catalogue/product/p-burger");
    await toggle(el, "m-drinks");
    expect(menuItems(el, "m-drinks/m-lemonade")).toEqual([
      "edit-product-m-drinks/m-lemonade",
      "remove-m-drinks/m-lemonade",
    ]);
    expect(item(el, "edit-product-m-drinks/m-lemonade").getAttribute("href")).toBe(
      "/manage/catalogue/product/p-lemonade",
    );

    const heard = vi.fn();
    el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
    const plain = new MouseEvent("click", {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
    // Stop the browser following it inside the test page.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        button: 0,
        metaKey: true,
      }),
    );
    expect(heard).toHaveBeenCalledOnce();
  });

  it("opens a product row's Edit product by keyboard", async () => {
    const el = await mount();
    const heard = vi.fn();
    el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
    const menu = inTable(el, '[data-test="actions-m-burger"]')!;
    menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(popupOpen(el, "m-burger")).toBe(true));
    await userEvent.keyboard("{Tab}");
    expect(item(el, "edit-product-m-burger").matches(":focus")).toBe(true);
    await userEvent.keyboard("{Enter}");
    expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
  });

  it("offers no Edit product for a product the list does not hold, and keeps it while busy", async () => {
    const el = await mount({
      nodes: [productNode("m-ghost", "p-ghost"), productNode("m-burger", "p-burger")],
      busy: true,
    });
    expect(menuItems(el, "m-ghost")).toEqual(["remove-m-ghost"]);
    const heard = vi.fn();
    el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
    const plain = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    item(el, "edit-product-m-burger").dispatchEvent(plain);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ productId: "p-burger" });
  });
});

async function edgeMenu(up = false, fits = false) {
  const el = await mount({
    nodes: Array.from({ length: fits ? 1 : 35 }, (_, i) => productNode(`edge-${i}`, "p-burger")),
    reordering: true,
  });
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:100px;left:40px;width:800px;height:300px;overflow:auto";
  el.parentElement!.append(box);
  box.append(el);
  const key = up ? "edge-30" : "edge-0";
  const from = grip(el, key);
  if (up) box.scrollTop = from.getBoundingClientRect().top - box.getBoundingClientRect().top - 100;
  const bounds = box.getBoundingClientRect();
  const x = nameAt(el, key).getBoundingClientRect().left + 12;
  const y = up ? bounds.top + 8 : bounds.bottom - 8;
  const send = (type: string, at = y) => pointer(from, type, from, { clientX: x, clientY: at });
  const pending = new Set<number>();
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const requested = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = request((time) => {
      pending.delete(id);
      callback(time);
    });
    pending.add(id);
    return id;
  });
  const cancelled = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pending.delete(id);
    cancel(id);
  });
  const restoreFrames = () => {
    requested.mockRestore();
    cancelled.mockRestore();
  };
  const initial = box.scrollTop;
  send("pointerdown", from.getBoundingClientRect().top + 8);
  send("pointermove");
  return {
    el,
    box,
    bounds,
    send,
    initial,
    pending,
    restoreFrames,
    moves: listen(el, "wt-member-move"),
  };
}

it.each([false, true])(
  "edge scroll moves a stationary menu drag to a newly revealed sibling (up: %s)",
  async (up) => {
    const { el, box, send, initial, moves, pending, restoreFrames } = await edgeMenu(up);
    try {
      for (let frame = 0; frame < 40; frame++) await new Promise(requestAnimationFrame);
      expect(up ? initial - box.scrollTop : box.scrollTop).toBeGreaterThan(350);

      await expect
        .poll(
          () =>
            Number(
              all<HTMLElement>(el, '[part~="drop-gap-after"], [part~="drop-gap-before"]')[0]
                ?.closest("tr")
                ?.dataset.rowKey?.slice(5),
            ),
          { timeout: 4000 },
        )
        [up ? "toBeLessThan" : "toBeGreaterThan"](up ? 27 : 4);
      const target = all<HTMLElement>(
        el,
        '[part~="drop-gap-after"], [part~="drop-gap-before"]',
      )[0].closest("tr")!.dataset.rowKey!;
      expect(pending.size).toBe(1);
      send("pointerup");
      expect(pending.size).toBe(0);
      expect(moves).toEqual([
        { path: [], memberId: up ? "edge-30" : "edge-0", to: Number(target.slice(5)) },
      ]);
      await settle(el);
      await new Promise(requestAnimationFrame);
      const ended = box.scrollTop;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      expect(box.scrollTop).toBe(ended);
    } finally {
      send("pointercancel");
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
      await new Promise(requestAnimationFrame);
      restoreFrames();
    }
  },
  15000,
);

it.each(["leave", "cancel", "Escape", "disconnect", "fits"])(
  "edge scroll menu drag stops on %s",
  async (end) => {
    const { el, box, bounds, send, moves, pending, restoreFrames } = await edgeMenu(
      false,
      end === "fits",
    );
    try {
      if (end === "fits") {
        expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
        expect(pending.size).toBe(0);
      } else {
        await expect.poll(() => box.scrollTop, { timeout: 4000 }).toBeGreaterThan(100);
        expect(pending.size).toBe(1);
      }
      if (end === "leave") send("pointermove", bounds.top + bounds.height / 2);
      else if (end === "cancel") send("pointercancel");
      else if (end === "Escape")
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (end === "disconnect") el.remove();
      expect(pending.size).toBe(0);
      await settle(el);
      for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
      const ended = box.scrollTop;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      expect(box.scrollTop).toBe(ended);
      expect(moves).toEqual([]);
    } finally {
      send("pointercancel");
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
      await new Promise(requestAnimationFrame);
      restoreFrames();
    }
  },
);

it("marks the held menu source even when the first move stays over that source", async () => {
  const el = await mount({ reordering: true });
  const from = grip(el, "m-burger");
  pointer(from, "pointerdown");
  const box = from.getBoundingClientRect();
  pointer(from, "pointermove", from, { clientX: box.left + 20 });
  try {
    expect(row(el, "m-burger")!.part.contains("dragging")).toBe(true);
  } finally {
    pointer(from, "pointercancel");
  }
});

it.each([300, 301.5])(
  "releases on the final menu sibling after edge scrolling stops (%s px)",
  async (height) => {
    const { el, box, send, moves, pending, restoreFrames } = await edgeMenu();
    try {
      box.style.height = `${height}px`;
      box.scrollTop = box.scrollHeight - box.clientHeight - 150;
      send("pointermove");
      await expect.poll(() => pending.size, { timeout: 4000 }).toBe(0);
      expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight);
      expect(marked(el, "drop-gap-after")).toEqual(["edge-34"]);
      send("pointerup");
      expect(moves).toEqual([{ path: [], memberId: "edge-0", to: 34 }]);
      expect(pending.size).toBe(0);
    } finally {
      send("pointercancel");
      restoreFrames();
    }
  },
);

it("releases on the menu sibling under the pointer after leaving the edge", async () => {
  const { el, box, bounds, send, moves, pending, restoreFrames } = await edgeMenu();
  try {
    await expect.poll(() => box.scrollTop, { timeout: 4000 }).toBeGreaterThan(100);
    const target = nameAt(el, "edge-12");
    box.scrollTop += target.getBoundingClientRect().top - bounds.top - 120;
    const targetBox = target.getBoundingClientRect();
    send("pointermove", targetBox.top + targetBox.height / 2);
    expect(pending.size).toBe(0);
    expect(marked(el, "drop-gap-after")).toEqual(["edge-12"]);
    send("pointerup");
    expect(moves).toEqual([{ path: [], memberId: "edge-0", to: 12 }]);
    expect(pending.size).toBe(0);
  } finally {
    send("pointercancel");
    restoreFrames();
  }
});

describe("search and the Available filter", () => {
  async function search(el: MenuStructureTable, term: string): Promise<void> {
    el.search = term;
    await settle(el);
  }

  async function chooseAvailable(el: MenuStructureTable, value: string): Promise<void> {
    const select = inTable(el, 'wt-combobox[data-filter="available"]')!;
    await chooseOption(select, value);
    await settle(el);
  }

  it("finds a product inside a closed section by its staff name, opening the way to it", async () => {
    const el = await mount();
    expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
    await search(el, "lemonade");
    expect(shown(el)).toEqual([
      "m-drinks",
      "m-drinks/m-lemonade",
      "m-fav",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);
    for (const key of ["m-drinks", "m-fav", "m-fav/m-fav-drinks"])
      expect(row(el, key)!.getAttribute("aria-expanded"), key).toBe("true");
    // The staff name, never the customer-facing or kitchen one.
    await search(el, "for guests");
    expect(shown(el)).toEqual([]);
    await search(el, "COCINA");
    expect(shown(el)).toEqual([]);
    await search(el, "");
    expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  });

  it("finds a section and an included menu by the name the row shows", async () => {
    const el = await mount({ nodes: [...lunchNodes(), wines()] });
    await search(el, "beer");
    expect(shown(el)).toEqual([
      "m-drinks",
      "m-drinks/m-beer",
      "m-fav",
      "m-fav/m-fav-drinks",
      "m-fav/m-fav-drinks/m-beer",
    ]);
    await search(el, menuLabel("Wines"));
    expect(shown(el)).toEqual(["included-wine"]);
  });

  it("says nothing matches when the search finds no row", async () => {
    const el = await mount();
    await search(el, "zzz");
    expect(shown(el)).toEqual([]);
    expect(
      table(el).shadowRoot!.querySelector('p.message[role="status"]')!.textContent!.trim(),
    ).toBe(tableNoMatches());
  });

  it("filters Available to Yes or No; sections and included menus stay only on the way to a match", async () => {
    const lemonade = { ...product("p-lemonade", "Lemonade"), available: false };
    const el = await mount({
      nodes: [...lunchNodes(), wines()],
      products: products.map((each) => (each.id === "p-lemonade" ? lemonade : each)),
    });
    const filter = table(el).columns.find((column) => column.key === "available")!.filter!;
    expect(filter.label).toBe(t("editor.available"));
    expect(filter.allLabel).toBe(t("menus.filter_available_all"));
    expect(filter.options).toEqual([
      { value: "yes", label: t("menus.available_yes") },
      { value: "no", label: t("menus.available_no") },
    ]);

    await chooseAvailable(el, "no");
    expect(shown(el)).toEqual([
      "m-drinks",
      "m-drinks/m-lemonade",
      "m-fav",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);

    await chooseAvailable(el, "yes");
    expect(shown(el)).not.toContain("m-drinks/m-lemonade");
    expect(shown(el)).toContain("m-burger");
    expect(shown(el)).toContain("included-wine/wine-lager");
    expect(shown(el)).toContain("included-wine/wine-red/wine-rioja");
  });

  it("answers no option for a section, an included menu or a product it has no record of", async () => {
    const el = await mount({
      nodes: [...lunchNodes(), wines(), productNode("m-gone", "p-gone")],
    });
    await chooseAvailable(el, "yes");
    expect(shown(el)).not.toContain("m-gone");
    await chooseAvailable(el, "no");
    expect(shown(el)).toEqual([]);
  });

  it("passes the table the filter labels the Products tree passes", async () => {
    const el = await mount();
    const tree = table(el);
    expect(tree.filtersLabel).toBe(t("table.filters"));
    expect(tree.filteredColumnLabel).toBe(t("table.filtered_column"));
    expect(tree.filtersClearAllLabel).toBe(t("table.filters_clear_all"));
    expect(tree.filtersCloseLabel).toBe(t("table.filters_close"));
    expect(tree.filterSearchPlaceholder).toBe(t("categories.combobox_search"));
    expect(tree.filterNoResultsLabel).toBe(t("categories.combobox_no_results"));
  });

  it("forwards a slotted search box into the table's toolbar", async () => {
    const el = await mount();
    const box = document.createElement("input");
    box.slot = "toolbar-search";
    el.append(box);
    await settle(el);
    expect(box.assignedSlot?.name).toBe("toolbar-search");
    expect(box.assignedSlot!.assignedSlot?.name).toBe("toolbar-search");
    expect(box.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("moves a grip past only the siblings drawn, sending the full list's index", async () => {
    const el = await mount();
    const moves = listen(el, "wt-member-move");
    // Burger and Favourites match; Drinks, between them, is hidden.
    await search(el, "u");
    expect(shown(el)).toEqual(["m-burger", "m-fav"]);
    await press(el, "m-fav", "ArrowUp");
    expect(moves).toEqual([{ path: [], memberId: "m-fav", to: 0 }]);
    expect(shown(el)).toEqual(["m-fav", "m-burger"]);
    expect(announced(el)).toBe(reordered("Favourites", 1, 2));
    expect(focusedInTable(el)).toBe("drag-m-fav");
    // The full order is now Favourites, Burger, Drinks; Burger is the last one drawn.
    await press(el, "m-burger", "ArrowDown");
    expect(moves).toHaveLength(1);
    await press(el, "m-burger", "ArrowUp");
    expect(moves.at(-1)).toEqual({ path: [], memberId: "m-burger", to: 0 });
    await search(el, "");
    expect(shown(el)).toEqual(["m-burger", "m-fav", "m-drinks"]);
  });

  it("sends the full list's index when a hidden sibling sits before the shown ones", async () => {
    const el = await mount();
    const moves = listen(el, "wt-member-move");
    // Drinks and Favourites match; Burger, first in the list, is hidden.
    await search(el, "i");
    expect(shown(el).filter((key) => !key.includes("/"))).toEqual(["m-drinks", "m-fav"]);
    await press(el, "m-fav", "ArrowUp");
    expect(moves).toEqual([{ path: [], memberId: "m-fav", to: 1 }]);
  });
});

describe("Select mode while a search or filter hides rows", () => {
  const boxKeys = (el: MenuStructureTable) =>
    all<HTMLInputElement>(el, 'input[type="checkbox"][data-test^="select-"]')
      .map((box) => box.dataset.test!)
      .filter((test) => test !== "select-all")
      .map((test) => test.slice("select-".length));

  async function selectAll(el: MenuStructureTable): Promise<unknown[]> {
    const changes = listen(el, "wt-selection-change");
    item(el, "select-all").click();
    await settle(el);
    return changes;
  }

  it("gives a section kept only on the way to a match no box, so select all ticks only the matches", async () => {
    const el = await mount({ selecting: true, search: "Lemonade" });
    expect(boxKeys(el)).toEqual([
      "m-drinks/m-lemonade",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);
    expect(await selectAll(el)).toEqual([
      {
        selected: ["m-drinks/m-lemonade", "m-fav/m-fav-lemonade", "m-fav/m-fav-drinks/m-lemonade"],
      },
    ]);
  });

  it("names the rows the search and filter leave a box on, closed sections' rows included", async () => {
    const lemonade = { ...product("p-lemonade", "Lemonade"), available: false };
    const el = await mount({
      selecting: true,
      nodes: [...lunchNodes(), wines()],
      products: products.map((each) => (each.id === "p-lemonade" ? lemonade : each)),
    });
    expect(shown(el)).not.toContain("m-drinks/m-lager");
    expect([...el.shownSelectableKeys()]).toEqual([
      "m-burger",
      "m-drinks",
      "m-drinks/m-lager",
      "m-drinks/m-beer",
      "m-drinks/m-beer/m-lager-2",
      "m-drinks/m-lemonade",
      "m-fav",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks",
      "m-fav/m-fav-drinks/m-lager",
      "m-fav/m-fav-drinks/m-beer",
      "m-fav/m-fav-drinks/m-beer/m-lager-2",
      "m-fav/m-fav-drinks/m-lemonade",
      "included-wine",
    ]);
    el.search = "Lemonade";
    await settle(el);
    expect([...el.shownSelectableKeys()]).toEqual([
      "m-drinks/m-lemonade",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);
    el.search = "";
    await settle(el);
    await chooseOption(inTable(el, 'wt-combobox[data-filter="available"]')!, "yes");
    await settle(el);
    expect([...el.shownSelectableKeys()]).toEqual([
      "m-burger",
      "m-drinks/m-lager",
      "m-drinks/m-beer/m-lager-2",
      "m-fav/m-fav-drinks/m-lager",
      "m-fav/m-fav-drinks/m-beer/m-lager-2",
    ]);
  });

  it("keeps a box on a section whose own name matches", async () => {
    const el = await mount({ selecting: true, search: "drinks" });
    expect(boxKeys(el)).toContain("m-drinks");
    expect(boxKeys(el)).toContain("m-fav/m-fav-drinks");
    expect(boxKeys(el)).not.toContain("m-fav");
    el.search = "";
    await settle(el);
    expect(boxKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  });

  it("gives no section or included menu a box while the Available filter is on", async () => {
    const lemonade = { ...product("p-lemonade", "Lemonade"), available: false };
    const el = await mount({
      selecting: true,
      nodes: [...lunchNodes(), wines()],
      products: products.map((each) => (each.id === "p-lemonade" ? lemonade : each)),
    });
    await chooseOption(inTable(el, 'wt-combobox[data-filter="available"]')!, "no");
    await settle(el);
    expect(boxKeys(el)).toEqual([
      "m-drinks/m-lemonade",
      "m-fav/m-fav-lemonade",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);
    await chooseOption(inTable(el, 'wt-combobox[data-filter="available"]')!, "");
    await settle(el);
    expect(boxKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav", "included-wine"]);
  });
});

describe("Select mode", () => {
  const boxes = (el: MenuStructureTable) =>
    all<HTMLInputElement>(el, 'input[type="checkbox"][data-test^="select-"]').filter(
      (box) => box.dataset.test !== "select-all",
    );

  it("draws no row box until selecting, then one on every row the menu owns, labelled by its name", async () => {
    const el = await mount({ nodes: [...lunchNodes(), wines()] });
    await toggle(el, "m-drinks");
    await toggle(el, "included-wine");
    expect(boxes(el)).toEqual([]);

    el.selecting = true;
    await settle(el);
    expect(boxes(el).map((box) => box.dataset.test)).toEqual([
      "select-m-burger",
      "select-m-drinks",
      "select-m-drinks/m-lager",
      "select-m-drinks/m-beer",
      "select-m-drinks/m-lemonade",
      "select-m-fav",
      "select-included-wine",
    ]);
    const inList = (name: string, list: string) =>
      t("menus.selection_label").replace("{name}", name).replace("{list}", list);
    expect(item(el, "select-m-drinks/m-lager").getAttribute("aria-label")).toBe(
      inList("Lager", "Drinks"),
    );
    expect(item(el, "select-m-burger").getAttribute("aria-label")).toBe(
      inList("Burger", "Lunch Menu"),
    );
    expect(item(el, "select-included-wine").getAttribute("aria-label")).toBe(
      inList(menuLabel("Wines"), "Lunch Menu"),
    );
    // Rows inside an included menu are edited only from that menu's own page.
    expect(shown(el)).toContain("included-wine/wine-lager");
    expect(inTable(el, '[data-test="select-included-wine/wine-lager"]')).toBeNull();
    expect(inTable(el, '[data-test="select-included-wine/wine-red"]')).toBeNull();
  });

  it("ticks the rows it is given and reports a person's tick once, from itself", async () => {
    const el = await mount({ selecting: true, selected: ["m-burger"] });
    expect(
      boxes(el)
        .filter((box) => box.checked)
        .map((box) => box.dataset.test),
    ).toEqual(["select-m-burger"]);
    const changes: { target: EventTarget | null; detail: unknown }[] = [];
    el.addEventListener("wt-selection-change", (event) =>
      changes.push({ target: event.target, detail: (event as CustomEvent).detail }),
    );
    item(el, "select-m-fav").click();
    await settle(el);
    expect(changes).toEqual([{ target: el, detail: { selected: ["m-burger", "m-fav"] } }]);
  });

  it("names the select-all box in the screen's language", async () => {
    const before = currentLocale();
    setLocale("es");
    onTestFinished(() => setLocale(before));
    const el = await mount({ selecting: true });
    expect(item(el, "select-all").getAttribute("aria-label")).toBe(
      "Seleccionar todos los elementos",
    );
  });

  it("forwards a slotted selection bar into the table's toolbar-bottom slot", async () => {
    const el = await mount({ selecting: true });
    const bar = document.createElement("div");
    bar.slot = "toolbar-bottom";
    bar.textContent = "bar";
    el.append(bar);
    await settle(el);
    expect(bar.assignedSlot?.name).toBe("toolbar-bottom");
    expect(bar.assignedSlot!.assignedSlot?.name).toBe("toolbar-bottom");
    expect(bar.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});

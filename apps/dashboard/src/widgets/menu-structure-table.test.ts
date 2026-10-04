import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { expectRowMenusOnScreen } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { MenuStructureTable } from "./menu-structure-table.js";
import type { MenuStructureNode, Product } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

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
    expectRowMenusOnScreen(table(el), 9);
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

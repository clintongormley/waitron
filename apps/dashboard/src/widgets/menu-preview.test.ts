import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { page } from "vitest/browser";
import type { MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { MenuPreviewPanel, type PublishResult } from "./menu-preview.js";
import type { MenuDocumentTree } from "./menu-document-tree.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountMenuPreview as mountWidget,
  selectPreviewPane,
} from "./test-helpers.js";

// The wording is asserted as a person reads it, in English unless a case says otherwise.
let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  vi.restoreAllMocks();
  setLocale(previousLocale);
  cleanupWidgets();
});

const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
const LIVE_HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);

const changedStatus: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: PUBLISHED_AT,
  hash: LIVE_HASH,
};

/** Burger at the top, and Drinks holding Lemonade. */
const DOCUMENT = menuDocument(
  [
    documentProduct("mi-burger", "p-burger"),
    documentSection("s-drinks", "Drinks", [documentProduct("mi-lemonade", "p-lemonade")]),
  ],
  { "p-burger": "Burger", "p-lemonade": "Lemonade" },
);

function preview(changes: MenuChange[], warnings: MenuPreview["warnings"] = []): MenuPreview {
  return {
    setMenuProblems: [],
    live: null,
    clashes: [],
    hash: NEW_HASH,
    changes,
    warnings,
    status: changedStatus,
    document: DOCUMENT,
  };
}

async function mountIn(props: Partial<MenuPreviewPanel>) {
  return mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status: changedStatus,
    preview: preview([]),
    ...props,
  });
}

async function mount(props: Partial<MenuPreviewPanel>) {
  return (await mountIn(props)).el;
}

function q<T extends HTMLElement = HTMLElement>(el: MenuPreviewPanel, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function items(el: MenuPreviewPanel, list: string): string[] {
  const words = [...el.shadowRoot!.querySelectorAll(`[data-test="${list}"] li`)].map(text);
  return list === "changes" ? words.sort() : words;
}

it("names the changed size and describes setting or clearing a price at the same amount", async () => {
  const base = {
    kind: "price_changed" as const,
    productId: "p-burger",
    name: "Burger",
    source: "this_menu" as const,
    targets: { before: [], after: [] },
  };
  const variant = { id: "small", name: "Small" };
  const el = await mount({
    preview: preview([
      { ...base, id: "touch", from: "2.00", to: "2.20", variant },
      { ...base, id: "set", from: "2.00", to: "2.00", variant, override: "set" },
      { ...base, id: "clear", from: "2.00", to: "2.00", override: "cleared" },
    ]),
  });
  expect(text(q(el, '[data-change-row="touch"]'))).toBe("Burger › Small €2.00 → €2.20");
  expect(text(q(el, '[data-change-row="set"]'))).toBe("Burger › Small price set on this menu");
  expect(text(q(el, '[data-change-row="clear"]'))).toBe("Burger price no longer set on this menu");
});

it("keeps other menus off a change made only here", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "rename-here",
        kind: "menu_renamed",
        from: "Lunch",
        to: "Midday",
        source: "this_menu",
        alsoOn: ["Dinner"],
        targets: { before: [], after: [] },
      },
    ]),
  });
  expect(text(q(el, '[data-change-row="rename-here"]'))).toBe("Menu renamed from Lunch to Midday");
});

it.each(["extras", "unit"] as const)("keeps the source of a %s change neutral", async (field) => {
  const el = await mount({
    preview: preview([
      {
        id: "modifiers",
        kind: "product_changed",
        productId: "p-burger",
        name: "Burger",
        fields: [field],
        source: "shared_product",
        targets: { before: [], after: [] },
      },
    ]),
  });
  expect(text(q(el, '[data-change-row="modifiers"]'))).toBe(`Burger: ${field} shared product`);
});

it("keeps counted warning details folded until opened and keeps the product link", async () => {
  const el = await mount({
    preview: preview(
      [],
      [
        {
          kind: "allergens_unreviewed",
          products: [{ id: "p-burger", name: "Burger", parentName: null }],
        },
      ],
    ),
  });
  const warning = q(el, "wt-disclosure")!;
  expect(warning.getAttribute("heading")).toBe("1 product with allergens not yet reviewed");
  expect(warning.hasAttribute("open")).toBe(false);
  warning.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await expect.poll(() => warning.hasAttribute("open")).toBe(true);
  expect([...warning.querySelectorAll("li")].map(text)).toEqual(["Burger"]);
  expect(warning.querySelector('a[href="/products/product/p-burger"]')?.textContent?.trim()).toBe(
    "Burger",
  );
});

it("words every kind of change, each with where it came from", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-40",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-lemonade",
        name: "Lemonade",
        under: ["Drinks"],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-39",
        targets: { before: [], after: [] },
        kind: "price_changed",
        productId: "p-burger",
        name: "Burger",
        from: "12.00",
        to: "13.00",
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-38",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["color"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-37",
        targets: { before: [], after: [] },
        kind: "section_changed",
        sectionId: "s-drinks",
        name: "Drinks",
        fields: ["names"],
        source: "included_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-36",
        targets: { before: [], after: [] },
        kind: "product_removed",
        productId: "p-lager",
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "included_menu",
        alsoOn: ["Dinner Menu", "Terrace Menu"],
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-35",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-chips",
        name: "Chips",
        under: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-34",
        targets: { before: [], after: [] },
        kind: "product_moved",
        productId: "p-soup",
        name: "Soup",
        from: [["Starters"]],
        to: [[], ["Mains", "Hot"]],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-33",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-cola",
        name: "Cola",
        fields: [
          "names",
          "description",
          "image",
          "unit",
          "ordering",
          "variants",
          "extras",
          "options",
        ],
        source: "shared_product",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-32",
        targets: { before: [], after: [] },
        kind: "section_added",
        sectionId: "s-desserts",
        parentSectionIds: [],
        name: "Desserts",
        under: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-31",
        targets: { before: [], after: [] },
        kind: "product_removed",
        productId: "p-bread",
        name: "Bread",
        under: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-30",
        targets: { before: [], after: [] },
        kind: "section_removed",
        sectionId: "s-specials",
        parentSectionIds: [],
        name: "Specials",
        under: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-29",
        targets: { before: [], after: [] },
        kind: "section_removed",
        sectionId: "s-beer",
        parentSectionIds: ["s-drinks"],
        name: "Beer",
        under: ["Drinks"],
        source: "included_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-28",
        targets: { before: [], after: [] },
        kind: "section_changed",
        sectionId: "s-mains",
        name: "Mains",
        fields: ["names", "image", "color"],
        source: "included_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-27",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-26",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: "s-drinks",
        list: ["Drinks"],
        source: "included_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-25",
        targets: { before: [], after: [] },
        kind: "home_shortcuts_changed",
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-24",
        targets: { before: [], after: [] },
        kind: "home_display_changed",
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-23",
        targets: { before: [], after: [] },
        kind: "menu_renamed",
        from: "Midday Menu",
        to: "Lunch Menu",
        source: "this_menu",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual(
    [
      "Drinks › Lemonade",
      "Burger €12.00 → €13.00 changed in Products, also on Dinner Menu",
      "Lemonade: colour changed in Products, also on Dinner Menu",
      "Drinks renamed included menu",
      "Drinks › Beer › Lager included menu, also on Dinner Menu and Terrace Menu",
      "Chips",
      "Soup Starters → the top level and Mains › Hot",
      "Cola: names, description, photo, unit, how it is sold, variants, extras, options shared product",
      "Desserts",
      "Bread",
      "Specials",
      "Drinks › Beer included menu",
      "Mains: name, photo, colour included menu",
      "Top level reordered",
      "Drinks reordered included menu",
      "Device Home Page shortcuts changed",
      "What appears first on the Device Home Page changed",
      "Menu renamed from Midday Menu to Lunch Menu",
    ].sort(),
  );
});

it("words a change in Spanish, with the price in the Spanish money format", async () => {
  setLocale("es-ES");
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-22",
        targets: { before: [], after: [] },
        kind: "product_moved",
        productId: "p-soup",
        name: "Soup",
        from: [["Starters"]],
        to: [[], ["Mains", "Hot"]],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-21",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-20",
        targets: { before: [], after: [] },
        kind: "price_changed",
        productId: "p-burger",
        name: "Burger",
        from: "12.00",
        to: "13.00",
        source: "shared_product",
        alsoOn: ["Dinner Menu", "Terrace Menu"],
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-19",
        targets: { before: [], after: [] },
        kind: "home_shortcuts_changed",
        source: "this_menu",
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-18",
        targets: { before: [], after: [] },
        kind: "home_display_changed",
        source: "this_menu",
      },
    ]),
  });
  expect(items(el, "changes").map((line) => line.replace(/\s/g, " "))).toEqual(
    [
      "Soup Starters → el nivel principal y Mains › Hot",
      "Nivel principal: orden cambiado",
      "Burger 12,00 € → 13,00 € cambio en Productos, también en Dinner Menu y Terrace Menu",
      "Han cambiado los accesos directos de la página de inicio del dispositivo",
      "Ha cambiado lo que se muestra primero en la página de inicio del dispositivo",
    ].sort(),
  );
});

it("names a deleted extra-only product on its own line in English and Spanish", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-17",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["extras"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        id: "fixture-src/widgets/menu-preview.test.ts-16",
        targets: { before: [], after: [] },
        kind: "product_deleted",
        productId: "p-extra-lemon",
        name: "Extra lemon",
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ]),
  });
  expect(items(el, "changes")).toEqual(
    [
      "Lemonade: extras shared product, also on Dinner Menu",
      "Extra lemon deleted changed in Products, also on Dinner Menu",
    ].sort(),
  );

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual(
    [
      "Lemonade: extras producto compartido, también en Dinner Menu",
      "Se ha eliminado Extra lemon cambio en Productos, también en Dinner Menu",
    ].sort(),
  );
});

it("names an extra's list and old and new units in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-15",
        targets: { before: [], after: [] },
        kind: "extra_unit_changed",
        productId: "p-ham",
        name: "Ham",
        listId: "l-extras",
        listName: "Extras",
        from: {
          name: { en: "g", es: "g" },
          staffName: "g",
          staffAbbreviation: "g",
          abbreviation: { en: "g", es: "g" },
          precision: 0,
        },
        to: {
          name: { en: "kg", es: "kg" },
          staffName: "kg",
          staffAbbreviation: "kg",
          abbreviation: { en: "kg", es: "kg" },
          precision: 3,
        },
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual(
    [
      "Extras: Ham unit changed from g (0 decimal places) to kg (3 decimal places) shared product",
    ].sort(),
  );

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual(
    [
      "Extras: la unidad de Ham ha cambiado de g (0 decimales) a kg (3 decimales) producto compartido",
    ].sort(),
  );
});

it("names an extra's list and old and new portions with their units in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-14",
        targets: { before: [], after: [] },
        kind: "extra_portion_changed",
        productId: "p-ham",
        name: "Ham",
        listId: "l-extras",
        listName: "Extras",
        from: { portion: "0.050", abbreviation: { en: "kg", es: "kg" } },
        to: { portion: "0.100", abbreviation: { en: "kg", es: "kg" } },
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual(
    ["Extras: Ham portion changed from 0.050 kg to 0.100 kg changed in Modifiers"].sort(),
  );

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual(
    ["Extras: la porción de Ham ha cambiado de 0.050 kg a 0.100 kg cambio en Modificadores"].sort(),
  );
});

it("names an extra's change to no quantity limit in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-13",
        targets: { before: [], after: [] },
        kind: "extra_max_quantity_changed",
        productId: "p-ham",
        name: "Ham",
        listId: "l-extras",
        listName: "Extras",
        from: 2,
        to: null,
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual(
    ["Extras: Ham maximum quantity changed from 2 to no limit changed in Modifiers"].sort(),
  );
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual(
    [
      "Extras: la cantidad máxima de Ham ha cambiado de 2 a sin límite cambio en Modificadores",
    ].sort(),
  );
});

/** A dish's VAT change, a variant's own (named in the variants too), and an extra's. */
const VAT_CHANGES: MenuChange[] = [
  {
    id: "fixture-src/widgets/menu-preview.test.ts-12",
    targets: { before: [], after: [] },
    kind: "product_changed",
    productId: "p-lemonade",
    name: "Lemonade",
    fields: ["vat"],
    source: "shared_product",
    alsoOn: ["Dinner Menu"],
  },
  {
    id: "fixture-src/widgets/menu-preview.test.ts-11",
    targets: { before: [], after: [] },
    kind: "product_changed",
    productId: "p-burger",
    name: "Burger",
    fields: ["color", "vat", "variants"],
    source: "shared_product",
  },
  {
    id: "fixture-src/widgets/menu-preview.test.ts-10",
    targets: { before: [], after: [] },
    kind: "product_changed",
    productId: "p-cheese",
    name: "Cheese",
    fields: ["vat"],
    source: "shared_product",
  },
];

it("names a VAT change among a product's changed facts", async () => {
  const el = await mount({ preview: preview(VAT_CHANGES) });
  expect(items(el, "changes")).toEqual(
    [
      "Lemonade: VAT changed in Products, also on Dinner Menu",
      "Burger: colour, VAT, variants changed in Products",
      "Cheese: VAT changed in Products",
    ].sort(),
  );
});

it("names a VAT change in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({ preview: preview(VAT_CHANGES) });
  expect(items(el, "changes")).toEqual(
    [
      "Lemonade: IVA cambio en Productos, también en Dinner Menu",
      "Burger: color, IVA, variantes cambio en Productos",
      "Cheese: IVA cambio en Productos",
    ].sort(),
  );
});

it.each([
  ["en", "Lemonade: colour changed in Products"],
  ["es-ES", "Lemonade: color cambio en Productos"],
])("names a change to a product's colour (%s)", async (locale, line) => {
  setLocale(locale);
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-9",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["color"],
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([line]);
});

it.each([
  ["en", "Lemonade: allergens, diet changed in Products"],
  ["es-ES", "Lemonade: alérgenos, dieta cambio en Productos"],
])("names a change to a product's allergens and diet (%s)", async (locale, line) => {
  setLocale(locale);
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-allergens",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["allergens", "diet"],
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([line]);
});

it.each([
  ["en", "Daily menu: allergens, diet"],
  ["es-ES", "Daily menu: alérgenos, dieta"],
])("names a change to a set menu's dish allergens and diet (%s)", async (locale, line) => {
  setLocale(locale);
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-set-menu-allergens",
        targets: { before: [], after: [] },
        kind: "set_menu_changed",
        setMenu: { id: "m-daily", name: "Daily menu" },
        fields: ["allergens", "diet"],
        source: "set_menu",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([line]);
});

it.each([
  ["en", "Bacon: how it is sold changed in Products"],
  ["es-ES", "Bacon: cómo se vende cambio en Productos"],
])("names a change to who may order a product on its own (%s)", async (locale, line) => {
  setLocale(locale);
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-8",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-bacon",
        name: "Bacon",
        fields: ["ordering"],
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([line]);
});

it("leaves live-version facts to the header while showing pending changes", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-7",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-lemonade",
        name: "Lemonade",
        under: ["Drinks"],
        source: "this_menu",
      },
    ]),
  });
  expect(q(el, '[data-test="live"]')).toBeNull();
  expect(q(el, '[data-test="changes"]')).not.toBeNull();
});

it("offers to publish a never-published menu without repeating the header status", async () => {
  const el = await mount({
    status: { state: "unpublished", clashes: 0 },
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-6",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-burger",
        name: "Burger",
        under: [],
        source: "this_menu",
      },
    ]),
  });
  expect(q(el, '[data-test="live"]')).toBeNull();
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish now");
});

it("offers Publish now and asks to publish the hash it previewed", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-5",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
    ]),
  });
  const asked: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => asked.push((event as CustomEvent).detail));
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish now");
  expect(q(el, '[data-test="only-this-menu"]')).toBeNull();
  q(el, '[data-test="publish"]')!.click();
  expect(asked).toEqual([{ hash: NEW_HASH }]);
});

it("says there is nothing to publish when the working menu matches its live version, and offers no publish", async () => {
  const current: MenuStatus = {
    state: "current",
    clashes: 0,
    version: 4,
    publishedAt: PUBLISHED_AT,
    hash: NEW_HASH,
  };
  const el = await mount({ status: current, preview: { ...preview([]), status: current } });
  expect(text(q(el, '[data-test="nothing"]'))).toBe(
    t("menu_preview.nothing").replace("{number}", "4"),
  );
  expect(q(el, '[data-test="publish"]')).toBeNull();
});

it("judges whether there is anything to publish by the state read with the preview", async () => {
  const current: MenuStatus = {
    state: "current",
    clashes: 0,
    version: 4,
    publishedAt: PUBLISHED_AT,
    hash: NEW_HASH,
  };
  const el = await mount({ status: null, preview: { ...preview([]), status: current } });
  expect(text(q(el, '[data-test="nothing"]'))).toBe(
    t("menu_preview.nothing").replace("{number}", "4"),
  );
  el.status = current;
  el.preview = preview([]);
  await el.updateComplete;
  expect(q(el, '[data-test="nothing"]')).toBeNull();
  expect(q(el, '[data-test="publish"]')).not.toBeNull();
});

it("keeps the click that asks for a publish or a retry from reaching the page around it", async () => {
  const { el, host } = await mountIn({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-4",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
    ]),
  });
  const clicks: EventTarget[] = [];
  host.addEventListener("click", (event) => clicks.push(event.target!));
  const asked: string[] = [];
  host.addEventListener("wt-menu-publish", (event) => asked.push(event.type));
  host.addEventListener("wt-preview-retry", (event) => asked.push(event.type));
  q(el, '[data-test="publish"]')!.click();
  el.preview = null;
  el.failed = true;
  await el.updateComplete;
  q(el, '[data-test="preview-retry"]')!.click();
  expect(asked).toEqual(["wt-menu-publish", "wt-preview-retry"]);
  expect(clicks).toEqual([]);
});

it("offers the publish when the menu differs from its live version but no change can be listed", async () => {
  const el = await mount({ preview: preview([]) });
  expect(text(q(el, '[data-test="no-changes"]'))).toBe(t("menu_preview.no_changes"));
  expect(q(el, '[data-test="publish"]')).not.toBeNull();
});

it.each(["en-GB", "es-ES"])(
  "counts every missing shortcut in one sentence before confirmation and after publishing (%s)",
  async (locale) => {
    setLocale(locale);
    const el = await mount({
      menuName: "Evening",
      preview: preview(
        [],
        [
          { kind: "shortcut_missing", name: "Beer" },
          { kind: "shortcut_missing", name: "Wine" },
          { kind: "shortcut_missing", name: "Soup" },
        ],
      ),
    });
    const expected =
      locale === "en-GB"
        ? "3 shortcuts on Evening's Device Home Page point at things no longer in this menu. They stay as empty spaces until you remove them."
        : "3 accesos directos de la página de inicio del dispositivo de Evening apuntan a cosas que ya no están en esta carta. Quedan como espacios vacíos hasta que los quites.";
    expect(items(el, "warnings")).toHaveLength(1);
    expect(items(el, "warnings")[0]).toBe(expected);
    const asked = capture(el, "wt-menu-publish");
    q(el, '[data-test="publish"]')!.click();
    await el.updateComplete;
    expect(asked).toEqual([]);
    expect(text(q(el, '[data-test="publish-confirmation"]'))).toContain(expected);
    q(el, '[data-test="publish-confirm"]')!.click();
    expect(asked).toEqual([{ hash: NEW_HASH }]);
    el.result = { kind: "published", number: 3 };
    await el.updateComplete;
    expect(text(q(el, '[data-test="result"]'))).toContain(expected);
  },
);

it.each(["en-GB", "es-ES"])(
  "shows an exact over-precision extra portion without disabling Publish (%s)",
  async (locale) => {
    setLocale(locale);
    const warning = {
      kind: "extra_portion_precision" as const,
      listName: "Extras",
      name: "Extra lemon",
      portion: "0.055",
      abbreviation: { en: "kg", es: "kg" },
      precision: 2,
    };
    const el = await mount({ preview: preview([], [warning]) });
    const words = items(el, "warnings").join(" ");
    expect(words).toContain("Extras");
    expect(words).toContain("Extra lemon");
    expect(words).toContain("0.055 kg");
    expect(words).toContain(locale === "en-GB" ? "2 decimal places" : "2 decimales");
    expect(q(el, '[data-test="publish"]')).not.toBeNull();
    q(el, '[data-test="publish"]')!.click();
    await el.updateComplete;
    expect(text(q(el, '[data-test="publish-confirmation"]'))).toContain("0.055 kg");
  },
);

it("holds the publish button while a publish is out, saying what it is doing", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-2",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
    ]),
    publishing: true,
  });
  const button = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!;
  expect(button.loading).toBe(true);
  expect(text(button)).toBe("Publish now");
  expect(button.ariaDescription).toBe("Publishing Lunch Menu…");
  const asked: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => asked.push(event));
  button.click();
  expect(asked).toEqual([]);
});

it("says while the changes are being worked out, and when they could not be, offering to try again", async () => {
  const el = await mount({ preview: null });
  expect(text(q(el, '[data-test="preview-loading"]'))).toBe(t("menu_preview.loading"));
  expect(q(el, '[data-test="publish"]')).toBeNull();
  expect(q(el, '[data-test="document"]')).toBeNull();
  el.failed = true;
  await el.updateComplete;
  expect(q(el, '[data-test="preview-loading"]')).toBeNull();
  expect(text(q(el, '[data-test="preview-error"]'))).toBe(t("menu_preview.error"));
  expect(q(el, '[data-test="publish"]')).toBeNull();
  expect(q(el, '[data-test="document"]')).toBeNull();
  let retried = 0;
  el.addEventListener("wt-preview-retry", () => (retried += 1));
  q(el, '[data-test="preview-retry"]')!.click();
  expect(retried).toBe(1);
});

it("leaves the live loading state to the editor header", async () => {
  const el = await mount({ status: null });
  expect(q(el, '[data-test="live"]')).toBeNull();
});

/** The message is read inside the case, in the case's language. */
const results: [string, PublishResult, MenuStatus | null, () => string][] = [
  [
    "a publish",
    { kind: "published", number: 3 },
    changedStatus,
    () => "Lunch Menu version 3 is now live.",
  ],
  [
    "a stale preview",
    { kind: "stale" },
    changedStatus,
    () => codeMessage("menu.changed_since_preview"),
  ],
  [
    "a failed publish over a live version",
    { kind: "failed", reason: "The server is busy." },
    changedStatus,
    () =>
      "Lunch Menu was not published: version 2 is still live. Your changes are still saved. The server is busy.",
  ],
  [
    "a failed first publish",
    { kind: "failed", reason: "The server is busy." },
    { state: "unpublished", clashes: 0 },
    () =>
      "Lunch Menu was not published, so nothing new is live. Your changes are still saved. The server is busy.",
  ],
];

it.each(results)("reports %s", async (_name, result, status, message) => {
  const el = await mount({ status, result });
  const shown = q(el, '[data-test="result"]')!;
  expect(text(shown)).toBe(message());
  expect(shown.getAttribute("role")).toBe(result.kind === "published" ? "status" : "alert");
});

function documentView(el: MenuPreviewPanel): MenuDocumentTree {
  return q<MenuDocumentTree>(el, '[data-test="document"] dashboard-menu-document-tree')!;
}

async function topNames(tree: MenuDocumentTree): Promise<string[]> {
  await tree.updateComplete;
  const table = tree.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return [...table.shadowRoot!.querySelectorAll('[data-test="name"]')].map(text);
}

it("shows the whole menu the publish would make live, read-only, under its own heading", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-1",
        targets: { before: [], after: [] },
        kind: "order_changed",
        listSectionId: null,
        list: [],
        source: "this_menu",
      },
    ]),
  });
  expect(text(q(el, '[data-test="document"] h2'))).toBe("The menu as it will be published");
  const tree = documentView(el);
  await tree.updateComplete;
  expect(tree.document).toBe(DOCUMENT);
  expect(tree.view).toEqual({ kind: "customer", language: "es" });
  expect(await topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
  expect(tree.shadowRoot!.querySelector("[data-test^='edit-']")).toBeNull();
  expect((await topNames(tree)).join(" ")).toContain("para clientes");
  expect((await topNames(tree)).join(" ")).not.toContain("KITCHEN");
});

it("still shows the whole menu, as it is live, when there is nothing to publish", async () => {
  const current: MenuStatus = {
    state: "current",
    clashes: 0,
    version: 4,
    publishedAt: PUBLISHED_AT,
    hash: NEW_HASH,
  };
  const el = await mount({ status: current, preview: { ...preview([]), status: current } });
  expect(text(q(el, '[data-test="document"] h2'))).toBe("The menu as it is live");
  const tree = documentView(el);
  await tree.updateComplete;
  expect(tree.document).toBe(DOCUMENT);
  expect(tree.view).toEqual({ kind: "customer", language: "es" });
  expect(await topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
});

it("shows a never-published menu whole, as its first publish would make it live", async () => {
  const el = await mount({
    status: { state: "unpublished", clashes: 0 },
    preview: { ...preview([]), status: { state: "unpublished", clashes: 0 } },
  });
  expect(text(q(el, '[data-test="document"] h2'))).toBe("The menu as it will be published");
  const tree = documentView(el);
  await tree.updateComplete;
  expect(await topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
});

it("names the whole-menu view in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({});
  expect(text(q(el, '[data-test="document"] h2'))).toBe("La carta tal como se publicará");
});

it("names the whole-menu view in Spanish when there is nothing to publish", async () => {
  setLocale("es-ES");
  const current: MenuStatus = {
    state: "current",
    clashes: 0,
    version: 4,
    publishedAt: PUBLISHED_AT,
    hash: NEW_HASH,
  };
  const el = await mount({ status: current, preview: { ...preview([]), status: current } });
  expect(text(q(el, '[data-test="document"] h2'))).toBe("La carta tal como está publicada");
});

it("names a product the document offers nothing for as no longer available", async () => {
  const document = menuDocument([documentProduct("mi-burger", "p-burger")], {
    "p-burger": "Burger",
  });
  const el = await mount({ preview: { ...preview([]), document: { ...document, offers: {} } } });
  const tree = documentView(el);
  await tree.updateComplete;
  expect(await topNames(tree)).toEqual([t("members.missing")]);
});

it("puts one blocker card above the phone selector and labels the disputed price", async () => {
  const value = preview([]);
  value.clashes = [
    {
      productId: "p-burger",
      variantId: null,
      field: "price",
      candidates: [
        { place: { kind: "own_sections" }, value: "12.00" as never, source: { kind: "product" } },
        {
          place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
          value: "14.00" as never,
          source: { kind: "own" },
        },
      ],
    },
  ];
  const before = { width: innerWidth, height: innerHeight };
  onTestFinished(() => page.viewport(before.width, before.height));
  await page.viewport(390, 850);
  const el = await mount({ preview: value });
  const publish = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!;
  expect(publish.disabled).toBe(true);
  expect(text(q(el, '[data-test="clashes"]'))).toContain("Burger");
  expect(text(q(el, "#publish-blockers-heading"))).toBe("Fix before publishing (1)");
  const blockers = q(el, 'wt-card[data-test="publish-blockers"]')!;
  const picker = q(el, "wt-segmented-control")!;
  expect(blockers.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    picker.getBoundingClientRect().top,
  );
  const choose = blockers.querySelector<HTMLAnchorElement>('[data-test="clash-prices"]')!;
  expect(text(choose)).toContain("Choose a price");
  expect(new URL(choose.href).pathname).toMatch(/\/view\/prices\/filter\/clashes$/);
  await selectPreviewPane(el, "menu");
  expect(blockers.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    picker.getBoundingClientRect().top,
  );
  const tree = documentView(el);
  expect(await topNames(tree)).toContain("Burger para clientes");
  const table = tree.shadowRoot!.querySelector("wt-data-table")!;
  const burger = [...table.shadowRoot!.querySelectorAll('[data-test="name"]')].find(
    (name) => text(name) === "Burger para clientes",
  )!;
  expect(text(burger.closest('[part~="preview-row"]')!.querySelector('[data-test="price"]'))).toBe(
    "Price clash",
  );
  const heard = vi.fn();
  el.addEventListener("wt-menu-publish", heard);
  publish.dispatchEvent(new MouseEvent("click"));
  expect(heard).not.toHaveBeenCalled();
});

function capture(el: HTMLElement, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

it.each([
  ["en", "included menu", "also on Dinner"],
  ["es-ES", "carta incluida", "también en Dinner"],
])(
  "identifies an included menu by name and preserves affected menus in %s",
  async (locale, _source, also) => {
    setLocale(locale);
    const el = await mount({
      preview: preview([
        {
          id: "included-source",
          targets: { before: [], after: [] },
          kind: "section_changed",
          sectionId: "s-drinks",
          name: "Drinks",
          fields: ["image"],
          source: "included_menu",
          includedMenu: { id: "included", name: "Bar {source}" },
          alsoOn: ["Dinner"],
        },
      ]),
    });
    const words = text(q(el, '[data-test="changes"] .source'));
    expect(words).toContain("Bar {source}");
    expect(words).toContain(also);
  },
);

it.each([
  ["en", "Counter bar menu: shown as a folder or directly", "this menu", "Bebidas: shown directly"],
  [
    "es-ES",
    "Counter bar menu: mostrada como carpeta o directamente",
    "esta carta",
    "Bebidas: se muestra directamente",
  ],
])(
  "names an include switched between a folder and its sections, and draws it in place, in %s",
  async (locale, words) => {
    setLocale(locale);
    const content = currentContentLanguages();
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
    onTestFinished(() => setContentLanguages(content));
    const document = menuDocument(
      [
        {
          kind: "section",
          sectionId: "s-bar",
          internalName: "Counter bar menu",
          names: { en: "Drinks", es: "Bebidas" },
          image: null,
          color: null,
          includedMenu: { id: "menu-bar", name: "Bar list" },
          direct: true,
          members: [documentSection("s-cold", "Cold", [documentProduct("mi-cola", "p-cola")])],
        },
      ],
      { "p-cola": "Cola" },
    );
    const el = await mount({
      preview: {
        ...preview([
          {
            id: "switched",
            targets: {
              before: [],
              after: [{ kind: "section", sectionIds: ["s-bar"], field: { kind: "direct" } }],
            },
            kind: "section_changed",
            sectionId: "s-bar",
            name: "Counter bar menu",
            fields: ["direct"],
            source: "this_menu",
          },
        ]),
        document,
      },
    });
    expect(text(q(el, '[data-change-row="switched"]'))).toBe(words);
    expect(q(el, '[data-test="changes"] .source')).toBeNull();
    const view = documentView(el);
    await view.updateComplete;
    const table = view.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const row = table.shadowRoot!.querySelector('tr[data-row-key="s-bar"]')!;
    expect(row.textContent).toContain("Bebidas");
    row.querySelector<HTMLButtonElement>(".row-activate")!.click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('tr[data-row-key="s-bar/s-cold"]')).not.toBeNull();
  },
);

it("lets long desktop panes scroll with the page", async () => {
  await page.viewport(1280, 850);
  try {
    const document = menuDocument(
      Array.from({ length: 40 }, (_, i) => documentProduct(`mi-${i}`, `p-${i}`)),
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p-${i}`, `Frozen dish ${i}`])),
    );
    const changes: MenuChange[] = Array.from({ length: 40 }, (_, i) => ({
      id: `change-${i}`,
      targets: { before: [], after: [] },
      kind: "menu_renamed",
      from: `Long old title ${i}`,
      to: `Long new title ${i}`,
      source: "this_menu",
    }));
    const el = await mount({ preview: { ...preview(changes), document } });
    for (const name of ["document", "changes"]) {
      const pane = q(el, `[data-test="${name}-pane"]`)!;
      expect(pane.scrollHeight).toBe(pane.clientHeight);
      expect(pane.clientHeight).toBeGreaterThan(window.innerHeight);
    }
  } finally {
    await page.viewport(414, 850);
  }
});

const CLASH: MenuPreview["clashes"][number] = {
  productId: "p-burger",
  variantId: null,
  field: "price",
  candidates: [
    { place: { kind: "own_sections" }, value: "12.00" as never, source: { kind: "product" } },
    {
      place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
      value: "14.00" as never,
      source: { kind: "own" },
    },
  ],
};

it.each(["light", "dark"] as const)(
  "draws Publish quiet while the menu has clashes, and blue without them (%s theme)",
  async (theme) => {
    const renamed: MenuChange = {
      id: "change-renamed",
      targets: { before: [], after: [] },
      kind: "menu_renamed",
      from: "Lunch",
      to: "Lunch Menu",
      source: "this_menu",
    };
    const { el } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      {
        menuName: "Lunch Menu",
        status: changedStatus,
        preview: { ...preview([renamed]), clashes: [CLASH] },
      },
      theme,
    );
    const fill = (button: Element) =>
      getComputedStyle(button.shadowRoot!.querySelector("button")!).backgroundColor;
    const button = (test: string) =>
      q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test="${test}"]`)!;
    await button("publish").updateComplete;
    expect(button("publish").disabled).toBe(true);
    expect(button("publish").variant).toBe("secondary");
    const quiet = fill(button("publish"));
    el.preview = preview([renamed]);
    await el.updateComplete;
    await button("publish").updateComplete;
    expect(button("publish").disabled).toBe(false);
    expect(button("publish").variant).toBe("primary");
    expect(fill(button("publish"))).not.toBe(quiet);
  },
);

it("keeps Publish blue while its own publish is being sent, even if a clash arrives meanwhile", async () => {
  const el = await mount({ publishing: true });
  const publish = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!;
  expect(publish.variant).toBe("primary");
  el.preview = { ...preview([]), clashes: [CLASH] };
  await el.updateComplete;
  expect(publish.disabled).toBe(true);
  expect(publish.variant).toBe("primary");
});

it("draws notices above both panes and queued versions below them", async () => {
  await page.viewport(1280, 900);
  const el = await mount({
    preview: preview([
      {
        id: "new-product",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-burger",
        name: "Burger",
        under: [],
        source: "this_menu",
      },
    ]),
  });
  el.style.width = "1200px";
  el.includedBy = [{ id: "breakfast", name: "Breakfast Menu" }];
  el.api.getMenuPublications = async () => ({
    timeZone: "Europe/Madrid",
    live: null,
    editions: [
      {
        versionId: "v3",
        number: 3,
        state: "queued",
        contentHash: NEW_HASH,
        queuedAt: PUBLISHED_AT,
        cancelledAt: null,
        activatesAt: PUBLISHED_AT,
        local: { date: "2026-09-26", time: "12:15", offset: "+02:00", repeated: false },
      },
    ],
  });
  el.menuId = "schedule-fixture";
  await el.updateComplete;
  const schedules = el.shadowRoot!.querySelector("dashboard-menu-publications")!;
  const details = '[data-test="editions"]';
  await expect.poll(() => schedules.shadowRoot!.querySelector(details)).not.toBeNull();
  const bounds = (element: Element) => element.getBoundingClientRect();
  const panes = q(el, ".panes")!;
  expect(bounds(q(el, '[data-test="only-this-menu"]')!).bottom).toBeLessThan(bounds(panes).top);
  expect(bounds(schedules.shadowRoot!.querySelector(details)!).top).toBeGreaterThan(
    bounds(panes).bottom,
  );
  const tree = q<MenuDocumentTree>(el, "dashboard-menu-document-tree")!;
  await tree.updateComplete;
  const table = tree.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const selector = q(el, "wt-combobox")!.getBoundingClientRect();
  const expand = table.shadowRoot!.querySelector(".expand-all")!.getBoundingClientRect();
  expect(expand.top).toBeLessThan(selector.bottom);
  expect(expand.left).toBeGreaterThanOrEqual(selector.right);
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish now");
  expect(text(q(el, '[data-test="document"]'))).toContain(
    "Current product availability is not shown.",
  );
});

it("A498 keeps the content choice readable beside Expand all on a phone", async () => {
  await page.viewport(390, 844);
  const el = await mount({});
  el.style.width = "358px";
  await selectPreviewPane(el, "menu");
  const tree = q<MenuDocumentTree>(el, "dashboard-menu-document-tree")!;
  await tree.updateComplete;
  const table = tree.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const selector = q(el, "wt-combobox")!.getBoundingClientRect();
  const expand = table.shadowRoot!.querySelector(".expand-all")!.getBoundingClientRect();
  expect(selector.width).toBeGreaterThanOrEqual(170);
  expect(expand.top).toBeLessThan(selector.bottom);
  expect(expand.left).toBeGreaterThanOrEqual(selector.right);
});

it.each([
  ["en-GB", "Valencian"],
  ["es-ES", "Valenciano"],
])("offers the standalone Valencian preview in %s", async (locale, name) => {
  setLocale(locale!);
  const before = currentContentLanguages();
  try {
    setContentLanguages({ defaultLanguage: "ca-ES-valencia", languages: ["ca-ES-valencia"] });
    const el = await mount({});
    const chooser = q<HTMLElementTagNameMap["wt-combobox"]>(el, "[name=menu-preview-view]")!;
    expect(chooser.options.find((option) => option.value === "ca-ES-valencia")?.label).toBe(name);
  } finally {
    setContentLanguages(before);
  }
});

it("distinguishes a regional content version in the preview picker", async () => {
  const before = currentContentLanguages();
  try {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "en-US"] });
    const el = await mount({});
    const chooser = q<HTMLElementTagNameMap["wt-combobox"]>(el, "[name=menu-preview-view]")!;
    expect(chooser.options.find((option) => option.value === "en")?.label).toBe("English");
    expect(chooser.options.find((option) => option.value === "en-US")?.label).toBe(
      "English (United States)",
    );
  } finally {
    setContentLanguages(before);
  }
});

it("names a clashing variant by its name, and by its id when the menu no longer offers it", async () => {
  const offers = structuredClone(DOCUMENT.offers);
  const burger = offers["mi-burger"]!;
  burger.variants = [
    {
      ...burger,
      id: "v-large",
      name: "Large",
      unitPrice: "13.00",
      menuPrice: null,
      pricingUnit: "each",
    },
  ];
  const el = await mount({
    preview: {
      ...preview([]),
      document: { ...DOCUMENT, offers },
      clashes: [
        { ...CLASH, variantId: "v-large" },
        { ...CLASH, variantId: "v-gone" },
        { ...CLASH, productId: "p-unknown" },
      ],
    },
  });
  const items = [...el.shadowRoot!.querySelectorAll('[data-test="clashes"] li')].map((li) =>
    li.textContent!.replace(/\s+/g, " ").trim(),
  );
  expect(items[0]).toMatch(/^Burger › Large/);
  expect(items[1]).toMatch(/^Burger › v-gone/);
  expect(items[2]).toMatch(/^p-unknown/);
});

it("asks the page for the price clashes instead of following the link when Choose a price is clicked", async () => {
  const el = await mount({ preview: { ...preview([]), clashes: [CLASH] } });
  const heard = vi.fn();
  document.addEventListener("wt-preview-clashes", heard);
  onTestFinished(() => document.removeEventListener("wt-preview-clashes", heard));
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>('[data-test="clash-prices"]')!;
  const followed = link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  expect(followed).toBe(false);
  expect(heard).toHaveBeenCalledOnce();
});

it("links each set menu with problems to its set menu tab, counting one problem and several", async () => {
  const el = await mount({
    preview: {
      ...preview([]),
      setMenuProblems: [
        { menuId: "daily", name: "Daily menu", problems: [{ kind: "no_dishes" }] },
        {
          menuId: "weekend",
          name: "Weekend menu",
          problems: [{ kind: "no_dishes" }, { kind: "no_lines" }],
        },
      ],
    },
  });
  const links = [
    ...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>('a[href^="/set-menus/menu/"]'),
  ];
  expect(links.map((link) => new URL(link.href).pathname)).toEqual([
    "/set-menus/menu/daily",
    "/set-menus/menu/weekend",
  ]);
  expect(links[0]!.textContent!.trim()).toBe(
    fill("menu_preview.set_menu_problem_count_one", { name: "Daily menu", count: "1" }),
  );
  expect(links[1]!.textContent!.trim()).toBe(
    fill("menu_preview.set_menu_problem_count", { name: "Weekend menu", count: "2" }),
  );
});

it("closes the publish warning confirmation on Cancel and publishes nothing", async () => {
  const el = await mount({
    preview: preview(
      [],
      [
        {
          kind: "allergens_unreviewed",
          products: [{ id: "p-burger", name: "Burger", parentName: null }],
        },
      ],
    ),
  });
  const published = vi.fn();
  el.addEventListener("wt-menu-publish", published);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!.click();
  await el.updateComplete;
  const confirmation = text(q(el, '[data-test="publish-confirmation"]'));
  expect(confirmation).toContain("Allergens not yet reviewed");
  expect(confirmation).toContain("Burger");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish-cancel"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-test="publish-confirmation"]')).toBeNull();
  expect(published).not.toHaveBeenCalled();
});

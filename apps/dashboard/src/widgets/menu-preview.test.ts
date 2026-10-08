import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { page } from "vitest/browser";
import type { MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { MenuPreviewPanel, type PublishResult } from "./menu-preview.js";
import type { CustomerMenu } from "./customer-menu.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

// The wording is asserted as a person reads it, in English unless a case says otherwise.
beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.restoreAllMocks();
  setLocale("es-ES");
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
  return [...el.shadowRoot!.querySelectorAll(`[data-test="${list}"] li`)].map(text);
}

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
        fields: ["allergens"],
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
        fields: ["names", "description", "image", "unit", "diet", "variants", "extras", "options"],
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
        device: "till",
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
  expect(items(el, "changes")).toEqual([
    "Lemonade added under Drinks — this menu",
    "Burger price changed from €12.00 to €13.00 — shared product, also on Dinner Menu",
    "Lemonade: allergens — shared product, also on Dinner Menu",
    "Drinks renamed — included menu",
    "Lager removed from Drinks › Beer — included menu, also on Dinner Menu and Terrace Menu",
    "Chips added at the top level — this menu",
    "Soup moved from Starters to the top level and Mains › Hot — this menu",
    "Cola: names, description, photo, unit, diet, variants, extras, options — shared product",
    "Section Desserts added at the top level — this menu",
    "Bread removed from the top level — this menu",
    "Section Specials removed from the top level — this menu",
    "Section Beer removed from Drinks — included menu",
    "Mains: name, photo, colour — included menu",
    "Order changed at the top level — this menu",
    "Order changed in Drinks — included menu",
    "Device Home Page shortcuts changed — this menu",
    "Device Home Page display for Till changed — this menu",
    "Menu renamed from Midday Menu to Lunch Menu — this menu",
  ]);
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
        device: "handheld",
        source: "this_menu",
      },
    ]),
  });
  expect(items(el, "changes").map((line) => line.replace(/\s/g, " "))).toEqual([
    "Se ha movido Soup: antes en Starters; ahora en el nivel principal y Mains › Hot — esta carta",
    "Ha cambiado el orden en el nivel principal — esta carta",
    "Ha cambiado el precio de Burger de 12,00 € a 13,00 € — producto compartido, también en Dinner Menu y Terrace Menu",
    "Han cambiado los accesos directos de la página de inicio del dispositivo — esta carta",
    "Ha cambiado la presentación de la página de inicio del dispositivo en Terminal de mano — esta carta",
  ]);
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
  expect(items(el, "changes")).toEqual([
    "Lemonade: extras — shared product, also on Dinner Menu",
    "Extra lemon deleted — shared product, also on Dinner Menu",
  ]);

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual([
    "Lemonade: extras — producto compartido, también en Dinner Menu",
    "Se ha eliminado Extra lemon — producto compartido, también en Dinner Menu",
  ]);
});

it("names an extra's list and old and new units in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-15",
        targets: { before: [], after: [] },
        kind: "extra_unit_changed",
        productId: "p-ham",
        name: "Jamón",
        listId: "l-extras",
        listName: "Extras",
        from: { abbreviation: { en: "g", es: "g" }, precision: 0 },
        to: { abbreviation: { en: "kg", es: "kg" }, precision: 3 },
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([
    "Extras: Jamón unit changed from g (0 decimal places) to kg (3 decimal places) — shared product",
  ]);

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual([
    "Extras: la unidad de Jamón ha cambiado de g (0 decimales) a kg (3 decimales) — producto compartido",
  ]);
});

it("names an extra's list and old and new portions with their units in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-14",
        targets: { before: [], after: [] },
        kind: "extra_portion_changed",
        productId: "p-ham",
        name: "Jamón",
        listId: "l-extras",
        listName: "Extras",
        from: { portion: "0.050", abbreviation: { en: "kg", es: "kg" } },
        to: { portion: "0.100", abbreviation: { en: "kg", es: "kg" } },
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([
    "Extras: Jamón portion changed from 0.050 kg to 0.100 kg — shared product",
  ]);

  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual([
    "Extras: la porción de Jamón ha cambiado de 0.050 kg a 0.100 kg — producto compartido",
  ]);
});

it("names an extra's change to no quantity limit in both languages", async () => {
  const el = await mount({
    preview: preview([
      {
        id: "fixture-src/widgets/menu-preview.test.ts-13",
        targets: { before: [], after: [] },
        kind: "extra_max_quantity_changed",
        productId: "p-ham",
        name: "Jamón",
        listId: "l-extras",
        listName: "Extras",
        from: 2,
        to: null,
        source: "shared_product",
      },
    ]),
  });
  expect(items(el, "changes")).toEqual([
    "Extras: Jamón maximum quantity changed from 2 to no limit — shared product",
  ]);
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(items(el, "changes")).toEqual([
    "Extras: la cantidad máxima de Jamón ha cambiado de 2 a sin límite — producto compartido",
  ]);
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
    fields: ["allergens", "vat", "variants"],
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
  expect(items(el, "changes")).toEqual([
    "Lemonade: VAT — shared product, also on Dinner Menu",
    "Burger: allergens, VAT, variants — shared product",
    "Cheese: VAT — shared product",
  ]);
});

it("names a VAT change in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount({ preview: preview(VAT_CHANGES) });
  expect(items(el, "changes")).toEqual([
    "Lemonade: IVA — producto compartido, también en Dinner Menu",
    "Burger: alérgenos, IVA, variantes — producto compartido",
    "Cheese: IVA — producto compartido",
  ]);
});

it.each([
  ["en", "Lemonade: colour — shared product"],
  ["es-ES", "Lemonade: color — producto compartido"],
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
  ["en", "Bacon: how it is sold — shared product"],
  ["es-ES", "Bacon: cómo se vende — producto compartido"],
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
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish Lunch Menu");
});

it("names the one menu on the publish button, and asks to publish the hash it previewed", async () => {
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
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish Lunch Menu");
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
  expect(text(button)).toBe("Publishing Lunch Menu…");
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

function documentView(el: MenuPreviewPanel): CustomerMenu {
  return q<CustomerMenu>(el, '[data-test="document"] dashboard-customer-menu')!;
}

/** The frozen document's root product/section labels, in the selected content view. */
function topNames(tree: CustomerMenu): string[] {
  return [
    ...tree.shadowRoot!.querySelectorAll(
      ".menu > [data-change-target] > .members > .product .heading > span[lang], .menu > [data-change-target] > .members > .section > [data-change-target] .heading > button > span:first-of-type, .menu > [data-change-target] > .members > .missing",
    ),
  ].map(text);
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
  expect(topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
  expect(tree.shadowRoot!.querySelector("[data-test^='edit-']")).toBeNull();
  expect(tree.shadowRoot!.textContent).toContain("para clientes");
  expect(tree.shadowRoot!.textContent).not.toContain("COCINA");
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
  expect(topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
});

it("shows a never-published menu whole, as its first publish would make it live", async () => {
  const el = await mount({
    status: { state: "unpublished", clashes: 0 },
    preview: { ...preview([]), status: { state: "unpublished", clashes: 0 } },
  });
  expect(text(q(el, '[data-test="document"] h2'))).toBe("The menu as it will be published");
  const tree = documentView(el);
  await tree.updateComplete;
  expect(topNames(tree)).toEqual(["Burger para clientes", "Drinks para clientes"]);
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
  expect(topNames(tree)).toEqual([t("members.missing")]);
});

it("lists unresolved clashes above Publish and disables publishing", async () => {
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
  const el = await mount({ preview: value });
  const publish = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!;
  expect(publish.disabled).toBe(true);
  expect(text(q(el, '[data-test="clashes"]'))).toContain("Burger");
  expect(text(q(el, '[data-test="clash-count"]'))).toBe(
    "1 price has a clash. Resolve it before publishing this menu.",
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
  ["en", "price set to", "Price override —"],
  ["es-ES", "precio fijado", "Precio propio —"],
])("names each publication clash by its set prices in %s", async (locale, wanted, retired) => {
  setLocale(locale);
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
  const el = await mount({ preview: value });
  expect(text(q(el, '[data-test="clashes"]'))).toContain(wanted);
  expect(text(q(el, '[data-test="clashes"]'))).not.toContain(retired);
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!.disabled).toBe(true);
});

it.each([
  ["en", "included menu", "also on Dinner"],
  ["es-ES", "carta incluida", "también en Dinner"],
])(
  "identifies an included menu by name and preserves affected menus in %s",
  async (locale, source, also) => {
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
    expect(words).toContain(source);
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
  async (locale, words, source, note) => {
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
    expect(text(q(el, 'button[data-change-id="switched"]'))).toBe(words);
    expect(text(q(el, '[data-test="changes"] .source'))).toBe(`— ${source}`);
    expect(text(q(el, 'button[data-side="after"]'))).toContain(words.split(": ")[1]);
    const view = q<CustomerMenu>(el, "dashboard-customer-menu")!;
    await view.updateComplete;
    expect(text(view.shadowRoot!.querySelector("[data-direct]"))).toBe(note);
    expect(view.shadowRoot!.querySelector("[data-direct] span")!.getAttribute("lang")).toBe("es");
  },
);

it.each([
  [390, "en", "light"],
  [390, "es-ES", "dark"],
  [1280, "en", "dark"],
  [1280, "es-ES", "light"],
] as const)(
  "places the menu and changes in bounded panes at %i px (%s, %s)",
  async (width, locale, theme) => {
    await page.viewport(width, 850);
    try {
      setLocale(locale);
      const { el, host } = await mountWidget<MenuPreviewPanel>(
        "dashboard-menu-preview",
        {
          menuName: "Lunch",
          status: changedStatus,
          preview: preview([
            {
              id: "layout",
              targets: { before: [], after: [] },
              kind: "menu_renamed",
              from: "Old lunch",
              to: "Lunch",
              source: "this_menu",
            },
          ]),
        },
        theme,
      );
      host.style.width = "100%";
      await el.updateComplete;
      const documentPane = q(el, '[data-test="document-pane"]');
      const changesPane = q(el, '[data-test="changes-pane"]');
      expect(documentPane).not.toBeNull();
      expect(changesPane).not.toBeNull();
      const left = changesPane!.getBoundingClientRect();
      const right = documentPane!.getBoundingClientRect();
      if (width === 390) {
        expect(right.top).toBeGreaterThanOrEqual(left.bottom);
        expect(Math.abs(right.left - left.left)).toBeLessThan(1);
      } else {
        expect(right.left).toBeGreaterThanOrEqual(left.right);
        expect(Math.abs(right.top - left.top)).toBeLessThan(1);
      }
      expect(documentPane!.contains(q(el, '[data-test="document"]'))).toBe(true);
      expect(changesPane!.contains(q(el, '[data-test="changes"]'))).toBe(true);
      const publish = q(el, '[data-test="publish"]')!;
      expect(documentPane!.contains(publish)).toBe(false);
      expect(changesPane!.contains(publish)).toBe(false);
      expect(publish.getBoundingClientRect().bottom).toBeLessThanOrEqual(left.top);
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
      expect(getComputedStyle(documentPane!).overflowY).toBe("auto");
      expect(getComputedStyle(changesPane!).overflowY).toBe("auto");
    } finally {
      await page.viewport(414, 850);
    }
  },
);

it("makes overflowing pane regions keyboard reachable without scrolling the publication action", async () => {
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
    const publish = q(el, '[data-test="publish"]')!;
    const actionTop = publish.getBoundingClientRect().top;
    for (const name of ["document", "changes"]) {
      const pane = q(el, `[data-test="${name}-pane"]`)!;
      expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
      expect(pane.tabIndex).toBe(0);
      expect(pane.getAttribute("role")).toBe("region");
      expect(pane.getAttribute("aria-labelledby")).toBe(`${name}-heading`);
      pane.focus();
      expect(el.shadowRoot!.activeElement).toBe(pane);
      pane.scrollTop = pane.scrollHeight;
      expect(pane.scrollTop).toBeGreaterThan(0);
      expect(publish.getBoundingClientRect().top).toBe(actionTop);
    }
  } finally {
    await page.viewport(414, 850);
  }
});

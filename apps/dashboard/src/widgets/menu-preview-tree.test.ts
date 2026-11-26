import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentContentLanguages, registerIcons, setContentLanguages } from "@waitron/ui";
import type { MenuChange, MenuPreview } from "../api/client.js";
import type { MenuTarget } from "@waitron/shared";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import type { MenuDocumentTree } from "./menu-document-tree.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountMenuPreview as mountWidget,
  expectNoA11yViolations,
} from "./test-helpers.js";

registerIcons(DASHBOARD_ICONS);
let locale: string;
let languages: ReturnType<typeof currentContentLanguages>;
beforeEach(async () => {
  locale = currentLocale();
  languages = currentContentLanguages();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  await page.viewport(1280, 900);
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
  setContentLanguages(languages);
});
const target: MenuTarget = {
  kind: "product",
  sectionIds: ["outer", "inner"],
  menuItemId: "mi",
  productId: "dish",
  field: { kind: "description", language: "en" },
};
function change(): MenuChange {
  return {
    id: "stable",
    kind: "product_changed",
    productId: "dish",
    name: "Counter lemonade",
    fields: ["description"],
    source: "shared_product",
    targets: { before: [target], after: [target] },
  };
}
function fixture(changes: MenuChange[] = [change()]): MenuPreview {
  const document = menuDocument(
    [
      documentSection("outer", "Counter drinks", [
        documentSection("inner", "Counter cold", [documentProduct("mi", "dish")]),
      ]),
    ],
    { dish: "Counter lemonade" },
    "Frozen lunch",
  );
  document.offers.mi!.customerName = { en: "House lemonade", es: "Limonada" };
  return {
    setMenuProblems: [],
    document,
    live: { versionId: "v2", document: structuredClone(document) },
    changes,
    hash: "proposed",
    warnings: [],
    clashes: [],
    status: {
      state: "changed",
      version: 2,
      publishedAt: "2026-10-01T10:00:00Z",
      hash: "old",
      clashes: 0,
    },
  };
}
async function mount(preview = fixture()) {
  return (
    await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
      preview,
      menuName: "Working title",
    })
  ).el;
}
async function tree(el: MenuPreviewPanel) {
  const node = el.shadowRoot!.querySelector<MenuDocumentTree>("dashboard-menu-document-tree");
  expect(node).not.toBeNull();
  await node!.updateComplete;
  await node!.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  return node!;
}
function rows(node: MenuDocumentTree) {
  return node.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
}
function link(el: MenuPreviewPanel, id = "stable") {
  return el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[data-change-id="${id}"]`)!;
}

it("connects Preview to the frozen Structure tree and switches its content names", async () => {
  const p = fixture();
  const el = await mount(p);
  const node = await tree(el);
  expect(node.document).toBe(p.document);
  expect(node.view).toEqual({ kind: "customer", language: "es" });
  const table = node.shadowRoot!.querySelector("wt-data-table")!;
  await table.revealRow("outer/inner/mi");
  expect(rows(node).querySelector('tr[data-row-key="outer/inner/mi"]')!.textContent).toContain(
    "Limonada",
  );
  const selector = el.shadowRoot!.querySelector("wt-combobox")!;
  selector.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "en" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await node.updateComplete;
  await table.updateComplete;
  expect(rows(node).textContent).toContain("House lemonade");
  p.document.offers.mi!.customerName = { en: "Mutated caller" };
  el.menuName = "Another heading";
  await el.updateComplete;
  await node.updateComplete;
  expect(rows(node).textContent).not.toContain("Mutated caller");
  expect(rows(node).querySelector("wt-row-actions, [part~='drag-grip'], input")).toBeNull();
  expect(el.shadowRoot!.querySelector("dashboard-customer-menu")).toBeNull();
});

it("uses a grouped name link to reveal a nested product without taking focus", async () => {
  const el = await mount();
  const node = await tree(el);
  expect(el.shadowRoot!.querySelector('[data-group="details"] h3')!.textContent).toBe("Details");
  expect(el.shadowRoot!.querySelector('[data-group="prices"]')).toBeNull();
  const view = link(el);
  expect(view).not.toBeNull();
  expect(view.textContent?.trim()).toBe("Counter lemonade");
  view.focus();
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => rows(node).querySelector('[aria-current="true"]')?.textContent)
    .toContain("Limonada");
  expect(
    rows(node)
      .querySelector('tr[data-row-key="outer"] .row-activate')!
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    rows(node)
      .querySelector('tr[data-row-key="outer/inner"] .row-activate')!
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(el.shadowRoot!.activeElement).toBe(view);
  expect(node.view).toEqual({ kind: "customer", language: "es" });
  expect(
    el.shadowRoot!.querySelector(
      "button[data-change-id], button[data-side], [data-test='target-count'], [data-test='return-change']",
    ),
  ).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!.click();
  await expect.poll(() => rows(node).querySelector('[aria-current="true"]')).toBeNull();
});

it("shows removed and deleted products as text", async () => {
  const removed: MenuChange = {
    id: "removed",
    kind: "product_removed",
    productId: "dish",
    name: "Old dish",
    under: ["Drinks", "Cold"],
    source: "this_menu",
    targets: { before: [target], after: [] },
  };
  const deleted: MenuChange = {
    id: "deleted",
    kind: "product_deleted",
    productId: "gone",
    name: "Gone",
    source: "shared_product",
    targets: { before: [target], after: [] },
  };
  const p = fixture([removed, deleted]);
  const outer = p.document.root.members[0]!;
  if (outer.kind !== "section") throw new Error("fixture");
  const inner = outer.members[0]!;
  if (inner.kind !== "section") throw new Error("fixture");
  inner.members = [];
  delete p.document.offers.mi;
  const el = await mount(p);
  expect(link(el, "removed")).toBeNull();
  expect(link(el, "deleted")).toBeNull();
  expect(
    el.shadowRoot!.querySelector("[data-test='before'], [data-test='return-proposed']"),
  ).toBeNull();
});

it("replaces the frozen envelope and resets expansion without stealing focus", async () => {
  const p = fixture();
  const el = await mount(p);
  const node = await tree(el);
  link(el).click();
  await expect.poll(() => rows(node).querySelector('[aria-current="true"]')).not.toBeNull();
  const publish = el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!;
  publish.focus();
  p.document.menuName = "Replacement title";
  el.preview = { ...p, hash: "new" };
  await el.updateComplete;
  await expect.poll(() => rows(node).textContent).toContain("Replacement title");
  expect(rows(node).querySelector('tr[data-row-key="outer/inner/mi"]')).toBeNull();
  expect(rows(node).querySelector('[aria-current="true"]')).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(publish);
});

it("routes Home View as a normal link to this menu's Home tab", async () => {
  const home: MenuChange = {
    id: "home",
    kind: "home_display_changed",
    source: "this_menu",
    targets: { before: [], after: [{ kind: "home", field: "order" }] },
  };
  const el = await mount(fixture([home]));
  expect(link(el, "home")).not.toBeNull();
  expect(link(el, "home").getAttribute("href")).toBe("/menus/menu/menu-lunch/view/home");
});

it.each([
  ["en", "Menu customer names changed", "Daily menu: course names"],
  [
    "es-ES",
    "Han cambiado los nombres de la carta para clientes",
    "Daily menu: nombres de los órdenes de plato",
  ],
])("shows customer title and course name changes in %s", async (locale, title, courses) => {
  setLocale(locale);
  const el = await mount(
    fixture([
      {
        id: "menu-names",
        kind: "menu_customer_names_changed",
        source: "this_menu",
        targets: {
          before: [],
          after: [{ kind: "title", menuId: "menu-lunch" }],
        },
      },
      {
        id: "course-names",
        kind: "set_menu_changed",
        setMenu: { id: "daily", name: "Daily menu" },
        fields: ["course_names"],
        source: "set_menu",
        targets: { before: [], after: [] },
      },
    ]),
  );
  const row = (id: string) => el.shadowRoot!.querySelector(`[data-change-row="${id}"]`);
  expect(row("menu-names")?.textContent ?? "").toContain(title);
  expect(row("course-names")?.textContent ?? "").toContain(courses);
});

it("places every change kind in its named group and keeps the groups in working order", async () => {
  const shared = { source: "this_menu" as const, targets: { before: [], after: [] } };
  const product = { productId: "dish", name: "Lemonade" };
  const section = {
    sectionId: "inner",
    name: "Cold",
    parentSectionIds: ["outer"],
    under: ["Drinks"],
  };
  const extra = { ...product, listId: "extras", listName: "Extras" };
  const unit = {
    name: { en: "Gram" },
    staffName: "Gram",
    staffAbbreviation: "g",
    abbreviation: { en: "g" },
    precision: 0,
  };
  const setMenu = { id: "daily", name: "Daily menu" };
  const kinds: Record<MenuChange["kind"], MenuChange> = {
    menu_renamed: { ...shared, id: "rename", kind: "menu_renamed", from: "Old", to: "New" },
    menu_customer_names_changed: {
      ...shared,
      id: "menu-names",
      kind: "menu_customer_names_changed",
    },
    section_added: { ...shared, ...section, id: "section-add", kind: "section_added" },
    section_removed: { ...shared, ...section, id: "section-remove", kind: "section_removed" },
    section_changed: {
      ...shared,
      ...section,
      id: "section-change",
      kind: "section_changed",
      fields: ["color"],
    },
    product_added: { ...shared, ...product, id: "product-add", kind: "product_added", under: [] },
    product_removed: {
      ...shared,
      ...product,
      id: "product-remove",
      kind: "product_removed",
      under: [],
    },
    product_deleted: { ...shared, ...product, id: "product-delete", kind: "product_deleted" },
    product_moved: {
      ...shared,
      ...product,
      id: "product-move",
      kind: "product_moved",
      from: [[]],
      to: [["Cold"]],
    },
    set_menu_added: {
      ...shared,
      id: "set-add",
      kind: "set_menu_added",
      setMenu,
      sectionIds: [],
      under: [],
    },
    set_menu_removed: {
      ...shared,
      id: "set-remove",
      kind: "set_menu_removed",
      setMenu,
      sectionIds: [],
      under: [],
    },
    set_menu_changed: {
      ...shared,
      id: "set-change",
      kind: "set_menu_changed",
      setMenu,
      fields: ["price"],
      source: "set_menu",
    },
    price_changed: {
      ...shared,
      ...product,
      id: "price",
      kind: "price_changed",
      from: "2.00",
      to: "3.00",
    },
    product_changed: {
      ...shared,
      ...product,
      id: "details",
      kind: "product_changed",
      fields: ["image"],
    },
    extra_unit_changed: {
      ...shared,
      ...extra,
      id: "extra-unit",
      kind: "extra_unit_changed",
      from: unit,
      to: unit,
    },
    extra_portion_changed: {
      ...shared,
      ...extra,
      id: "extra-portion",
      kind: "extra_portion_changed",
      from: { portion: "1", ...unit },
      to: { portion: "2", ...unit },
    },
    extra_max_quantity_changed: {
      ...shared,
      ...extra,
      id: "extra-max",
      kind: "extra_max_quantity_changed",
      from: 1,
      to: 2,
    },
    order_changed: {
      ...shared,
      id: "order",
      kind: "order_changed",
      listSectionId: "mains",
      list: ["Mains"],
    },
    home_shortcuts_changed: { ...shared, id: "shortcuts", kind: "home_shortcuts_changed" },
    home_display_changed: {
      ...shared,
      id: "home-display",
      kind: "home_display_changed",
    },
  };
  const el = await mount(fixture(Object.values(kinds).reverse()));
  const groups = [...el.shadowRoot!.querySelectorAll("[data-group]")];
  const order = el.shadowRoot!.querySelector('[data-change-row="order"]')!;
  expect(order.textContent?.trim()).toBe("Mains reordered");
  expect(getComputedStyle(order.parentElement!).listStyleType).toBe("disc");
  expect(
    groups.map((group) => [
      group.querySelector("h3")!.textContent,
      [...group.querySelectorAll("li")].map((row) => row.getAttribute("data-change-row")),
    ]),
  ).toEqual([
    ["Added", ["set-add", "product-add", "section-add"]],
    ["Removed", ["set-remove", "product-delete", "product-remove", "section-remove"]],
    ["Prices", ["price"]],
    ["Order", ["order", "product-move"]],
    [
      "Details",
      [
        "home-display",
        "shortcuts",
        "extra-max",
        "extra-portion",
        "extra-unit",
        "details",
        "set-change",
        "section-change",
        "menu-names",
        "rename",
      ],
    ],
  ]);
});

it.each(["light", "dark"] as const)(
  "keeps the grouped name link accessible in Spanish (%s)",
  async (theme) => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { preview: fixture(), menuName: "Lunch" },
      theme,
    );
    expect(el.shadowRoot!.querySelector('[data-group="details"] h3')!.textContent).toBe("Detalles");
    expect(link(el).textContent?.trim()).toBe("Counter lemonade");
    await expectNoA11yViolations(host);
  },
);

it("keeps the tree's swatch-size image slot visible beside changes in a desktop dashboard column", async () => {
  const el = await mount();
  el.style.width = "900px";
  await el.updateComplete;
  const changes = el
    .shadowRoot!.querySelector('[data-test="changes-pane"]')!
    .getBoundingClientRect();
  const document = el
    .shadowRoot!.querySelector('[data-test="document-pane"]')!
    .getBoundingClientRect();
  expect(document.width).toBeGreaterThan(changes.width);
  const node = await tree(el);
  const table = node.shadowRoot!.querySelector("wt-data-table")!;
  await table.revealRow("outer/inner/mi");
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(table.hasAttribute("narrow")).toBe(false);
  const frame = table.shadowRoot!.querySelector<HTMLElement>('[part~="product-media"]')!;
  expect(frame.getBoundingClientRect().width).toBe(
    parseFloat(getComputedStyle(node).getPropertyValue("--wt-tap-min")),
  );
});

it("keeps the content view through a same-menu empty reload", async () => {
  const el = await mount();
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "en" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  el.preview = null;
  await el.updateComplete;
  el.preview = fixture([change(), { ...change(), id: "new" }]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-change-row="new"]')).not.toBeNull();
  expect((await tree(el)).view).toEqual({ kind: "customer", language: "en" });
});

it.each(
  (["light", "dark"] as const).flatMap((theme) =>
    [390, 1280].flatMap((width) => [
      {
        theme,
        width,
        language: "en",
        saved: "Special menu was saved again",
        added: "Counter drinks › Daily menu",
        removed: "Counter cold › Daily menu",
        changed: "Daily menu: dishes",
      },
      {
        theme,
        width,
        language: "es-ES",
        saved: "Se ha vuelto a guardar Special menu",
        added: "Counter drinks › Daily menu",
        removed: "Counter cold › Daily menu",
        changed: "Daily menu: platos",
      },
    ]),
  ),
)("shows set-menu changes in $language $theme at $width px", async (display) => {
  const { width, theme, language } = display;
  await page.viewport(width, 900);
  setLocale(language);
  const setMenu = { id: "daily", name: "Daily menu" };
  const targets = { before: [], after: [] };
  const preview = fixture([
    {
      id: "add",
      kind: "set_menu_added",
      setMenu,
      under: ["Counter drinks"],
      sectionIds: ["outer"],
      source: "this_menu",
      targets,
    },
    {
      id: "remove",
      kind: "set_menu_removed",
      setMenu,
      under: ["Counter cold"],
      sectionIds: ["inner"],
      source: "this_menu",
      targets,
    },
    {
      id: "copy",
      kind: "set_menu_changed",
      setMenu,
      fields: ["dishes"],
      source: "set_menu",
      targets,
      alsoOn: ["Weekend"],
    },
    {
      id: "saved",
      kind: "set_menu_changed",
      setMenu: { id: "special", name: "Special menu" },
      fields: [],
      source: "set_menu",
      targets,
    },
  ]);
  const { el, host } = await mountWidget<MenuPreviewPanel>(
    "dashboard-menu-preview",
    { preview, menuName: "Lunch" },
    theme,
  );
  const row = (id: string) => el.shadowRoot!.querySelector(`[data-change-row="${id}"]`);
  expect(row("add")?.textContent).toContain(display.added);
  expect(row("remove")?.textContent).toContain(display.removed);
  expect(row("copy")?.textContent).toContain(display.changed);
  expect(row("copy")?.textContent).toContain("Weekend");
  expect(row("saved")?.textContent).toContain(display.saved);
  expect(row("copy")?.querySelector("a[data-change-id]")?.getAttribute("href")).toBe(
    "/set-menus/menu/daily",
  );
  await expectNoA11yViolations(host);
  await page.screenshot({
    element: host,
    path: `__screenshots__/look/a1515-set-menu-changes-${language}-${theme}-${width}.png`,
  });
});

it("links a removed placement only while its set menu still exists", async () => {
  const p = fixture([
    {
      id: "removed-set",
      kind: "set_menu_removed",
      setMenu: { id: "daily", name: "Daily menu" },
      under: ["Counter drinks", "Counter cold"],
      sectionIds: ["outer", "inner"],
      source: "this_menu",
      targets: { before: [{ kind: "list", sectionIds: ["outer", "inner"] }], after: [] },
    },
  ]);
  const el = await mount(p);
  expect(link(el, "removed-set")).toBeNull();
  el.placeableSetMenus = [{ id: "daily" }];
  await el.updateComplete;
  expect(link(el, "removed-set").getAttribute("href")).toBe("/set-menus/menu/daily");
});

import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentContentLanguages, registerIcons, setContentLanguages } from "@waitron/ui";
import type { MenuChange, MenuPreview } from "../api/client.js";
import type { MenuTarget } from "@waitron/catalogue/src/menu-document-types.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import type { MenuDocumentTree } from "./menu-document-tree.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
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

it("uses plain grouped bullets and View to reveal a nested product without taking focus", async () => {
  const el = await mount();
  const node = await tree(el);
  expect(el.shadowRoot!.querySelector('[data-group="details"] h3')!.textContent).toBe(
    "Product details",
  );
  expect(el.shadowRoot!.querySelector('[data-group="prices"]')).toBeNull();
  const view = link(el);
  expect(view).not.toBeNull();
  expect(view.textContent?.trim()).toBe("(View)");
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

it("views a removed product at its surviving parent and leaves deleted products without View", async () => {
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
  const node = await tree(el);
  link(el, "removed").click();
  await expect
    .poll(() => rows(node).querySelector('[aria-current="true"]')?.textContent)
    .toContain("Counter cold");
  expect(node.document).toBe(p.document);
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
    device: "handheld",
    source: "this_menu",
    targets: { before: [], after: [{ kind: "home", device: "handheld", field: "columns" }] },
  };
  const el = await mount(fixture([home]));
  expect(link(el, "home")).not.toBeNull();
  expect(link(el, "home").getAttribute("href")).toBe("/manage/menus/menu/menu-lunch/view/home");
});

it("hides one bullet and its empty group, then restores all without changing publication", async () => {
  const p = fixture();
  const el = await mount(p);
  const show = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="show-all-changes"]',
  );
  expect(show).not.toBeNull();
  expect(show!.disabled).toBe(true);
  const hide = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-hide-change="stable"]');
  expect(hide).not.toBeNull();
  hide!.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-group="details"]')).toBeNull();
  expect(show!.disabled).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(show);
  expect(el.shadowRoot!.querySelector('[data-test="hidden-count"]')!.textContent?.trim()).toBe(
    "1 hidden",
  );
  const seen: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => seen.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="publish"]')!.click();
  expect(seen).toEqual([{ hash: "proposed" }]);
  expect(p.changes).toHaveLength(1);
  show!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-group="details"]')).not.toBeNull();
  expect(show!.disabled).toBe(true);
});

it("keeps a surviving hidden change across refresh while showing new changes, then forgets it for another menu", async () => {
  const el = await mount();
  const hide = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-hide-change="stable"]');
  expect(hide).not.toBeNull();
  hide!.click();
  await el.updateComplete;
  const p = fixture([change(), { ...change(), id: "new-change" }]);
  el.preview = p;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-change-row="new-change"]')).not.toBeNull();
  p.document.menuId = "other";
  el.preview = { ...p };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).not.toBeNull();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      '[data-test="show-all-changes"]',
    )!.disabled,
  ).toBe(true);
});

it("rejects a retired Hide link after an envelope replacement", async () => {
  const el = await mount();
  const old = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-hide-change="stable"]');
  expect(old).not.toBeNull();
  el.preview = fixture();
  await el.updateComplete;
  old!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-change-row="stable"]')).not.toBeNull();
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
  const unit = { abbreviation: { en: "g" }, precision: 0 };
  const kinds: Record<MenuChange["kind"], MenuChange> = {
    menu_renamed: { ...shared, id: "rename", kind: "menu_renamed", from: "Old", to: "New" },
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
    order_changed: { ...shared, id: "order", kind: "order_changed", listSectionId: null, list: [] },
    home_shortcuts_changed: { ...shared, id: "shortcuts", kind: "home_shortcuts_changed" },
    home_display_changed: {
      ...shared,
      id: "home-display",
      kind: "home_display_changed",
      device: "handheld",
    },
  };
  const el = await mount(fixture(Object.values(kinds).reverse()));
  const groups = [...el.shadowRoot!.querySelectorAll("[data-group]")];
  expect(
    groups.map((group) => [
      group.querySelector("h3")!.textContent,
      [...group.querySelectorAll("li")].map((row) => row.getAttribute("data-change-row")),
    ]),
  ).toEqual([
    ["Menu", ["rename"]],
    ["Sections added", ["section-add"]],
    ["Sections removed", ["section-remove"]],
    ["Sections changed", ["section-change"]],
    ["Products added", ["product-add"]],
    ["Products removed", ["product-delete", "product-remove"]],
    ["Products moved", ["product-move"]],
    ["Prices", ["price"]],
    ["Product details", ["extra-max", "extra-portion", "extra-unit", "details"]],
    ["Order", ["order"]],
    ["Home page", ["home-display", "shortcuts"]],
  ]);
});

it.each(["light", "dark"] as const)(
  "keeps View, hidden changes and restoration accessible in Spanish (%s)",
  async (theme) => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<MenuPreviewPanel>(
      "dashboard-menu-preview",
      { preview: fixture(), menuName: "Almuerzo" },
      theme,
    );
    expect(el.shadowRoot!.querySelector('[data-group="details"] h3')!.textContent).toBe(
      "Detalles de productos",
    );
    expect(link(el).textContent?.trim()).toBe("(Ver)");
    await expectNoA11yViolations(host);
    const hide = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-hide-change="stable"]')!;
    expect(hide.textContent?.trim()).toBe("Ocultar");
    hide.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-test="hidden-count"]')!.textContent?.trim()).toBe(
      "1 oculto",
    );
    await expectNoA11yViolations(host);
    const show = el.shadowRoot!.querySelector<HTMLElement>('[data-test="show-all-changes"]')!;
    expect(show.textContent?.trim()).toBe("Mostrar todos los cambios");
    show.click();
    await el.updateComplete;
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

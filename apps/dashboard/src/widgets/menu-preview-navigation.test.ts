import { afterEach, beforeEach, expect, it, onTestFinished } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { setContentLanguages } from "@waitron/ui";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import type {
  MenuChange,
  MenuDocument,
  MenuTarget,
} from "@waitron/catalogue/src/menu-document-types.js";
import { setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import type { MenuDocumentTree } from "./menu-document-tree.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

beforeEach(() => {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});
function fixture() {
  const doc = menuDocument(
    [
      documentSection("outer", "Counter drinks", [
        documentSection("inner", "Counter cold", [documentProduct("mi", "dish")]),
      ]),
    ],
    { dish: "Counter lemonade" },
    "Frozen title",
  );
  Object.assign(doc.offers.mi!, {
    customerName: { en: "House lemonade", es: "Limonada" },
    description: { en: "Fresh lemon", es: "Limón fresco" },
    unitPrice: "3.50",
    grossPrice: "99.00",
    image: "lemon slice.jpg",
    allergens: { milk: { presence: "may_contain", source: "cream" } },
  });
  return doc;
}
const target: MenuTarget = {
  kind: "product",
  sectionIds: ["outer", "inner"],
  menuItemId: "mi",
  productId: "dish",
  field: { kind: "description", language: "en" },
};
function change(after: MenuTarget[] = [target], before: MenuTarget[] = [target]): MenuChange {
  return {
    id: "stable-row",
    kind: "product_changed",
    productId: "dish",
    name: "Counter lemonade",
    fields: ["description"],
    source: "shared_product",
    targets: { before, after },
  };
}
async function mount(
  changes: MenuChange[] = [],
  doc = fixture(),
  live: MenuDocument | null = fixture(),
) {
  return (
    await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
      menuName: "Working title",
      preview: {
        document: doc,
        live: live === null ? null : { versionId: "v2", document: live },
        changes,
        hash: "proposed-hash",
        warnings: [],
        clashes: [],
        status: {
          state: "changed",
          version: 2,
          publishedAt: "2026-10-01T10:00:00Z",
          hash: "old-hash",
          clashes: 0,
        },
      },
    })
  ).el;
}
function q<T extends HTMLElement = HTMLElement>(el: MenuPreviewPanel, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}
async function renderer(el: MenuPreviewPanel) {
  const view = q<MenuDocumentTree>(el, "dashboard-menu-document-tree");
  expect(view).not.toBeNull();
  await view!.updateComplete;
  await view!.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  return view!;
}
function rows(view: MenuDocumentTree) {
  return view.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
}
function destination(view: MenuDocumentTree) {
  return rows(view).querySelector<HTMLElement>('[aria-current="true"]');
}
function viewLink(el: MenuPreviewPanel, id = "stable-row") {
  return q<HTMLAnchorElement>(el, `a[data-change-id="${id}"]`);
}
async function follow(el: MenuPreviewPanel, id = "stable-row") {
  const link = viewLink(el, id)!;
  expect(link).not.toBeNull();
  link.focus();
  await userEvent.keyboard("{Enter}");
  const view = await renderer(el);
  await expect.poll(() => destination(view)).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(link);
  return view;
}
async function select(el: MenuPreviewPanel, value: string) {
  const input = q<WtCombobox>(el, 'wt-combobox[name="menu-preview-view"]');
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("keeps content selection independent of interface locale and falls back when disabled", async () => {
  const el = await mount([change()]);
  const view = await follow(el);
  await select(el, "en");
  await view.updateComplete;
  await view.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  expect(rows(view).textContent).toContain("House lemonade");
  setLocale("es-ES");
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "en" });
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "es" });
});

it("opens a moved product at its newly added occurrence rather than the first retained occurrence", async () => {
  const doc = fixture();
  const retained = { ...target, field: { kind: "summary" as const } };
  const added = { ...retained, sectionIds: ["included", "inner"] };
  const nested = structuredClone(doc.root.members[0]!);
  if (nested.kind !== "section") throw new Error("fixture");
  nested.sectionId = "included";
  doc.root.members.push(nested);
  const moved: MenuChange = {
    id: "move",
    kind: "product_moved",
    productId: "dish",
    name: "Counter lemonade",
    from: [["Drinks"]],
    to: [["Drinks"], ["Other"]],
    source: "this_menu",
    targets: { before: [retained], after: [retained, added] },
  };
  const el = await mount([moved], doc);
  const view = await follow(el, "move");
  expect(destination(view)!.closest("tr")!.dataset.rowKey).toBe("included/inner/mi");
});

it("views a renamed menu at its frozen title", async () => {
  const renamed: MenuChange = {
    id: "title",
    kind: "menu_renamed",
    from: "Before",
    to: "Frozen title",
    source: "this_menu",
    targets: { before: [], after: [] },
  };
  const el = await mount([renamed]);
  const view = await follow(el, "title");
  expect(destination(view)!.closest("tr")!.dataset.rowKey).toBe("root");
  expect(destination(view)!.textContent).toBe("Frozen title");
});

it("ignores an old View link after its snapshot has been replaced", async () => {
  const el = await mount([change()]);
  const old = viewLink(el)!;
  el.preview = {
    ...el.preview!,
    document: menuDocument([], {}, "New snapshot"),
    changes: [],
    hash: "new",
  };
  await el.updateComplete;
  old.click();
  await el.updateComplete;
  const view = await renderer(el);
  expect(destination(view)).toBeNull();
  expect(q(el, '[data-test="navigation-unavailable"]')).toBeNull();
  expect(view.view).toEqual({ kind: "customer", language: "es" });
});

it("offers no View for a destination absent from the frozen proposal", async () => {
  const el = await mount([change([{ ...target, sectionIds: ["missing"] }], [])]);
  expect(viewLink(el)).toBeNull();
  expect(q(el, '[data-change-row="stable-row"]')!.textContent).toContain("description");
});

it("views a removed section at its surviving parent without reading the before tree", async () => {
  const removed: MenuChange = {
    id: "removed",
    kind: "section_removed",
    sectionId: "gone",
    parentSectionIds: ["outer"],
    name: "Gone",
    under: ["Drinks"],
    source: "this_menu",
    targets: {
      before: [{ kind: "section", sectionIds: ["outer", "gone"], field: { kind: "summary" } }],
      after: [],
    },
  };
  const doc = fixture();
  const el = await mount([removed], doc);
  const view = await follow(el, "removed");
  expect(destination(view)!.closest("tr")!.dataset.rowKey).toBe("outer");
  expect(view.document).toBe(doc);
});

it("views field changes at the product row, including retired variants and modifier fields", async () => {
  const fields: MenuTarget[] = [
    target,
    { ...target, variantId: "retired", field: { kind: "image" } },
    { ...target, listId: "retired-list", extraProductId: "lemon", field: { kind: "unit" } },
  ];
  const el = await mount([change(fields, [])]);
  const view = await follow(el);
  expect(destination(view)!.closest("tr")!.dataset.rowKey).toBe("outer/inner/mi");
  expect(el.shadowRoot!.querySelectorAll('a[data-change-id="stable-row"]')).toHaveLength(1);
});

it("uses the first named product occurrence when it appears twice", async () => {
  const doc = fixture();
  const second = { ...target, sectionIds: [] };
  doc.root.members.push(documentProduct("mi", "dish"));
  const el = await mount([change([target, second], [])], doc);
  const view = await follow(el);
  expect(destination(view)!.closest("tr")!.dataset.rowKey).toBe("outer/inner/mi");
});

it("publishes the proposed hash after viewing the surviving place of a removed item", async () => {
  const removed: MenuChange = {
    id: "removed",
    kind: "product_removed",
    productId: "dish",
    name: "Lemonade",
    under: [],
    source: "this_menu",
    targets: { before: [{ ...target, sectionIds: [] }], after: [] },
  };
  const el = await mount([removed], menuDocument([], {}, "Proposed title"));
  await follow(el, "removed");
  const seen: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => seen.push((event as CustomEvent).detail));
  q(el, '[data-test="publish"]')!.click();
  expect(seen).toEqual([{ hash: "proposed-hash" }]);
});

it("clears navigation and language choices when a different menu replaces the envelope", async () => {
  const el = await mount([change()]);
  const view = await follow(el);
  await select(el, "internal");
  const other = fixture();
  other.menuId = "other-menu";
  other.menuName = "Other frozen menu";
  el.preview = { ...el.preview!, document: other, changes: [], hash: "other" };
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "es" });
  expect(destination(view)).toBeNull();
});

it("keeps a user-selected view and keyboard focus while a fresh envelope resets the tree", async () => {
  const el = await mount([change()]);
  const view = await follow(el);
  await select(el, "internal");
  const publish = q(el, '[data-test="publish"]')!;
  publish.focus();
  const doc = fixture();
  doc.menuName = "New frozen title";
  el.preview = { ...el.preview!, document: doc, changes: [change()], hash: "replacement-hash" };
  await el.updateComplete;
  await view.updateComplete;
  await view.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  expect(rows(view).textContent).toContain("New frozen title");
  expect(view.view).toEqual({ kind: "internal" });
  expect(rows(view).querySelector('tr[data-row-key="outer/inner/mi"]')).toBeNull();
  expect(destination(view)).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(publish);
});

it.each(["reduce", "no-preference"] as const)(
  "reveals and paints the changed row with motion %s",
  async (motion) => {
    await commands.emulateReducedMotion(motion);
    onTestFinished(() => commands.emulateReducedMotion(null));
    const el = await mount([change()]);
    el.style.setProperty("--wt-focus-ring", "2px solid rgb(123, 45, 67)");
    const view = await follow(el);
    const node = destination(view)!;
    expect(getComputedStyle(node).outlineColor).toBe("rgb(123, 45, 67)");
    expect(getComputedStyle(node).outlineStyle).toBe("solid");
    const pane = q(el, '[data-test="document-pane"]')!.getBoundingClientRect();
    expect(node.getBoundingClientRect().top).toBeGreaterThanOrEqual(pane.top);
    expect(node.getBoundingClientRect().bottom).toBeLessThanOrEqual(pane.bottom);
  },
);

it.each([390, 1280])("keeps the chosen row inside the Preview pane at %i px", async (width) => {
  await page.viewport(width, 850);
  onTestFinished(() => page.viewport(1280, 900));
  const doc = fixture();
  doc.root.members.unshift(
    ...Array.from({ length: 30 }, (_, i) => documentProduct(`pad-${i}`, `pad-${i}`)),
  );
  for (let i = 0; i < 30; i++)
    doc.offers[`pad-${i}`] = { ...doc.offers.mi!, id: `pad-${i}`, productId: `pad-${i}` };
  const el = await mount([change()], doc);
  const view = await follow(el);
  const node = destination(view)!;
  const pane = q(el, '[data-test="document-pane"]')!;
  expect(node.getBoundingClientRect().top).toBeGreaterThanOrEqual(pane.getBoundingClientRect().top);
  expect(node.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    pane.getBoundingClientRect().bottom,
  );
  expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);
});

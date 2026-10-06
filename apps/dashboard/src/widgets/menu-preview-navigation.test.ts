import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setContentLanguages } from "@waitron/ui";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import type {
  MenuChange,
  MenuDocument,
  MenuTarget,
} from "@waitron/catalogue/src/menu-document-types.js";
import { menuTargetKey } from "@waitron/catalogue/src/menu-navigation.js";
import { setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import type { CustomerMenu } from "./customer-menu.js";
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
  const view = q<CustomerMenu>(el, "dashboard-customer-menu");
  expect(view).not.toBeNull();
  await view!.updateComplete;
  return view!;
}
function destination(view: CustomerMenu, t: MenuTarget) {
  return [...view.shadowRoot!.querySelectorAll<HTMLElement>("[data-change-target]")]
    .filter((n) => n.dataset.changeTarget === menuTargetKey(t))
    .at(-1)!;
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

it("navigates to the exact translated field with frozen content and returns focus to its row", async () => {
  const el = await mount([change()]);
  const view = await renderer(el);
  expect(view.view).toEqual({ kind: "customer", language: "es" });
  const row = q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]');
  expect(row).not.toBeNull();
  row!.click();
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(target));
  expect(view.view).toEqual({ kind: "customer", language: "en" });
  const node = destination(view, target);
  expect(node.textContent).toContain("Fresh lemon");
  expect(node.textContent).toContain("Changed");
  expect(view.shadowRoot!.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2);
  expect(view.shadowRoot!.textContent).toContain("3.50");
  expect(view.shadowRoot!.textContent).not.toContain("99.00");
  expect(view.shadowRoot!.textContent).toContain("May contain Milk (cream)");
  expect(view.shadowRoot!.querySelector<HTMLImageElement>("img")!.getAttribute("src")).toBe(
    "/media/lemon%20slice.jpg",
  );
  q<HTMLButtonElement>(el, '[data-test="return-change"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(row);
});

it.each(["{Enter}", " "])("activates its change using native keyboard %s", async (key) => {
  const el = await mount([change()]);
  const row = q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]');
  expect(row).not.toBeNull();
  row!.focus();
  await userEvent.keyboard(key);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(target));
});

it("keeps content selection independent of interface locale and falls back when disabled", async () => {
  const el = await mount();
  const view = await renderer(el);
  await select(el, "en");
  expect(view.view).toEqual({ kind: "customer", language: "en" });
  setLocale("es-ES");
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "en" });
  expect(q<WtCombobox>(el, "wt-combobox")!.label).toBe("Vista de contenido");
  await select(el, "internal");
  expect(view.view).toEqual({ kind: "internal" });
  await select(el, "en");
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "es" });
  expect(q<WtCombobox>(el, "wt-combobox")!.options.map((o) => o.value)).toEqual(["internal", "es"]);
});

it("opens a removed product from frozen live and publishes the proposed hash", async () => {
  const before = fixture();
  before.offers.mi!.unitPrice = "2.00";
  const after = menuDocument([], {}, "Proposed title");
  const removed: MenuChange = {
    id: "removed",
    kind: "product_removed",
    productId: "dish",
    name: "Counter lemonade",
    under: ["Drinks"],
    source: "this_menu",
    targets: { before: [{ ...target, field: { kind: "price" } }], after: [] },
  };
  const el = await mount([removed], after, before);
  const events: unknown[] = [];
  el.addEventListener("wt-menu-publish", (e) => events.push((e as CustomEvent).detail));
  q<HTMLButtonElement>(el, 'button[data-change-id="removed"]')!.click();
  const view = await renderer(el);
  await expect.poll(() => view.shadowRoot!.textContent).toContain("2.00");
  expect(q(el, '[data-test="before"]')!.textContent).toContain("Removed");
  expect(q(el, '[data-test="before"]')!.textContent).toContain("2");
  q(el, '[data-test="publish"]')!.click();
  expect(events).toEqual([{ hash: "proposed-hash" }]);
  q<HTMLButtonElement>(el, '[data-test="return-proposed"]')!.click();
  await el.updateComplete;
  await view.updateComplete;
  expect(view.document).toBe(after);
  expect(view.shadowRoot!.textContent).not.toContain("Limonada");
});

it("exposes separately labelled actual field controls and selects staff inspection for raw overrides", async () => {
  const override: MenuTarget = { ...target, field: { kind: "override" } };
  const el = await mount([change([target, override])]);
  const controls = [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button[data-target-key]"),
  ];
  expect(controls.length).toBeGreaterThanOrEqual(2);
  const button = controls.find((b) => b.dataset.targetKey === menuTargetKey(override))!;
  expect(button.textContent).toContain("Price override");
  button.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(override));
  expect(view.view).toEqual({ kind: "internal" });
  expect(destination(view, override).textContent).toContain("Staff inspection");
  expect(destination(view, override).textContent).toContain("99.00");
});

it.each(["columns", "tiles", "order", "shortcuts"] as const)(
  "focuses frozen Home %s on the named device without changing publication",
  async (field) => {
    const home: MenuTarget = { kind: "home", device: "till", field };
    const row: MenuChange =
      field === "shortcuts"
        ? {
            id: "home",
            kind: "home_shortcuts_changed",
            source: "this_menu",
            targets: { before: [home], after: [home] },
          }
        : {
            id: "home",
            kind: "home_display_changed",
            device: "till",
            source: "this_menu",
            targets: { before: [home], after: [home] },
          };
    const doc = fixture();
    doc.home.till.columns = 7;
    const el = await mount([row], doc);
    q<HTMLButtonElement>(el, 'button[data-change-id="home"]')!.click();
    await expect
      .poll(() => el.shadowRoot!.activeElement?.getAttribute("data-change-target"))
      .toBe(menuTargetKey(home));
    const summary = q(el, '[data-test="home-target"]')!;
    expect(summary.textContent).toContain("Till");
    expect(summary.textContent).toContain("Changed");
    const widget = q<HTMLElement & { document: MenuDocument; device: string }>(
      el,
      "dashboard-device-home-preview",
    )!;
    expect(widget.document).toBe(doc);
    expect(widget.device).toBe("till");
    if (field === "columns") expect(summary.textContent).toContain("7");
    expect(el.preview!.hash).toBe("proposed-hash");
  },
);

it("focuses the frozen title and labels a regular before inspection without claiming removal", async () => {
  const title: MenuTarget = { kind: "title", menuId: "menu-lunch" };
  const el = await mount([
    {
      id: "title",
      kind: "menu_renamed",
      from: "Old title",
      to: "Frozen title",
      source: "this_menu",
      targets: { before: [title], after: [title] },
    },
  ]);
  q<HTMLButtonElement>(el, 'button[data-change-id="title"]')!.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(title));
  expect(destination(view, title).textContent).toContain("Frozen title");
  expect(destination(view, title).textContent).not.toContain("Working title");
  q<HTMLButtonElement>(el, 'button[data-side="before"]')!.click();
  await el.updateComplete;
  expect(q(el, '[data-test="before"]')!.textContent).toContain("Before");
  expect(q(el, '[data-test="before"]')!.textContent).not.toContain("Removed");
});

it("opens a moved product at its newly added occurrence rather than the first retained occurrence", async () => {
  const doc = fixture();
  const retained = {
    ...target,
    sectionIds: ["outer", "inner"],
    field: { kind: "summary" as const },
  };
  const added = { ...retained, sectionIds: ["included", "inner"] };
  const nested = structuredClone(doc.root.members[0]!);
  if (nested.kind === "section") nested.sectionId = "included";
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
  q<HTMLButtonElement>(el, 'button[data-change-id="move"]')!.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(added));
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-side="after"]')].map(
      (b) => b.dataset.targetKey,
    ),
  ).toEqual([menuTargetKey(retained), menuTargetKey(added)]);
});

it("ignores an old row's click after its snapshot has been replaced", async () => {
  const el = await mount([change()]);
  const old = q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!;
  el.preview = {
    ...el.preview!,
    document: menuDocument([], {}, "New snapshot"),
    changes: [],
    hash: "new-hash",
  };
  await el.updateComplete;
  old.click();
  await el.updateComplete;
  const view = await renderer(el);
  expect(view.view).toEqual({ kind: "customer", language: "es" });
  expect(q(el, '[data-test="return-change"]')).toBeNull();
  expect(view.shadowRoot!.textContent).not.toContain("Target unavailable");
});

it("cross-links a relocated section's exact old and new places", async () => {
  const oldSection: MenuTarget = {
    kind: "section",
    sectionIds: ["outer", "inner"],
    field: { kind: "summary" },
  };
  const newSection: MenuTarget = { ...oldSection, sectionIds: ["included", "inner"] };
  const old = fixture(),
    doc = fixture();
  const root = doc.root.members[0]!;
  if (root.kind === "section") root.sectionId = "included";
  const removed: MenuChange = {
    id: "old-section",
    kind: "section_removed",
    sectionId: "inner",
    parentSectionIds: ["outer"],
    name: "Counter cold",
    under: ["Counter drinks"],
    source: "this_menu",
    targets: { before: [oldSection], after: [] },
  };
  const added: MenuChange = {
    id: "new-section",
    kind: "section_added",
    sectionId: "inner",
    parentSectionIds: ["included"],
    name: "Counter cold",
    under: ["Counter drinks"],
    source: "this_menu",
    targets: { before: [], after: [newSection] },
  };
  const el = await mount([removed, added], doc, old);
  const row = q<HTMLButtonElement>(el, 'button[data-change-id="old-section"]')!.closest("li")!;
  const link = row.querySelector<HTMLButtonElement>('button[data-side="after"]');
  expect(link).not.toBeNull();
  expect(link!.dataset.targetKey).toBe(menuTargetKey(newSection));
  link!.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(newSection));
});

it("keeps the exact destination inside the preview scroll pane at phone and desktop widths", async () => {
  for (const width of [390, 1280]) {
    const doc = fixture();
    const section = doc.root.members[0]!;
    if (section.kind === "section")
      section.members.unshift(
        ...Array.from({ length: 25 }, (_, i) => documentSection(`filler-${i}`, `Filler ${i}`, [])),
      );
    const el = await mount([change()], doc);
    el.style.width = `${width}px`;
    el.style.maxWidth = "100%";
    await el.updateComplete;
    q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!.click();
    const view = await renderer(el);
    await expect
      .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
      .toBe(menuTargetKey(target));
    const pane = q(el, '[data-test="document-pane"]')!.getBoundingClientRect();
    const node = destination(view, target).getBoundingClientRect();
    expect(node.top).toBeGreaterThanOrEqual(pane.top);
    expect(node.bottom).toBeLessThanOrEqual(pane.bottom);
    const back = q(el, '[data-test="return-change"]')!.getBoundingClientRect();
    expect(back.top).toBeGreaterThanOrEqual(pane.top);
    expect(back.bottom).toBeLessThanOrEqual(pane.bottom);
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    cleanupWidgets();
  }
});

it("names linked targets with frozen places and fields instead of exposing ID paths", async () => {
  const el = await mount([change()]);
  const buttons = [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button[data-target-key]"),
  ];
  expect(buttons.map((b) => b.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Proposed · Description · en · Counter drinks / Counter cold",
    "Before · Description · en · Counter drinks / Counter cold",
  ]);
  expect(q(el, '[data-test="target-count"]')!.textContent).toContain("2 places or fields");
});

it("labels a deleted variant as removed when another changed field remains in proposed", async () => {
  const before = fixture();
  const offer = before.offers.mi!;
  const variant = {
    id: "gone",
    name: "Counter small",
    kitchenName: "SMALL",
    customerName: { en: "Small" },
    unitPrice: "1.25",
    menuPrice: null,
    pricingUnit: "each" as const,
    image: "old.jpg",
    unit: offer.unit,
    vatClass: offer.vatClass,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
  };
  offer.variants = [variant];
  const deleted: MenuTarget = { ...target, variantId: "gone", field: { kind: "summary" } };
  const el = await mount([change([target], [target, deleted])], fixture(), before);
  const button = [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-side="before"]'),
  ].find((b) => b.dataset.targetKey === menuTargetKey(deleted))!;
  button.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(deleted));
  expect(q(el, '[data-test="before"]')!.textContent).toContain("Removed");
  expect(destination(view, deleted).textContent).toContain("Counter small");
  expect(destination(view, deleted).textContent).toContain("Missing translation: es");
  expect(view.shadowRoot!.textContent).toContain("1.25");
});

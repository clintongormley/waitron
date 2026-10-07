import { afterEach, beforeEach, expect, it, onTestFinished } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { setContentLanguages } from "@waitron/ui";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import type {
  DocumentMember,
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

it("focuses an announced fallback when the change's saved target cannot be resolved", async () => {
  const missing: MenuTarget = { ...target, sectionIds: ["missing"] };
  const el = await mount([change([missing], [])]);
  q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!.click();
  await expect
    .poll(() => el.shadowRoot!.activeElement?.textContent)
    .toContain("This change target is unavailable.");
  const message = el.shadowRoot!.activeElement!;
  expect(message.getAttribute("role")).toBe("status");
  expect(message.getAttribute("tabindex")).toBe("-1");
  expect((await renderer(el)).shadowRoot!.querySelector('[role="status"]')).toBeNull();
  q<HTMLButtonElement>(el, '[data-test="return-change"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement?.getAttribute("data-change-id")).toBe("stable-row");
});

it("labels staff and kitchen name targets in the interface language", async () => {
  setLocale("es-ES");
  const staff: MenuTarget = { ...target, field: { kind: "name", audience: "staff" } };
  const kitchen: MenuTarget = { ...target, field: { kind: "name", audience: "kitchen" } };
  const el = await mount([change([staff, kitchen], [])]);
  const controls = [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button[data-target-key]"),
  ];
  expect(controls[0]!.textContent).toContain("Nombre interno");
  expect(controls[1]!.textContent).toContain("Nombre de cocina");
  expect(controls.map((b) => b.textContent).join(" ")).not.toMatch(/staff|kitchen/);
});

it.each([
  ["columns", "Columnas"],
  ["tiles", "Los botones muestran"],
  ["order", "Después de la búsqueda"],
  ["shortcuts", "Accesos directos"],
] as const)(
  "labels the Home %s target and links to the same menu's Home settings",
  async (field, words) => {
    setLocale("es-ES");
    const home: MenuTarget = { kind: "home", device: "till", field };
    const row: MenuChange =
      field === "shortcuts"
        ? {
            id: "home",
            kind: "home_shortcuts_changed",
            source: "this_menu",
            targets: { before: [], after: [home] },
          }
        : {
            id: "home",
            kind: "home_display_changed",
            device: "till",
            source: "this_menu",
            targets: { before: [], after: [home] },
          };
    const doc = fixture();
    doc.menuId = "carta / lunch";
    const el = await mount([row], doc);
    el.style.setProperty("--wt-color-primary-text", "rgb(123, 45, 67)");
    expect(q(el, "button[data-target-key]")!.textContent).toContain(words);
    q<HTMLButtonElement>(el, 'button[data-change-id="home"]')!.click();
    await expect
      .poll(() => el.shadowRoot!.activeElement?.getAttribute("data-change-target"))
      .toBe(menuTargetKey(home));
    const link = q<HTMLAnchorElement>(el, '[data-test="home-settings"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/manage/menus/menu/carta%20%2F%20lunch/view/home");
    expect(link!.textContent).toContain("Página de inicio");
    expect(getComputedStyle(link!).color).toBe("rgb(123, 45, 67)");
    expect(el.preview!.document).toBe(doc);
    expect(el.preview!.hash).toBe("proposed-hash");
  },
);

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

function modifiers(doc: MenuDocument) {
  const offer = doc.offers.mi!;
  offer.offeredModifiers = [
    {
      kind: "options",
      id: "cook",
      name: "Counter cooking",
      customerName: { en: "Cooking", es: "Cocción" },
      kitchenName: "COOK",
      defaultLabelId: "rare",
      labels: [
        {
          id: "rare",
          name: "Counter rare",
          customerName: { en: "Rare", es: "Poco hecho" },
          kitchenName: "RARE",
        },
      ],
    },
    {
      kind: "extras",
      id: "garnish",
      name: "Counter garnish",
      customerName: { en: "Garnish", es: "Guarnición" },
      kitchenName: "GARNISH",
      minPicks: 0,
      maxPicks: 2,
      items: [
        {
          productId: "lemon",
          name: "Counter lemon",
          customerName: { en: "Lemon", es: "Limón" },
          kitchenName: "LEMON",
          image: "old lemon.jpg",
          price: "1.75",
          vatClass: offer.vatClass,
          unit: offer.unit,
          portion: "0.250",
          maxQuantity: null,
          preselected: false,
          addAllergens: null,
          suitableFor: [],
        },
      ],
    },
  ];
  return doc;
}

it("opens a removed empty section in live and keeps the proposed hierarchy available", async () => {
  const before = fixture();
  before.root.members.push(documentSection("gone-empty", "Empty before", []));
  const empty: MenuTarget = {
    kind: "section",
    sectionIds: ["gone-empty"],
    field: { kind: "summary" },
  };
  const el = await mount(
    [
      {
        id: "empty",
        kind: "section_removed",
        sectionId: "gone-empty",
        parentSectionIds: [],
        name: "Empty before",
        under: [],
        source: "this_menu",
        targets: { before: [empty], after: [] },
      },
    ],
    fixture(),
    before,
  );
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="empty"]')!);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(empty));
  expect(view.document).toBe(before);
  expect(view.shadowRoot!.textContent).toContain("Empty section");
  expect(q(el, '[data-test="before"]')!.textContent).toContain("Removed");
  await userEvent.click(q<HTMLButtonElement>(el, '[data-test="return-proposed"]')!);
  await el.updateComplete;
  await view.updateComplete;
  expect(view.shadowRoot!.textContent).not.toContain("Empty before");
});

it.each(["extra", "label", "list"] as const)(
  "reveals a removed %s from its actual live parent without fabricating a dish",
  async (subject) => {
    const before = modifiers(fixture());
    const nested: MenuTarget = {
      ...target,
      field: { kind: "summary" },
      listId: subject === "extra" ? "garnish" : "cook",
      ...(subject === "extra"
        ? { extraProductId: "lemon" }
        : subject === "label"
          ? { optionLabelId: "rare" }
          : {}),
    };
    const row: MenuChange =
      subject === "extra"
        ? {
            id: "deleted",
            kind: "product_deleted",
            productId: "lemon",
            name: "Counter lemon",
            source: "shared_product",
            targets: { before: [nested], after: [] },
          }
        : {
            id: "deleted",
            kind: "product_changed",
            productId: "dish",
            name: "Counter lemonade",
            fields: ["options"],
            source: "shared_product",
            targets: { before: [nested], after: [] },
          };
    const el = await mount([row], fixture(), before);
    await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="deleted"]')!);
    const view = await renderer(el);
    await expect
      .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
      .toBe(menuTargetKey(nested));
    expect(view.document).toBe(before);
    expect(destination(view, nested).textContent).toContain(
      subject === "extra" ? "Limón" : subject === "label" ? "Poco hecho" : "Cocción",
    );
    expect(q(el, '[data-test="before"]')!.textContent).toContain("Removed");
    if (subject === "extra") {
      expect(view.shadowRoot!.textContent).toContain("1.75");
      expect(
        view.shadowRoot!.querySelector<HTMLImageElement>('img[src="/media/old%20lemon.jpg"]'),
      ).not.toBeNull();
      expect(Object.values(before.offers).map((offer) => offer.productId)).toEqual(["dish"]);
    }
  },
);

it("reveals a removed description translation as a named empty value and inspects disabled languages explicitly", async () => {
  const doc = fixture();
  doc.offers.mi!.description = { es: "Limón fresco" };
  const el = await mount([change()], doc);
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(target));
  expect(destination(view, target).textContent).toContain("Description");
  expect(destination(view, target).textContent).toContain("No saved value");
  const stored: MenuTarget = {
    ...target,
    field: { kind: "name", audience: "customer", language: "de" },
  };
  doc.offers.mi!.customerName = { es: "Limonada", de: "Zitronenwasser" };
  el.preview = { ...el.preview!, document: structuredClone(doc), changes: [change([stored], [])] };
  await el.updateComplete;
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(stored));
  expect(view.view).toEqual({ kind: "internal" });
  expect(destination(view, stored).textContent).toContain("Saved translation");
  expect(destination(view, stored).textContent).toContain("Zitronenwasser");
  expect(destination(view, stored).querySelector('[lang="de"]')!.textContent).toContain(
    "Zitronenwasser",
  );
});

it("chooses content language with the real pointer-operated selector without changing the snapshot", async () => {
  const el = await mount([change()]);
  const snapshot = structuredClone(el.preview);
  const view = await renderer(el);
  const combo = q<WtCombobox>(el, "wt-combobox")!;
  await combo.updateComplete;
  await userEvent.click(combo.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await expect
    .poll(() => combo.shadowRoot!.querySelector("#panel")!.matches(":popover-open"))
    .toBe(true);
  const english = [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (n) => n.textContent!.trim() === "English",
  )!;
  await userEvent.click(english);
  await el.updateComplete;
  await view.updateComplete;
  expect(view.view).toEqual({ kind: "customer", language: "en" });
  expect(view.shadowRoot!.textContent).not.toContain("Counter lemonade");
  expect(el.preview).toEqual(snapshot);
});

it.each([
  "product_added",
  "product_removed",
  "product_deleted",
  "product_moved",
  "price_changed",
  "product_changed",
  "extra_unit_changed",
  "extra_portion_changed",
  "extra_max_quantity_changed",
  "section_added",
  "section_removed",
  "section_changed",
  "order_changed",
  "home_shortcuts_changed",
  "home_display_changed",
  "menu_renamed",
] as const)("activates the actual default destination for %s", async (kind) => {
  const doc = modifiers(fixture());
  const summary: MenuTarget = { ...target, field: { kind: "summary" } };
  const section: MenuTarget = {
    kind: "section",
    sectionIds: ["outer", "inner"],
    field: { kind: "summary" },
  };
  const extra = { ...summary, listId: "garnish", extraProductId: "lemon" };
  const home: MenuTarget = {
    kind: "home",
    device: "handheld",
    field: kind === "home_shortcuts_changed" ? "shortcuts" : "columns",
  };
  const expected: MenuTarget =
    kind === "price_changed"
      ? { ...summary, field: { kind: "price" } }
      : kind === "product_changed"
        ? target
        : kind === "extra_unit_changed"
          ? { ...extra, field: { kind: "unit" } }
          : kind === "extra_portion_changed"
            ? { ...extra, field: { kind: "portion" } }
            : kind === "extra_max_quantity_changed"
              ? { ...extra, field: { kind: "maxQuantity" } }
              : kind.startsWith("section_")
                ? section
                : kind === "order_changed"
                  ? { kind: "list", sectionIds: ["outer", "inner"] }
                  : kind.startsWith("home_")
                    ? home
                    : kind === "menu_renamed"
                      ? { kind: "title", menuId: "menu-lunch" }
                      : summary;
  const source = "this_menu" as const;
  const body = (() => {
    switch (kind) {
      case "product_added":
      case "product_removed":
        return {
          kind,
          productId: "dish",
          name: "Counter lemonade",
          under: ["Counter drinks", "Counter cold"],
          source,
        };
      case "product_deleted":
        return { kind, productId: "dish", name: "Counter lemonade", source };
      case "product_moved":
        return {
          kind,
          productId: "dish",
          name: "Counter lemonade",
          from: [["Old"]],
          to: [["New"]],
          source,
        };
      case "price_changed":
        return {
          kind,
          productId: "dish",
          name: "Counter lemonade",
          from: "2.00",
          to: "3.50",
          source,
        };
      case "product_changed":
        return {
          kind,
          productId: "dish",
          name: "Counter lemonade",
          fields: ["description" as const],
          source,
        };
      case "extra_unit_changed":
        return {
          kind,
          productId: "lemon",
          name: "Counter lemon",
          listId: "garnish",
          listName: "Counter garnish",
          from: { abbreviation: { en: "g" }, precision: 0 },
          to: { abbreviation: { en: "ea" }, precision: 0 },
          source,
        };
      case "extra_portion_changed":
        return {
          kind,
          productId: "lemon",
          name: "Counter lemon",
          listId: "garnish",
          listName: "Counter garnish",
          from: { portion: "0.100", abbreviation: { en: "ea" } },
          to: { portion: "0.250", abbreviation: { en: "ea" } },
          source,
        };
      case "extra_max_quantity_changed":
        return {
          kind,
          productId: "lemon",
          name: "Counter lemon",
          listId: "garnish",
          listName: "Counter garnish",
          from: 1,
          to: null,
          source,
        };
      case "section_added":
      case "section_removed":
        return {
          kind,
          sectionId: "inner",
          parentSectionIds: ["outer"],
          name: "Counter cold",
          under: ["Counter drinks"],
          source,
        };
      case "section_changed":
        return {
          kind,
          sectionId: "inner",
          name: "Counter cold",
          fields: ["names" as const],
          source,
        };
      case "order_changed":
        return { kind, listSectionId: "inner", list: ["Counter drinks", "Counter cold"], source };
      case "home_shortcuts_changed":
        return { kind, source };
      case "home_display_changed":
        return { kind, device: "handheld" as const, source };
      case "menu_renamed":
        return { kind, from: "Old", to: "Frozen title", source };
    }
  })();
  const removed = ["product_removed", "product_deleted", "section_removed"].includes(kind);
  const row: MenuChange = {
    ...body,
    id: `actual-${kind}`,
    targets: { before: [expected], after: removed ? [] : [expected] },
  };
  const el = await mount([row], doc, structuredClone(doc));
  await userEvent.click(q<HTMLButtonElement>(el, `button[data-change-id="actual-${kind}"]`)!);
  const view = await renderer(el);
  await expect
    .poll(() =>
      (expected.kind === "home" ? el : view).shadowRoot!.activeElement?.getAttribute(
        "data-change-target",
      ),
    )
    .toBe(menuTargetKey(expected));
  expect(el.preview!.hash).toBe("proposed-hash");
  if (removed) expect(q(el, '[data-test="before"]')!.textContent).toContain("Removed");
});

it("keeps a resolvable selected change through a whole-envelope refresh without taking focus", async () => {
  const el = await mount([change()]);
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(target));
  const publish = q<HTMLElement>(el, '[data-test="publish"]')!;
  publish.focus();
  const doc = fixture();
  doc.offers.mi!.description = { en: "Refreshed frozen description", es: "Nueva" };
  el.preview = { ...el.preview!, document: doc, changes: [change()], hash: "replacement-hash" };
  await el.updateComplete;
  await view.updateComplete;
  await expect.poll(() => view.shadowRoot!.textContent).toContain("Refreshed frozen description");
  expect(q(el, 'button[data-change-id="stable-row"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(destination(view, target).textContent).toContain("Changed");
  expect(el.shadowRoot!.activeElement).toBe(publish);
  expect(el.preview!.hash).toBe("replacement-hash");
});

it("announces that a selected change disappeared when a refreshed snapshot no longer contains it", async () => {
  const el = await mount([change()]);
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(target));
  el.preview = { ...el.preview!, document: fixture(), changes: [], hash: "replacement-hash" };
  await el.updateComplete;
  expect(q(el, '[data-test="selection-cleared"]')?.textContent).toContain(
    "The selected change is no longer in this preview.",
  );
  expect(q(el, '[data-test="selection-cleared"]')?.getAttribute("role")).toBe("status");
  expect(q(el, '[data-test="return-change"]')).toBeNull();
  expect(view.shadowRoot!.querySelector("[data-highlighted]")).toBeNull();
});

it("clears language and navigation choices when a different menu replaces the envelope", async () => {
  const el = await mount([change()]);
  await select(el, "internal");
  const other = fixture();
  other.menuId = "other-menu";
  other.menuName = "Other frozen menu";
  el.preview = { ...el.preview!, document: other, changes: [], hash: "other-hash" };
  await el.updateComplete;
  const view = await renderer(el);
  expect(view.view).toEqual({ kind: "customer", language: "es" });
  expect(q(el, '[data-test="selection-cleared"]')).toBeNull();
  expect(q(el, '[data-test="return-change"]')).toBeNull();
});

it("resets local choices and rejects retired controls even when a refreshed envelope reuses its document object", async () => {
  const doc = modifiers(fixture());
  const extraTarget: MenuTarget = {
    ...target,
    listId: "garnish",
    extraProductId: "lemon",
    field: { kind: "summary" },
  };
  const el = await mount([change([extraTarget], [])], doc);
  await userEvent.click(q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(extraTarget));
  const oldStepper = view.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
    'wt-number-stepper[data-list="garnish"]',
  )!;
  oldStepper.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2" } }));
  await view.updateComplete;
  const input = async () => {
    const stepper = view.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>(
      'wt-number-stepper[data-list="garnish"]',
    )!;
    await stepper.updateComplete;
    return stepper.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  };
  expect((await input()).value).toBe("2");
  el.preview = {
    ...el.preview!,
    document: doc,
    hash: "refreshed-hash",
    changes: [change([extraTarget], [])],
  };
  await el.updateComplete;
  await expect.poll(async () => (await input()).value).toBe("0");
  oldStepper.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1" } }));
  await view.updateComplete;
  expect((await input()).value).toBe("0");
  expect(el.preview!.document).toBe(doc);
});

it("reveals the chosen extras list's occurrence and price when two lists contain the same product", async () => {
  const doc = modifiers(fixture());
  const garnish = doc.offers.mi!.offeredModifiers[1]!;
  if (garnish.kind !== "extras") throw new Error("expected extras fixture");
  const second = structuredClone(garnish);
  second.id = "second-list";
  second.items[0]!.price = "2.50";
  doc.offers.mi!.offeredModifiers.push(second);
  const firstTarget: MenuTarget = {
    ...target,
    listId: "garnish",
    extraProductId: "lemon",
    field: { kind: "price" },
  };
  const secondTarget: MenuTarget = { ...firstTarget, listId: "second-list" };
  const el = await mount([change([firstTarget, secondTarget], [])], doc);
  const button = [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[data-side="after"]'),
  ].find((b) => b.dataset.targetKey === menuTargetKey(secondTarget))!;
  await userEvent.click(button);
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(secondTarget));
  expect(destination(view, secondTarget).textContent).toContain("2.50");
  expect(destination(view, firstTarget).textContent).toContain("1.75");
  expect(destination(view, firstTarget).hasAttribute("data-highlighted")).toBe(false);
  expect(destination(view, secondTarget).hasAttribute("data-highlighted")).toBe(true);
});

it.each(["reduce", "no-preference"] as const)(
  "paints the focused changed value from its token and reveals it with motion %s",
  async (motion) => {
    await commands.emulateReducedMotion(motion);
    onTestFinished(() => commands.emulateReducedMotion(null));
    const el = await mount([change()]);
    el.style.setProperty("--wt-color-primary", "rgb(123, 45, 67)");
    const row = q<HTMLButtonElement>(el, 'button[data-change-id="stable-row"]')!;
    row.focus();
    await userEvent.keyboard("{Enter}");
    const view = await renderer(el);
    await expect
      .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
      .toBe(menuTargetKey(target));
    const node = destination(view, target);
    expect(node.textContent).toContain("Changed");
    expect(getComputedStyle(node).outlineColor).toBe("rgb(123, 45, 67)");
    expect(getComputedStyle(node).outlineStyle).toBe("solid");
    const pane = q(el, '[data-test="document-pane"]')!.getBoundingClientRect();
    expect(node.getBoundingClientRect().top).toBeGreaterThanOrEqual(pane.top);
    expect(node.getBoundingClientRect().bottom).toBeLessThanOrEqual(pane.bottom);
    q<HTMLButtonElement>(el, '[data-test="return-change"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(row);
  },
);

/** The fixture with the menu "Bar" included in `parent`, as a folder or shown directly. */
function withInclude(direct: boolean, parent: string[] = []) {
  const doc = fixture();
  const include: DocumentMember = {
    kind: "section",
    sectionId: "bar",
    internalName: "Counter bar menu",
    names: { en: "Drinks", es: "Bebidas" },
    image: null,
    color: null,
    includedMenu: { id: "menu-bar", name: "Bar list" },
    ...(direct ? { direct: true as const } : {}),
    members: [documentSection("cold", "Counter cold drinks", [])],
  };
  let members = doc.root.members;
  for (const id of parent) {
    const section = members.find((m) => m.kind === "section" && m.sectionId === id);
    if (section?.kind !== "section") throw new Error("parent fixture");
    members = section.members;
  }
  members.push(include);
  return doc;
}
function switched(
  before: string[],
  after: string[],
): Extract<MenuChange, { kind: "section_changed" }> {
  const at = (sectionIds: string[]): MenuTarget => ({
    kind: "section",
    sectionIds,
    field: { kind: "direct" },
  });
  return {
    id: "switched",
    kind: "section_changed",
    sectionId: "bar",
    name: "Counter bar menu",
    fields: ["direct"],
    source: "this_menu",
    targets: { before: [at(before)], after: [at(after)] },
  };
}

it("follows an include switched to its sections to the note that says so, and back to its folder", async () => {
  const change = switched(["bar"], ["bar"]);
  const el = await mount([change], withInclude(true), withInclude(false));
  q<HTMLButtonElement>(el, 'button[data-change-id="switched"]')!.click();
  const view = await renderer(el);
  await expect
    .poll(() => view.shadowRoot!.activeElement?.querySelector("[data-direct]")?.textContent)
    .toBe("Bebidas: shown directly");
  expect(view.shadowRoot!.activeElement?.getAttribute("data-change-target")).toBe(
    menuTargetKey(change.targets.after[0]!),
  );
  q<HTMLButtonElement>(el, 'button[data-side="before"]')!.click();
  await expect
    .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
    .toBe(menuTargetKey(change.targets.before[0]!));
  expect(
    view.shadowRoot!.activeElement!.querySelector("button[aria-expanded]")!.textContent,
  ).toContain("Bebidas");
  expect(q(el, '[data-test="navigation-unavailable"]')).toBeNull();
});

it("follows an include moved to another list and switched to its sections at each of its rows", async () => {
  const removed: MenuChange = {
    id: "removed",
    kind: "section_removed",
    sectionId: "bar",
    parentSectionIds: ["outer"],
    name: "Counter bar menu",
    under: ["Counter drinks"],
    source: "this_menu",
    targets: {
      before: [{ kind: "section", sectionIds: ["outer", "bar"], field: { kind: "summary" } }],
      after: [],
    },
  };
  const added: MenuChange = {
    id: "added",
    kind: "section_added",
    sectionId: "bar",
    parentSectionIds: [],
    name: "Counter bar menu",
    under: [],
    source: "this_menu",
    targets: {
      before: [],
      after: [{ kind: "section", sectionIds: ["bar"], field: { kind: "summary" } }],
    },
  };
  const change = switched(["outer", "bar"], ["bar"]);
  const el = await mount(
    [removed, added, change],
    withInclude(true),
    withInclude(false, ["outer"]),
  );
  const view = await renderer(el);
  for (const row of [removed, added, change])
    for (const side of ["before", "after"] as const)
      for (const target of row.targets[side]) {
        const link = [
          ...q(el, `button[data-change-id="${row.id}"]`)!
            .closest("li")!
            .querySelectorAll<HTMLButtonElement>(`button[data-side="${side}"]`),
        ].find((b) => b.dataset.targetKey === menuTargetKey(target));
        expect(link).toBeDefined();
        link!.click();
        await expect
          .poll(() => view.shadowRoot!.activeElement?.getAttribute("data-change-target"))
          .toBe(menuTargetKey(target));
        expect(q(el, '[data-test="navigation-unavailable"]')).toBeNull();
      }
});

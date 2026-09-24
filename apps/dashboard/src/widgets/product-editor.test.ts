import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import {
  ProductEditor,
  productEditorField,
  productEditorTranslationField,
} from "./product-editor.js";
import type { EditorVariant, ProductEditorDraft } from "./product-editor-model.js";
import type { CategorySummary, ExtraList, OptionList } from "../api/client.js";
import type { InheritedValues } from "@waitron/catalogue/src/product-types.js";
import { resolveVatRate, priceLockedLines } from "@waitron/catalogue/src/pricing.js";
import { setLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/domain.js";

// The app registers these at startup; without them every icon in the editor — the "+" chip, both
// chevrons, the drag grips, the row menus — renders EMPTY, and a suite that never draws the chrome
// cannot catch a defect in it.
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
const unit = { id: "unit-each", name: { en: "Each" }, abbreviation: { en: "ea" } };
// Staff name and customer name differ in every fixture on purpose: one string serving as both hid a
// real customer-facing defect on this branch, and an assertion cannot tell the two apart when they
// hold the same text.
const product: ProductEditorDraft = {
  name: "Coffee",
  customerName: { en: "House coffee", es: "Café de la casa" },
  description: { en: "Freshly roasted" },
  kitchenName: "BAR",
  image: null,
  unitId: unit.id,
  unitPrice: "9.00",
  active: true,
  available: true,
  soldAlone: true,
  vatClass: "reduced",
  variants: [],
  categoryIds: [],
  primaryCategoryId: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
  stationId: null,
  courseId: null,
};
const small: EditorVariant = {
  id: "small",
  name: "Small",
  customerName: { en: "Small cup", es: "Taza pequeña" },
  kitchenName: "SM",
  image: null,
  unitPrice: "2.00",
  available: true,
  active: true,
};
const large: EditorVariant = {
  id: "large",
  name: "Large",
  customerName: { en: "Large cup", es: "Taza grande" },
  kitchenName: "LG",
  image: null,
  unitPrice: "3.00",
  available: false,
  active: true,
};
// Named in the venue's own content language (the harness mounts a Spanish venue), so a chip shows
// a real word rather than falling back to its id.
const categories: CategorySummary[] = [
  { id: "drinks", name: { es: "Bebidas" }, image: null, color: "#112233", parentId: null },
  { id: "snacks", name: { es: "Aperitivos" }, image: null, color: "#aa4455", parentId: null },
  // A category with no colour of its own: the reporting mark has to survive this one being chosen.
  { id: "plates", name: { es: "Platos" }, image: null, color: null, parentId: null },
];
const reduced = [{ id: "reduced" as const, rate: "10.00", label: "Reduced" }];

async function input(el: ProductEditor, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
  if (field instanceof HTMLTextAreaElement) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  } else
    field.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await el.updateComplete;
}
function save(el: ProductEditor) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
}
function section(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector<
    HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
  >(`[data-section="${name}"]`)!;
}
/** Clicks a collapsible section's own header button, the way a person opens it. */
async function openSection(el: ProductEditor, name: string) {
  const disclosure = section(el, name);
  await disclosure.updateComplete;
  disclosure.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
  await disclosure.updateComplete;
  await el.updateComplete;
}
/** Presses the price field's unit button, which is how the unit dropdown is reached. */
async function openUnits(el: ProductEditor) {
  el.shadowRoot!.querySelector("[name=unit-price]")!.dispatchEvent(
    new CustomEvent("wt-unit-click", { detail: {}, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function variantForm(el: ProductEditor) {
  return el.shadowRoot!.querySelector<
    HTMLElement & { open: boolean; value: EditorVariant | null; updateComplete: Promise<unknown> }
  >("dashboard-variant-form")!;
}
function variantTable(el: ProductEditor) {
  return el.shadowRoot!.querySelector<
    HTMLElement & {
      variants: EditorVariant[];
      errors: Record<number, string>;
      updateComplete: Promise<unknown>;
    }
  >("dashboard-variant-table");
}

it("labels a unit option as its name then abbreviation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [{ id: "u", name: { en: "Kilogram" }, abbreviation: { en: "kg" } }],
  });
  await openUnits(el);
  const option = el.shadowRoot!.querySelector<HTMLOptionElement>(
    'select[name="unit"] option[value="u"]',
  )!;
  expect(option.textContent!.trim()).toBe("Kilogram (kg)");
});

it("labels a unit option as its name alone when it has no abbreviation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [{ id: "u", name: { en: "Portion" }, abbreviation: {} }],
  });
  await openUnits(el);
  const option = el.shadowRoot!.querySelector<HTMLOptionElement>(
    'select[name="unit"] option[value="u"]',
  )!;
  expect(option.textContent!.trim()).toBe("Portion");
});

it('renders a short unit as "per unit" on the price control', async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: "litre" },
    locales: ["en"],
    units: [{ id: "litre", name: { en: "Litre" }, abbreviation: { en: "l" } }],
    taxChoices: reduced,
  });
  expect(el.shadowRoot!.querySelector("[name=unit-price]")!.getAttribute("unit")).toBe(
    t("editor.per_unit").replace("{unit}", "l"),
  );
});

it("uses the shared compact nutritional picker without a reviewed switch", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: {}, dietaryDeclarations: ["no_meat"] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await openSection(el, "nutrition");
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!;
  expect(picker).not.toBeNull();
  expect(el.shadowRoot!.querySelector("dashboard-allergen-picker")).toBeNull();
  expect(picker.shadowRoot!.querySelector('[data-test="reviewed"]')).toBeNull();
  expect(picker.shadowRoot!.querySelector('[data-test="dietary-summary"]')!.textContent).toContain(
    t("editor.diet.no_meat"),
  );
});

/** Runs `body` with the test frame at a desktop width, where the variants table keeps its price
 * column and the unit select in that column's heading. */
async function atDesktopWidth(body: () => Promise<void>): Promise<void> {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 800);
  try {
    expect(window.innerWidth).toBe(1280);
    await body();
  } finally {
    await page.viewport(width, height);
  }
}

it("puts the variant pricing unit chooser in the table header, not below the table", async () => {
  await atDesktopWidth(async () => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, variants: [small, large] },
      locales: ["en"],
      units: [unit, { id: "litre", name: { en: "Litre" }, abbreviation: { en: "l" } }],
      taxChoices: reduced,
    });
    const table = variantTable(el)!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector('select[name="pricing-unit"]')!;
    expect(select.getClientRects().length).toBeGreaterThan(0);
    expect(el.shadowRoot!.querySelector('[data-test="choose-unit"]')).toBeNull();
  });
});

// A phone hides the variants table's price column and the unit select in its heading, so the price
// field's own unit button has to reach everything that select offered.
it("changes a product's unit from the price field when the table's heading select is hidden", async () => {
  const litre = { id: "litre", name: { en: "Litre" }, abbreviation: { en: "l" } };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit, litre],
    taxChoices: reduced,
  });
  const table = variantTable(el)!;
  table.style.width = "20rem";
  await table.updateComplete;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const heading = table.shadowRoot!.querySelector('select[name="pricing-unit"]')!;
  expect(heading.getClientRects()).toHaveLength(0);
  await openUnits(el);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  expect(select.getClientRects().length).toBeGreaterThan(0);
  expect([...select.options].map((option) => option.value)).toEqual(["", unit.id, litre.id]);
  expect(el.shadowRoot!.querySelector('[data-test="add-unit"]')).not.toBeNull();
  select.value = litre.id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(litre.id);
});

it("applies variant-table unit changes and forwards its add-unit action", async () => {
  const litre = { id: "litre", name: { en: "Litre" }, abbreviation: { en: "l" } };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit, litre],
    taxChoices: reduced,
  });
  const table = variantTable(el)!;
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  table.dispatchEvent(
    new CustomEvent("wt-unit-change", {
      detail: { unitId: litre.id },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(litre.id);
  table.dispatchEvent(new CustomEvent("wt-add-unit", { bubbles: true, composed: true }));
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "unit" });
});

it("renders the sections in the designed order, with the VAT rate above the price", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-section]")].map(
      (node) => node.dataset.section,
    ),
  ).toEqual([
    "name",
    "categories",
    "available",
    "kitchen",
    "descriptors",
    "nutrition",
    "price",
    "modifiers",
  ]);
  const tax = el.shadowRoot!.querySelector("[name=tax]")!;
  const price = el.shadowRoot!.querySelector("[name=unit-price]")!;
  // DOCUMENT_POSITION_FOLLOWING: the price field comes after the VAT select, never before it.
  expect(tax.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const pricing = section(el, "price");
  expect(pricing.tagName).toBe("FIELDSET");
  expect(pricing.querySelector("legend")?.textContent).toBe(t("editor.pricing"));
  expect(parseFloat(getComputedStyle(pricing).borderTopWidth)).toBeGreaterThan(0);
});

it("opens the three optional sections collapsed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  for (const name of ["kitchen", "descriptors", "nutrition"]) {
    expect(section(el, name).open, name).toBe(false);
  }
});

it("keeps the staff name, customer name, description and kitchen name independent", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Espresso");
  await openSection(el, "descriptors");
  await input(el, "customer-name-en", "Single espresso");
  await input(el, "description-en", "Dark roast");
  await openSection(el, "kitchen");
  await input(el, "kitchen-name", "BAR ESPRESSO");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    ...product,
    name: "Espresso",
    customerName: { en: "Single espresso", es: "Café de la casa" },
    description: { en: "Dark roast" },
    kitchenName: "BAR ESPRESSO",
  });
});

it("drops a customer name left blank in every language rather than submitting empty text", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, customerName: { en: "House coffee" } },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openSection(el, "descriptors");
  await input(el, "customer-name-en", "   ");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.customerName).toBeNull();
});

it("retains a dirty draft through child open, lookup refresh and cancellation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await input(el, "name", "Dirty coffee");
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openUnits(el);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!.click();
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "unit" });
  el.childOpen = true;
  await el.updateComplete;
  save(el);
  const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "[name=name]",
  )!;
  await field.updateComplete;
  field
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(submit).not.toHaveBeenCalled();
  el.units = [...el.units, { id: "custom", name: { en: "Custom" }, abbreviation: {} }];
  el.childOpen = false;
  await el.updateComplete;
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.name).toBe("Dirty coffee");
});

it("explains missing required fields together and retains entered values", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "unit-price", "-1");
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  const summary = el.shadowRoot!.querySelector<HTMLElement & { errors: string[] }>(
    "wt-form-error-summary",
  )!;
  expect(summary.errors.length).toBeGreaterThanOrEqual(2);
  expect(
    (el.shadowRoot!.querySelector("[name=unit-price]") as HTMLElement & { value: string }).value,
  ).toBe("-1");
});

it("opens the section holding a reported error, puts focus in the field and leaves it open once fixed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  expect(section(el, "descriptors").open).toBe(false);
  el.fieldErrors = { "customer-name-en": "That language is no longer enabled" };
  await el.updateComplete;
  await section(el, "descriptors").updateComplete;
  expect(section(el, "descriptors").open).toBe(true);
  await expect
    .poll(() => el.shadowRoot!.activeElement?.getAttribute("name"))
    .toBe("customer-name-en");
  // The section stays open when the error clears — collapsing it under the person who is fixing it
  // would hide the field they just corrected. See the decision comment in wt-disclosure.
  el.fieldErrors = {};
  await el.updateComplete;
  await section(el, "descriptors").updateComplete;
  expect(section(el, "descriptors").open).toBe(true);
  await openSection(el, "descriptors");
  expect(section(el, "descriptors").open).toBe(false);
});

it("retains a compact-picker allergen selection across an unrelated edit", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: {} },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await openSection(el, "nutrition");
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!;
  picker.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: { allergens: ["milk"], dietary: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  await input(el, "name", "New coffee");
  expect(el.currentValue.allergens).toEqual({ milk: { presence: "contains" } });
});

it("restores an existing allergen's presence and source when it is removed then re-added", async () => {
  const milk = { presence: "may_contain" as const, source: "shared fryer" };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: { milk } },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await openSection(el, "nutrition");
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!;
  for (const allergens of [[], ["milk"]]) {
    picker.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: { allergens, dietary: [] } },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
  }
  expect(el.currentValue.allergens).toEqual({ milk });
});

// Both kinds of modifier list, with staff, customer-facing and kitchen names that all differ: the
// Modifiers section shows the STAFF name (docs/developers/products.md), and a fixture whose three
// names read alike passes whether the section reads the right one or the wrong one. Each kind
// carries a list with id "shared": the two ids live in different tables, so nothing stops them
// colliding, and a row keyed on the bare id would move or remove the other kind's row.
const extraLists: ExtraList[] = [
  {
    id: "sauces",
    name: "Sauces",
    customerName: { en: "Choose a sauce", es: "Elige una salsa" },
    kitchenName: "SALSA",
    minPicks: 0,
    maxPicks: null,
    active: true,
    items: [],
  },
  {
    id: "shared",
    name: "Extra bread",
    customerName: { en: "More bread", es: "Mas pan" },
    kitchenName: "PAN",
    minPicks: 0,
    maxPicks: null,
    active: true,
    items: [],
  },
];
const optionLists: OptionList[] = [
  {
    id: "cooked",
    name: "Cooked",
    customerName: { en: "How would you like it?", es: "Punto de la carne" },
    kitchenName: "PUNTO",
    defaultLabelId: null,
    active: true,
    labels: [],
  },
  {
    id: "shared",
    name: "Cut",
    customerName: { en: "How shall we cut it?", es: "Como lo cortamos" },
    kitchenName: "CORTE",
    defaultLabelId: null,
    active: true,
    labels: [],
  },
];
const attachedRows = (el: ProductEditor) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=attached-modifier]"),
];
const cellText = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-test=${name}]`)!.textContent!.trim();

it("lists both kinds of attached modifier list in one order, by staff name and kind", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      modifiers: [
        { kind: "extras", id: "sauces" },
        { kind: "options", id: "cooked" },
        // A list the loaded set does not hold — a deleted one, or one this screen never loaded.
        { kind: "options", id: "vanished" },
      ],
    },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const rows = attachedRows(el);
  expect(rows.map((row) => row.dataset.modifier)).toEqual([
    "extras:sauces",
    "options:cooked",
    "options:vanished",
  ]);
  expect(rows.map((row) => cellText(row, "modifier-name"))).toEqual([
    "Sauces",
    "Cooked",
    t("editor.missing_choice"),
  ]);
  // Extras and options are two different features under one list; a row that does not say which it
  // is cannot be reordered sensibly against the other kind.
  expect(rows.map((row) => cellText(row, "modifier-kind"))).toEqual([
    t("extras.title"),
    t("options.title"),
    t("options.title"),
  ]);
});

it("offers every unattached list of both kinds, and attaches the one chosen", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const combobox = el.shadowRoot!.querySelector<
    HTMLElement & { options: { value: string; label: string }[] }
  >("[data-test=add-modifier]")!;
  expect(combobox.options.map((option) => option.value)).toEqual([
    "create-extras",
    "create-options",
    "extras:shared",
    "options:cooked",
    "options:shared",
  ]);
  expect(combobox.options.map((option) => option.label)).toEqual([
    t("editor.create_extra_list"),
    t("editor.create_option_list"),
    `Extra bread · ${t("extras.title")}`,
    `Cooked · ${t("options.title")}`,
    `Cut · ${t("options.title")}`,
  ]);
  combobox.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "options:shared" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "extras", id: "sauces" },
    { kind: "options", id: "shared" },
  ]);
});

it("reorders and removes across kinds, telling two lists with the same id apart", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      modifiers: [
        { kind: "extras", id: "shared" },
        { kind: "options", id: "shared" },
        { kind: "extras", id: "sauces" },
      ],
    },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-options:shared"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "options", id: "shared" },
    { kind: "extras", id: "shared" },
    { kind: "extras", id: "sauces" },
  ]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-modifier-extras:shared"]')!.click();
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "options", id: "shared" },
    { kind: "extras", id: "sauces" },
  ]);
});

it("asks the screen to create a list of either kind, and to edit an attached one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const create = vi.fn();
  const edit = vi.fn();
  el.addEventListener("wt-create-related", create);
  el.addEventListener("wt-edit-related", edit);
  const combobox = el.shadowRoot!.querySelector("[data-test=add-modifier]")!;
  for (const value of ["create-extras", "create-options"]) {
    combobox.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  }
  expect(create.mock.calls.map((call) => call[0].detail)).toEqual([
    { kind: "extras" },
    { kind: "options" },
  ]);
  // Each create entry is a command, not a membership: neither may attach itself to the product.
  expect(el.currentValue.modifiers).toEqual([{ kind: "extras", id: "sauces" }]);
  // What the screen calls back with once the nested form has saved. An id already attached must
  // not be attached twice.
  el.selectRelated("extras", "sauces");
  el.selectRelated("options", "cooked");
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "extras", id: "sauces" },
    { kind: "options", id: "cooked" },
  ]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-modifier-extras:sauces"]')!.click();
  expect(edit.mock.calls[0]![0].detail).toEqual({ kind: "extras", id: "sauces" });
});

const addModifier = (el: ProductEditor) =>
  el.shadowRoot!.querySelector<
    HTMLElement & { value: string; error: string; updateComplete: Promise<unknown> }
  >("[data-test=add-modifier]")!;
/** Opens the Modifiers control and clicks one of its rows, the way a person does. A synthetic
 * `wt-change` dispatched AT the control never moves the control's own `value`, so a test that
 * dispatches one cannot see what the control reads afterwards. */
async function chooseModifier(el: ProductEditor, label: string) {
  const combobox = addModifier(el);
  await combobox.updateComplete;
  combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await combobox.updateComplete;
  const row = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("li[role=option]")].find(
    (option) => option.textContent!.trim() === label,
  )!;
  row.click();
  await combobox.updateComplete;
  await el.updateComplete;
  return combobox;
}
const triggerText = (combobox: HTMLElement) =>
  combobox.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!.textContent!.trim();

it("returns the add-a-list control to its placeholder after a choice, keeping focus on it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const created = vi.fn();
  el.addEventListener("wt-create-related", created);
  const combobox = await chooseModifier(el, t("editor.create_extra_list"));
  expect(created.mock.calls.map((call) => call[0].detail)).toEqual([{ kind: "extras" }]);
  // Every row of this control is a command that is spent when it is chosen — one opens a nested
  // form, the rest attach a list to the table above. Leaving the last command in the control says
  // the product carries it.
  expect(combobox.value).toBe("");
  expect(triggerText(combobox)).toBe(t("editor.choose"));

  await chooseModifier(el, `Cooked · ${t("options.title")}`);
  expect(el.currentValue.modifiers).toEqual([{ kind: "options", id: "cooked" }]);
  expect(combobox.value).toBe("");
  expect(triggerText(combobox)).toBe(t("editor.choose"));
  // Reset in place, not by replacing the control: a replaced one would drop the focus its own
  // choice handling just returned, and a manager attaching a second list would have to find it
  // again.
  expect(el.shadowRoot!.activeElement).toBe(combobox);
});

it("shows a refusal naming an attached list beside the Modifiers control", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  el.fieldErrors = { modifier: t("editor.field_rejected") };
  await el.updateComplete;
  const combobox = addModifier(el);
  await combobox.updateComplete;
  expect(combobox.error).toBe(t("editor.field_rejected"));
  expect(combobox.shadowRoot!.querySelector("[data-error]")!.textContent!.trim()).toBe(
    t("editor.field_rejected"),
  );
  // Focus follows the message, the way it does for every other refused field: the editor aims it
  // during the update and lands it once that update has rendered.
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(combobox);
});

it("returns focus to the Modifiers control after every nested form it can open", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const combobox = addModifier(el);
  // Both kinds of modifier list are added from the ONE combobox, so both return focus to it.
  for (const kind of ["extras", "options"] as const) {
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    expect(el.shadowRoot!.activeElement).toBeNull();
    el.returnRelatedFocus(kind);
    expect(el.shadowRoot!.activeElement).toBe(combobox);
  }
});

it("edits the product's categories through the membership picker's own Save", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, categoryIds: ["drinks"], primaryCategoryId: "drinks" },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    categories,
  });
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-chip]")].map(
      (chip) => chip.dataset.category,
    ),
  ).toEqual(["drinks"]);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=pick-categories]")!.click();
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<
    HTMLElement & { value: { categoryIds: string[]; primaryCategoryId: string | null } }
  >("dashboard-category-membership-picker")!;
  expect(picker.value).toEqual({ categoryIds: ["drinks"], primaryCategoryId: "drinks" });
  picker.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { categoryIds: ["snacks", "drinks"], primaryCategoryId: "drinks" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.categoryIds).toEqual(["snacks", "drinks"]);
  expect(el.currentValue.primaryCategoryId).toBe("drinks");
  expect(el.shadowRoot!.querySelector("dashboard-category-membership-picker")).toBeNull();
  const chips = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-chip]")];
  expect(chips.map((chip) => chip.dataset.category)).toEqual(["snacks", "drinks"]);
  // Every chip keeps its OWN colour — both of these have one, and they differ, so a rule that
  // coloured only the reporting chip reads differently here from one that colours them all.
  expect(chips.map((chip) => chip.querySelector("wt-lozenge")!.getAttribute("color"))).toEqual([
    "#aa4455",
    "#112233",
  ]);
});

it("marks the reporting category even when it has no colour of its own", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    // "plates" is the reporting category and has no colour; "snacks" has one. A mark that rode on
    // the colour would leave the coloured chip looking like the reporting one.
    value: { ...product, categoryIds: ["snacks", "plates"], primaryCategoryId: "plates" },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    categories,
  });
  const chips = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=category-chip]")];
  expect(chips.map((chip) => chip.dataset.category)).toEqual(["snacks", "plates"]);
  expect(chips.map((chip) => chip.classList.contains("reporting"))).toEqual([false, true]);
  // And the mark has to PAINT: a class no rule reaches leaves the chip looking ordinary while every
  // attribute assertion still passes.
  const ring = (index: number) =>
    getComputedStyle(chips[index]!.querySelector("wt-lozenge")!).boxShadow;
  expect(ring(0)).toBe("none");
  expect(ring(1)).not.toBe("none");
  expect(chips[1]!.getAttribute("aria-label")).toBe(`${t("editor.reporting_category")}: Platos`);
});

it("flags a reporting category that is not one of the chosen categories", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, categoryIds: ["drinks"], primaryCategoryId: "snacks" },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    categories,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(el.shadowRoot!.getElementById("primary-error")!.textContent).toBe(
    t("editor.reporting_category_invalid"),
  );
});

it("offers all six product dietary declarations without changing the saved set", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, dietaryDeclarations: ["vegan", "halal"] },
    locales: ["en"],
  });
  await openSection(el, "nutrition");
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-dietary"]')!.click();
  await picker.updateComplete;
  const dietary = picker.shadowRoot!.querySelector<HTMLElement & { options: { value: string }[] }>(
    "[data-test=dietary]",
  )!;
  expect(dietary.options.map((option) => option.value)).toEqual([
    "vegan",
    "vegetarian",
    "halal",
    "kosher",
    "no_meat",
    "no_fish",
  ]);
  expect(el.currentValue.dietaryDeclarations).toEqual(["vegan", "halal"]);
});

it("associates server and client errors with native selects", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    fieldErrors: { tax: "Tax is no longer available" },
  });
  save(el);
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector(`[name=tax]`)!;
  expect(select.getAttribute("aria-invalid")).toBe("true");
  const error = el.shadowRoot!.getElementById(select.getAttribute("aria-describedby")!);
  expect(error?.textContent?.trim()).toBeTruthy();
  expect(el.shadowRoot!.getElementById("tax-error")!.textContent).toBe(
    "Tax is no longer available",
  );
});

it("saves a variant with no price of its own, which sells at the product's", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [{ ...small, unitPrice: null }, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.variants[0].unitPrice).toBeNull();
});

it("applies a reorder, an availability toggle and an edit from the variants table to the draft", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const table = variantTable(el)!;
  table.dispatchEvent(
    new CustomEvent("wt-reorder", { detail: { from: 0, to: 1 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants.map((variant) => variant.name)).toEqual(["Large", "Small"]);
  table.dispatchEvent(
    new CustomEvent("wt-toggle-available", {
      detail: { index: 0, available: true },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants[0]!.available).toBe(true);
  table.dispatchEvent(
    new CustomEvent("wt-edit", { detail: { index: 1 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(variantForm(el).open).toBe(true);
  expect(variantForm(el).value).toEqual(small);
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...small, name: "Very small", unitPrice: "1.50" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants[1]).toEqual({ ...small, name: "Very small", unitPrice: "1.50" });
});

it("names the product's unit in the variants table's price column", async () => {
  await atDesktopWidth(async () => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, variants: [small, large] },
      locales: ["en"],
      units: [unit],
      taxChoices: reduced,
    });
    const table = variantTable(el)!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[name="pricing-unit"]',
    )!;
    expect(select.getClientRects().length).toBeGreaterThan(0);
    expect(select.selectedOptions[0]!.textContent!.trim()).toBe("ea");
  });
});

it("saves station and course with a new product, without a separate routing event", async () => {
  const routed = vi.fn();
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "general", rate: "21.00", label: "General" }],
    stations: [
      { id: "station-1", name: "Bar" },
      { id: "station-2", name: "Kitchen" },
    ],
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  el.addEventListener("wt-set-product-station", routed);
  el.addEventListener("wt-set-product-course", routed);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openSection(el, "kitchen");
  await input(el, "name", "Tortilla");
  const station = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-station]")!;
  const course = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-course]")!;
  station.value = "station-2";
  station.dispatchEvent(new Event("change"));
  course.value = "course-1";
  course.dispatchEvent(new Event("change"));
  await el.updateComplete;
  save(el);
  expect(routed).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    name: "Tortilla",
    customerName: null,
    description: null,
    kitchenName: null,
    image: null,
    unitId: null,
    unitPrice: "0.00",
    active: true,
    available: true,
    soldAlone: true,
    vatClass: "general",
    variants: [],
    categoryIds: [],
    primaryCategoryId: null,
    modifiers: [],
    allergens: null,
    dietaryDeclarations: [],
    stationId: "station-2",
    courseId: "course-1",
  });
});

it("preselects the saved station and course", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "product-1", stationId: "station-1", courseId: "course-1" },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    stations: [
      { id: "station-1", name: "Bar" },
      { id: "station-2", name: "Kitchen" },
    ],
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  await openSection(el, "kitchen");
  expect(el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-station]")!.value).toBe(
    "station-1",
  );
  expect(el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-course]")!.value).toBe(
    "course-1",
  );
});

it("saves only once and refuses a second press", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.variants).toEqual([small, large]);
});

// Spec §15.6: the Available switch is "sold out for now" and writes only `available`; whether the
// product exists is `active`, which the editor carries through untouched and changes only by Restore.
it("sends the Available switch as available and leaves active as it was", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1" },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector("wt-switch[name=available]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  const sent = submit.mock.calls[0]![0].detail.value;
  expect({ active: sent.active, available: sent.available }).toEqual({
    active: true,
    available: false,
  });
  expect(el.shadowRoot!.querySelector("[data-test=restore]")).toBeNull();
});

it("creates a new product Active", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "general", rate: "21.00", label: "General" }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Water");
  await input(el, "unit-price", "1.00");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.active).toBe(true);
});

it("offers an Inactive product's Restore, which saves it Active and keeps its availability", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1", active: false, available: false },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  expect(el.shadowRoot!.querySelector("[data-test=inactive-notice]")!.textContent!.trim()).toBe(
    t("product.inactive_notice"),
  );
  const restore = el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!;
  expect(restore.textContent!.trim()).toBe(t("product.restore"));
  restore.click();
  expect(submit).toHaveBeenCalledOnce();
  const sent = submit.mock.calls[0]![0].detail.value;
  expect({ active: sent.active, available: sent.available }).toEqual({
    active: true,
    available: false,
  });
});

it("saves an Inactive product's other edits without restoring it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1", active: false },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.active).toBe(false);
});

it("summarises each collapsed section so nothing filled in is invisible", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      image: "abc.png",
      stationId: "station-1",
      courseId: "course-1",
      dietaryDeclarations: ["vegan"],
    },
    locales: ["en", "es"],
    units: [unit],
    taxChoices: reduced,
    stations: [{ id: "station-1", name: "Bar" }],
    courses: [{ id: "course-1", name: "Starters" }],
  });
  expect(section(el, "kitchen").getAttribute("summary")).toBe("BAR · Bar · Starters");
  // The dashboard's shipped locale is Spanish, so these summaries are the Spanish strings.
  expect(section(el, "descriptors").getAttribute("summary")).toBe(
    "nombre para el cliente (en, es) · descripción (en) · imagen",
  );
  expect(section(el, "nutrition").getAttribute("summary")).toBe("Vegano");
});

it("reports a Cancel when its window is dismissed, never when the screen shuts it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const cancelled = vi.fn();
  el.addEventListener("wt-cancel", cancelled);
  el.open = false;
  await el.updateComplete;
  await closeReportsDelivered();
  expect(cancelled).not.toHaveBeenCalled();

  el.open = true;
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const dismissed = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  modal.shadowRoot!.querySelector("dialog")!.close();
  await dismissed;
  expect(cancelled).toHaveBeenCalledOnce();
});

it("suspends Save and Cancel while a nested window is open", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  const cancelled = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancelled);
  variantTable(el)!.dispatchEvent(
    new CustomEvent("wt-edit", { detail: { index: 0 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  save(el);
  el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!.click();
  expect(submit).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!.click();
  expect(cancelled).toHaveBeenCalledOnce();
});

it("marks the variant row a reported problem belongs to", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, unitPrice: "-1" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  // The summary alone cannot say WHICH variant is wrong, and a variant has no field in this form.
  expect(variantTable(el)!.errors).toEqual({ 1: t("editor.price_invalid") });
});

// The server names a variant by its place in the whole list it was sent, Inactive rows included,
// while the table hides an Inactive row by default: the refusal has to reach the row it names.
it("puts a server refusal of variants.2 on the third variant's row, past a hidden Inactive one", async () => {
  const medium: EditorVariant = {
    id: "medium",
    name: "Medium",
    customerName: { en: "Medium cup", es: "Taza mediana" },
    kitchenName: "MD",
    image: null,
    unitPrice: "2.50",
    available: true,
    active: true,
  };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, active: false }, medium] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const message = t("editor.field_rejected");
  el.fieldErrors = { [productEditorField("variants.2.unitPrice", "en")!]: message };
  await el.updateComplete;
  const table = variantTable(el)!;
  await table.updateComplete;
  expect(table.errors).toEqual({ 2: message });
  expect(table.shadowRoot!.querySelector("[data-test=row-1]")).toBeNull();
  const row = table.shadowRoot!.querySelector("[data-test=row-2]")!;
  expect(row.textContent).toContain("Medium");
  expect(row.querySelector("[data-test=error-2]")!.textContent!.trim()).toBe(message);
  await expect
    .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
    .toBe("actions-2");
});

it("keeps a variant's mark on that variant when the rows are reordered", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, unitPrice: "-1" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  save(el);
  await el.updateComplete;
  expect(variantTable(el)!.errors).toEqual({ 1: t("editor.price_invalid") });
  // Dragging is the likeliest thing anyone does to this table, and it does not revalidate. A mark
  // held against a POSITION would move onto the innocent row and leave the bad one unmarked —
  // telling the person the wrong variant is the problem, which is worse than not marking at all.
  variantTable(el)!.dispatchEvent(
    new CustomEvent("wt-reorder", { detail: { from: 1, to: 0 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants.map((variant) => variant.unitPrice)).toEqual(["-1", "2.00"]);
  expect(variantTable(el)!.errors).toEqual({ 0: t("editor.price_invalid") });
});

it("locks the plain price field while a save is in flight, like every other field on the form", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    busy: true,
  });
  const price = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[name=unit-price]",
  )!;
  // The staff-name field beside it is the form's settled behaviour; the price field has to match,
  // or a person can keep typing a price into a product that is already being written.
  const staffName = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[name=name]",
  )!;
  expect(staffName.disabled).toBe(true);
  expect(price.disabled).toBe(true);
  // Pressing the price field's own unit button is the only way into the unit dropdown from here,
  // and a disabled button fires no click at all, so the dropdown stays shut.
  await (price as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  price.shadowRoot!.querySelector<HTMLButtonElement>("button.unit")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=unit]")).toBeNull();
});

it("maps a rejected product body's field onto the editor field that holds it", () => {
  expect(productEditorField("name", "es")).toBe("name");
  expect(productEditorField("customerName", "es")).toBe("customer-name-es");
  expect(productEditorField("description", "en")).toBe("description-en");
  expect(productEditorField("kitchenName", "es")).toBe("kitchen-name");
  expect(productEditorField("unitId", "es")).toBe("unit");
  expect(productEditorField("unitPrice", "es")).toBe("unit-price");
  expect(productEditorField("vatClass", "es")).toBe("tax");
  expect(productEditorField("primaryCategoryId", "es")).toBe("primary");
  expect(productEditorField("variants.2.unitPrice", "es")).toBe("variant-2-price");
  expect(productEditorField("variants.0.name", "es")).toBe("variant-0-name");
  // A refused attachment names a POSITION in the product's list; the Modifiers section holds one
  // control, so every position reports there.
  expect(productEditorField("modifiers.0.id", "es")).toBe("modifier");
  expect(productEditorField("modifiers.11.id", "es")).toBe("modifier");
  // A field with no error display on this form maps to nothing rather than to a guess, and the
  // refusal falls back to the screen's own banner. The product's availability IS on the form (a
  // `name="available"` switch) but has no error slot wired to it; a variant's has neither.
  expect(productEditorField("available", "es")).toBeNull();
  expect(productEditorField("variants.0.available", "es")).toBeNull();
});

it("defaults a new product to Each (no unit)", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [{ id: "kg", name: { en: "Kilogram" }, abbreviation: { en: "kg" } }],
  });
  // Each is a chosen unit like any other, so the price field's button names it rather than asking
  // the person to choose — which is the only thing on screen until they open the chooser.
  expect(el.shadowRoot!.querySelector("[name=unit-price]")!.getAttribute("unit")).toBe(
    t("editor.per_unit").replace("{unit}", t("editor.unit_each")),
  );
  await openUnits(el);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  expect(select.value).toBe(""); // the Each option
  expect(el.shadowRoot!.querySelector('[data-test="add-unit"]')).toBeTruthy();
});

it("submits unitId null when Each stays selected", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [{ id: "kg", name: { en: "Kilogram" }, abbreviation: { en: "kg" } }],
    taxChoices: [{ id: "general", rate: "21.00", label: "General" }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Water");
  await input(el, "unit-price", "1.00");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBeNull();
});

it("submits the chosen real unit and marks it selected after load", async () => {
  const kg = { id: "kg", name: { en: "Kilogram" }, abbreviation: { en: "kg" } };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: kg.id },
    locales: ["en"],
    units: [kg],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
  });
  await openUnits(el);
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  expect(select.value).toBe(kg.id);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBe(kg.id);
});

it("shows the resolver's rates, including a fractional rate supplied by a controlled fixture", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
  });
  const options = () =>
    el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[name=tax] option[value]:not([value=''])");
  expect(options()).toHaveLength(4);
  for (const option of options()) {
    expect(option.textContent).toContain(
      `(${Number(resolveVatRate(option.value as NonNullable<ProductEditorDraft["vatClass"]>))}%)`,
    );
  }
  expect([...options()].find((option) => option.value === "zero")!.textContent).toBe(
    "Sin impuestos (0%)",
  );
  el.taxChoices = [{ id: "reduced", rate: "2.50", label: "Fixture rate" }];
  await el.updateComplete;
  expect(options()[0]!.textContent).toBe("Fixture rate (2.5%)");
  const priced = priceLockedLines([
    {
      grossUnitPrice: "102.50",
      quantity: "1",
      vatRate: el.taxChoices[0]!.rate,
      name: "Fixture dish",
      descriptions: { en: "Fixture dish for the guest" },
      category: null,
    },
  ]);
  expect(priced.vatBreakdown).toEqual([{ rate: "2.50", base: "100.00", tax: "2.50" }]);
});

// Every cell in this table holds ONE line of text or one 44px-tall control, so a row only reads as a
// row when all four sit on the same line. The shared table block top-aligns cells and re-centres the
// handle alone, which is right for the two modifier-list FORMS — their cells stack labelled inputs —
// and wrong here: it left the name and the type reading 13px above their own grip and row menu.
// Geometry is the only thing that can catch it; every attribute assertion passes either way.
it("keeps an attached row's name, type, grip and row menu on one line", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    extraLists,
    optionLists,
  });
  const row = attachedRows(el)[0]!;
  // A cell's own box is stretched to the row, so it cannot say where the text sits; a Range over the
  // cell's contents measures the drawn glyphs.
  const textMiddle = (selector: string) => {
    const range = document.createRange();
    range.selectNodeContents(row.querySelector(selector)!);
    const box = range.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  };
  const middle = (selector: string) => {
    const box = row.querySelector(selector)!.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  };
  const grip = middle(".handle");
  expect(middle("wt-row-actions")).toBeCloseTo(grip, 0);
  expect(textMiddle("[data-test=modifier-name]")).toBeCloseTo(grip, 0);
  expect(textMiddle("[data-test=modifier-kind]")).toBeCloseTo(grip, 0);
});

// --- The parent's variants section (spec §15.1, §15.3, §15.6) ---

function tableEvent(el: ProductEditor, name: string, detail: Record<string, unknown>) {
  variantTable(el)!.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  return el.updateComplete;
}

it("adds the first variant as one row of its own, with no Regular variant made from the price", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  expect(el.currentValue.variants).toEqual([]);
  expect(variantForm(el).open).toBe(true);
  expect(variantForm(el).value).toBeNull();
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...small, id: undefined } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants.map((variant) => variant.name)).toEqual(["Small"]);
  expect(el.currentValue.unitPrice).toBe("9.00");
  expect(variantTable(el)!.variants).toHaveLength(1);
});

it("adds nothing when the first Add variant is cancelled", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants).toEqual([]);
  expect(el.currentValue.unitPrice).toBe("9.00");
  expect(variantTable(el)).toBeNull();
});

it("keeps the price field beside the variants, labelled as the base price", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const price = el.shadowRoot!.querySelector<
    HTMLElement & { value: string; label: string; required: boolean }
  >("[name=unit-price]")!;
  expect(price.value).toBe("9.00");
  expect(price.required).toBe(true);
  expect(price.label).toBe(t("editor.base_price_unit").replace("{unit}", "ea"));
  // Without variants the same field is the product's plain price.
  const { el: plain } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  expect(
    plain.shadowRoot!.querySelector<HTMLElement & { label: string }>("[name=unit-price]")!.label,
  ).toBe(t("editor.price_unit").replace("{unit}", "ea"));
});

it("still requires a valid base price while the product has variants", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "unit-price", "-1");
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=unit-price]")!.error,
  ).toBe(t("editor.price_invalid"));
});

it("makes a removed variant Inactive rather than dropping it, and saves it so", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await tableEvent(el, "wt-remove", { index: 1 });
  expect(el.currentValue.variants).toEqual([small, { ...large, active: false }]);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  const sent = submit.mock.calls[0]![0].detail.value.variants;
  expect(sent.map((variant: EditorVariant) => [variant.id, variant.active])).toEqual([
    ["small", true],
    ["large", false],
  ]);
});

it("drops a removed variant that was never saved, since there is nothing to make Inactive", async () => {
  const fresh: EditorVariant = { ...small, id: undefined, name: "Fresh" };
  delete fresh.id;
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, fresh] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await tableEvent(el, "wt-remove", { index: 1 });
  expect(el.currentValue.variants).toEqual([small]);
});

it("puts focus on Add variant when Remove drops the only variant and the table goes with it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  const fresh: EditorVariant = { ...small, name: "Fresh" };
  delete fresh.id;
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", { detail: { value: fresh }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const table = variantTable(el)!;
  await table.updateComplete;
  // Remove from the row's menu, the way a keyboard user reaches it.
  table
    .shadowRoot!.querySelector<HTMLElement & { show(): void }>('[data-test="actions-0"]')!
    .show();
  const remove = table.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-0"]')!;
  remove.focus();
  remove.click();
  await el.updateComplete;
  expect(el.currentValue.variants).toEqual([]);
  expect(variantTable(el)).toBeNull();
  await expect
    .poll(() => el.shadowRoot!.activeElement?.getAttribute("data-test"))
    .toBe("add-variant");
});

it("restores an Inactive variant from the variants section", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, active: false }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await tableEvent(el, "wt-restore", { index: 1 });
  expect(el.currentValue.variants[1]).toEqual(large);
});

it("never reactivates an Inactive variant on a save that did not restore it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, active: false }] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  // A restore of the PRODUCT is not a restore of its variants.
  await input(el, "name", "Coffee to go");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.variants[1].active).toBe(false);
});

it("asks the screen to open a saved variant's own page", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const opened = vi.fn();
  el.addEventListener("wt-open-product", opened);
  await tableEvent(el, "wt-open", { index: 1 });
  expect(opened).toHaveBeenCalledOnce();
  expect(opened.mock.calls[0]![0].detail).toEqual({ productId: "large" });
  expect(opened.mock.calls[0]![0].composed).toBe(true);
});

it("hands the variants section and window the base price and photo a blank one falls back to", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, image: "coffee.png", variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await input(el, "unit-price", "9.50");
  const table = variantTable(el) as unknown as { basePrice: string };
  expect(table.basePrice).toBe("9.50");
  const form = variantForm(el) as unknown as { basePrice: string; inheritedImage: string | null };
  expect(form.basePrice).toBe("9.50");
  expect(form.inheritedImage).toBe("coffee.png");
});

it("points a refused translation at an Active variant only, as the server checks only those", () => {
  const value = {
    customerName: { en: "Coffee", es: "Café" },
    variants: [
      { customerName: { es: "Taza" }, active: false },
      { customerName: { es: "Vaso" }, active: true },
    ],
  };
  expect(productEditorTranslationField(value, "en")).toBe("variant-1-name");
  expect(
    productEditorTranslationField({ ...value, variants: [value.variants[0]!] }, "en"),
  ).toBeNull();
});

// --- A variant's own page (spec §4.4, §9.1, §15.2) ---

// The parent's value for every inherited field, each DIFFERENT from what the variant might set, so
// an assertion can tell a hint read from the parent from a value read from the variant.
const litre = { id: "litre", name: { en: "Litre" }, abbreviation: { en: "l" } };
const parentValues: InheritedValues = {
  description: { en: "Roasted in house" },
  image: "coffee.png",
  unitPrice: "9.00",
  vatClass: "reduced",
  unitId: litre.id,
  categoryIds: ["drinks", "snacks"],
  primaryCategoryId: "drinks",
  stationId: "bar",
  courseId: "mains",
  allergens: { milk: { presence: "contains" } },
  dietaryDeclarations: ["vegetarian"],
};
const glass: ProductEditorDraft = {
  ...product,
  id: "glass",
  parentId: "coffee",
  inherited: parentValues,
  name: "Glass of coffee",
  customerName: { en: "A glass", es: "Un vaso" },
  kitchenName: "GLS",
  description: null,
  image: null,
  unitId: null,
  unitPrice: null,
  vatClass: null,
  categoryIds: [],
  primaryCategoryId: null,
  allergens: null,
  dietaryDeclarations: null,
  stationId: null,
  courseId: null,
};
const stations = [
  { id: "bar", name: "Bar" },
  { id: "grill", name: "Grill" },
];
const courses = [
  { id: "mains", name: "Mains" },
  { id: "desserts", name: "Desserts" },
];
const taxes = [
  { id: "reduced" as const, rate: "10.00", label: "Reduced" },
  { id: "general" as const, rate: "21.00", label: "General" },
];

async function mountVariant(value: ProductEditorDraft = glass) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value,
      locales: ["en"],
      units: [unit, litre],
      taxChoices: taxes,
      categories,
      stations,
      courses,
      api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never,
    })
  ).el;
}
function control<T = HTMLElement>(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector(`[name="${name}"]`) as unknown as T;
}
function firstOption(el: ProductEditor, name: string) {
  return control<HTMLSelectElement>(el, name).options[0]!;
}
function hint(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector(`[data-test="${name}"]`)?.textContent?.trim();
}
const sameAs = (value: string) => t("editor.same_as").replace("{value}", value);

it("titles a variant's page as a variant, with no Modifiers and no Variants section", async () => {
  const el = await mountVariant();
  expect(el.shadowRoot!.querySelector("wt-modal")!.getAttribute("heading")).toBe(
    t("editor.edit_variant"),
  );
  expect(section(el, "modifiers")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=add-variant]")).toBeNull();
  expect(variantTable(el)).toBeNull();
});

it("shows a variant's inherited price and description empty, with the parent's value as the hint", async () => {
  const el = await mountVariant();
  const price = control<{ value: string; placeholder: string; required: boolean }>(
    el,
    "unit-price",
  );
  expect(price.value).toBe("");
  expect(price.placeholder).toBe("9.00");
  // A variant's price is optional: blank sells at the base price (spec §15.3).
  expect(price.required).toBe(false);
  const description = control<HTMLTextAreaElement>(el, "description-en");
  expect(description.value).toBe("");
  expect(description.placeholder).toBe("Roasted in house");
});

// Storage inherits a variant's description as ONE value across every language
// (`packages/catalogue/src/variant-fallback.ts`), so a language left blank beside one with text reads
// blank, not the parent's.
async function mountBilingualVariant(description: ProductEditorDraft["description"] = null) {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...glass,
      description,
      inherited: {
        ...parentValues,
        description: { en: "Roasted in house", es: "Tostado en casa" },
      },
    },
    locales: ["en", "es"],
    units: [unit, litre],
    taxChoices: taxes,
    categories,
  });
  return el;
}
const placeholders = (el: ProductEditor) =>
  ["en", "es"].map(
    (locale) => control<HTMLTextAreaElement>(el, `description-${locale}`).placeholder,
  );

it("hints a variant's description in every language only while every language is blank", async () => {
  const el = await mountBilingualVariant();
  expect(placeholders(el)).toEqual(["Roasted in house", "Tostado en casa"]);
  await input(el, "description-en", "Served in a glass");
  expect(placeholders(el)).toEqual(["", ""]);
  await input(el, "description-en", "  ");
  expect(placeholders(el)).toEqual(["Roasted in house", "Tostado en casa"]);
});

it("shows no description hint on a variant that already describes itself in one language", async () => {
  const el = await mountBilingualVariant({ es: "Servido en vaso" });
  expect(placeholders(el)).toEqual(["", ""]);
});

it("saves a variant's description as null once every language is blanked again", async () => {
  const el = await mountBilingualVariant({ en: "Served in a glass", es: "Servido en vaso" });
  await input(el, "description-en", "");
  await input(el, "description-es", " ");
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.description).toBeNull();
});

it("never hints a variant's names from the parent's", async () => {
  const el = await mountVariant({ ...glass, customerName: null, kitchenName: null });
  for (const name of ["name", "customer-name-en", "kitchen-name"])
    expect(control<{ placeholder: string }>(el, name).placeholder, name).toBe("");
});

it("offers each inherited choice first as 'Same as' the parent's value, with an empty value", async () => {
  const el = await mountVariant();
  await openUnits(el);
  const expected = {
    tax: sameAs("Reduced (10%)"),
    unit: sameAs("Litre (l)"),
    "product-station": sameAs("Bar"),
    "product-course": sameAs("Mains"),
  };
  for (const [name, text] of Object.entries(expected)) {
    const option = firstOption(el, name);
    expect(option.value, name).toBe("");
    expect(option.textContent!.trim(), name).toBe(text);
    expect(control<HTMLSelectElement>(el, name).value, name).toBe("");
  }
  // "Each" stands for NO unit on a product of its own; on a variant no unit means the parent's, so
  // the synthetic Each choice would say one thing and save another.
  expect([...control<HTMLSelectElement>(el, "unit").options].map((option) => option.value)).toEqual(
    ["", unit.id, litre.id],
  );
  // The price field's unit button names the unit the variant sells in: the parent's.
  expect(control<{ unit: string }>(el, "unit-price").unit).toBe(
    t("editor.per_unit").replace("{unit}", "l"),
  );
});

it("marks a variant's own choice selected over the 'Same as' option", async () => {
  const el = await mountVariant({
    ...glass,
    vatClass: "general",
    stationId: "grill",
    courseId: "desserts",
  });
  expect(control<HTMLSelectElement>(el, "tax").value).toBe("general");
  expect(control<HTMLSelectElement>(el, "product-station").value).toBe("grill");
  expect(control<HTMLSelectElement>(el, "product-course").value).toBe("desserts");
});

it("hints the parent's categories, allergens, dietary declarations and photo beside their controls", async () => {
  const el = await mountVariant();
  expect(hint(el, "categories-hint")).toBe(
    `${sameAs("Bebidas, Aperitivos")} · ${t("editor.reporting_category")}: Bebidas`,
  );
  expect(hint(el, "allergens-hint")).toBe(
    `${t("modifiers.allergens")}: ${sameAs(allergenName("milk"))}`,
  );
  expect(hint(el, "dietary-hint")).toBe(
    `${t("modifiers.dietary_preferences")}: ${sameAs(t("editor.diet.vegetarian"))}`,
  );
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  expect(upload.inheritedImage).toBe("coffee.png");
  expect(upload.image).toBeNull();
});

it("drops a hint once the variant sets that field itself", async () => {
  const el = await mountVariant({
    ...glass,
    categoryIds: ["plates"],
    primaryCategoryId: "plates",
    allergens: { gluten: { presence: "contains" } },
    dietaryDeclarations: ["vegan"],
  });
  expect(hint(el, "categories-hint")).toBeUndefined();
  expect(hint(el, "allergens-hint")).toBeUndefined();
  expect(hint(el, "dietary-hint")).toBeUndefined();
});

it("saves every field a variant left blank as null, so it keeps reading the parent's", async () => {
  const el = await mountVariant();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  const value = submit.mock.calls[0]![0].detail.value;
  expect(value).toMatchObject({
    name: "Glass of coffee",
    unitPrice: null,
    vatClass: null,
    unitId: null,
    stationId: null,
    courseId: null,
    description: null,
    image: null,
    allergens: null,
    dietaryDeclarations: null,
    categoryIds: [],
    primaryCategoryId: null,
    variants: [],
    modifiers: [],
    parentId: "coffee",
  });
  // The parent's values are a hint for this screen, not part of what it saves.
  expect("inherited" in value).toBe(false);
});

it("saves a value typed into a variant's field, and null once it is cleared again", async () => {
  const el = await mountVariant();
  await input(el, "unit-price", "4.50");
  const tax = control<HTMLSelectElement>(el, "tax");
  tax.value = "general";
  tax.dispatchEvent(new Event("change"));
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    unitPrice: "4.50",
    vatClass: "general",
  });
  // A second save needs the first one settled.
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  await input(el, "unit-price", "");
  tax.value = "";
  tax.dispatchEvent(new Event("change"));
  await el.updateComplete;
  save(el);
  expect(submit.mock.calls[1]![0].detail.value).toMatchObject({ unitPrice: null, vatClass: null });
});

it("reads an emptied allergen or dietary choice on a variant as inheriting, never as 'none'", async () => {
  const el = await mountVariant({
    ...glass,
    allergens: { gluten: { presence: "contains" } },
    dietaryDeclarations: ["vegan"],
  });
  el.shadowRoot!.querySelector("dashboard-allergen-dietary-picker")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: { allergens: [], dietary: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  // An empty overlay would declare the glass free of the milk its parent contains.
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    allergens: null,
    dietaryDeclarations: null,
  });
});

it("refuses a variant's price that is not a plain amount", async () => {
  const el = await mountVariant();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "unit-price", "-1");
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(control<{ error: string }>(el, "unit-price").error).toBe(t("editor.price_invalid"));
});

it("paints a variant's description hint from the muted-text token", async () => {
  const el = await mountVariant();
  el.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const description = control<HTMLTextAreaElement>(el, "description-en");
  expect(getComputedStyle(description, "::placeholder").color).toBe("rgb(7, 8, 9)");
});

/** How many lines `text` takes up inside `cell`: one rectangle per line the browser wrapped it onto. */
function linesOf(cell: Element, text: string): number {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent!.indexOf(text);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  }
  throw new Error(`"${text}" is not in the cell`);
}

const phoneCases = [
  { locale: "en-GB", scaled: false, unitId: unit.id },
  { locale: "es-ES", scaled: false, unitId: unit.id },
  { locale: "es-ES", scaled: false, unitId: null },
  { locale: "en-GB", scaled: true, unitId: null },
  { locale: "es-ES", scaled: true, unitId: unit.id },
  { locale: "es-ES", scaled: true, unitId: null },
];

// A wider font and a longer language are what CI's Linux fonts and a real phone bring, so each case
// is also run with every text size raised to a larger token, and each again in Verdana, whose widths
// are close to CI's Linux fonts, so a Mac sees what CI sees; a machine without Verdana falls back to
// the usual family. English and Spanish label the columns differently, and a product with no unit
// gives the price field's unit button its longest name. A four-digit price is the widest amount a
// row is likely to carry, and it must never break inside the number.
it.each([
  ...phoneCases.map((phone) => ({ ...phone, font: "default" })),
  ...phoneCases.map((phone) => ({ ...phone, font: "Verdana" })),
])(
  "keeps every variant row's menu on screen at phone width, with no sideways scroll ($locale, larger text: $scaled, unit: $unitId, font: $font)",
  async ({ locale, scaled, unitId, font }) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      setLocale(locale);
      // `page.viewport` resizes the frame the widget renders in; resizing the outer page does not.
      await page.viewport(390, 844);
      expect(window.innerWidth).toBe(390);
      const { el, host } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: {
          ...product,
          unitId,
          variants: [
            { ...small, name: "Vino tinto de la casa, copa grande 125 ml", unitPrice: null },
            { ...large, name: "Vino 175 ml" },
            { ...large, id: "w250", name: "Vino 250 ml", unitPrice: "1250.00" },
          ],
        },
        locales: ["en"],
        units: [unit],
        taxChoices: reduced,
      });
      if (scaled) {
        host.style.setProperty("--wt-font-size-sm", "var(--wt-font-size-lg)");
        host.style.setProperty("--wt-font-size-md", "var(--wt-font-size-xl)");
      }
      if (font === "Verdana") {
        const family = getComputedStyle(host).getPropertyValue("--wt-font-family");
        expect(family).not.toBe("");
        host.style.setProperty("--wt-font-family", `Verdana, ${family}`);
      }
      const table = variantTable(el)!;
      await table.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const wrap = table.shadowRoot!.querySelector<HTMLElement>(".wrap")!;
      // A table that fits never needs its own scroller. That alone does not put the menus on the
      // screen: a table forced wider widens the box around it too, so each menu is also held to
      // the frame's own right edge.
      expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth);
      const edge = wrap.getBoundingClientRect().right;
      for (const index of [0, 1, 2]) {
        const menu = table.shadowRoot!.querySelector(`[data-test="actions-${index}"]`)!;
        const right = menu.getBoundingClientRect().right;
        expect(right, `row ${index}`).toBeLessThanOrEqual(edge);
        expect(right, `row ${index} against the screen`).toBeLessThanOrEqual(window.innerWidth);
      }
      // On a phone each price sits under its variant's name, and the price column is gone.
      const rows = [...table.shadowRoot!.querySelectorAll("tbody tr")];
      for (const row of rows) expect(row.children[2]!.getClientRects()).toHaveLength(0);
      const cells = rows.map((row) => row.children[1]!);
      expect(linesOf(cells[0]!, "9.00"), "the base price the first row falls back to").toBe(1);
      expect(linesOf(cells[1]!, "3.00")).toBe(1);
      expect(linesOf(cells[2]!, "1250.00")).toBe(1);
      // Kept on one line, an amount wider than the name column would run over the switch beside it.
      for (const cell of cells) {
        const amount = cell.querySelector(".amount")!.getBoundingClientRect();
        expect(amount.width).toBeGreaterThan(0);
        expect(amount.right).toBeLessThanOrEqual(cell.getBoundingClientRect().right);
      }
      const available = table.shadowRoot!.querySelectorAll("thead th")[3]!;
      expect(linesOf(available, t("editor.available")), "the Available heading").toBe(1);
      // The heading's unit select goes with the price column. The unit stays one tap away on the
      // price field above the table, whose unit button changes the same unit.
      const unitSelect = table.shadowRoot!.querySelector('select[name="pricing-unit"]')!;
      expect(unitSelect.getClientRects()).toHaveLength(0);
      const unitButton = el
        .shadowRoot!.querySelector('wt-price-input[name="unit-price"]')!
        .shadowRoot!.querySelector("button.unit")!
        .getBoundingClientRect();
      const tapMin = parseFloat(getComputedStyle(table).getPropertyValue("--wt-tap-min"));
      expect(tapMin).toBeGreaterThan(0);
      expect(unitButton.height).toBeGreaterThanOrEqual(tapMin);
      expect(unitButton.width).toBeGreaterThanOrEqual(tapMin);
      expect(unitButton.right).toBeLessThanOrEqual(window.innerWidth);
    } finally {
      setLocale("es-ES");
      await page.viewport(width, height);
    }
  },
);

it("holds Open, saying why, while the product has changes not yet saved, and frees it once they match", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const table = () => variantTable(el) as unknown as { openBlocked: boolean };
  const opened = vi.fn();
  el.addEventListener("wt-open-product", opened);
  expect(table().openBlocked).toBe(false);
  await input(el, "name", "Coffee to go");
  expect(table().openBlocked).toBe(true);
  // The row's own guard is not the only one: an Open that reaches the editor anyway is ignored.
  await tableEvent(el, "wt-open", { index: 0 });
  expect(opened).not.toHaveBeenCalled();
  await input(el, "name", "Coffee");
  expect(table().openBlocked).toBe(false);
  await tableEvent(el, "wt-open", { index: 0 });
  expect(opened).toHaveBeenCalledOnce();
});

it("counts a variant edit that ends where it started as no change, whatever order its fields come in", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await tableEvent(el, "wt-remove", { index: 1 });
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(true);
  await tableEvent(el, "wt-restore", { index: 1 });
  // The window hands a variant back as a NEW object with its keys in its own order.
  const reordered = Object.fromEntries(Object.entries(small).reverse()) as EditorVariant;
  await tableEvent(el, "wt-edit", { index: 0 });
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", { detail: { value: reordered }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(false);
});

it("frees Open once a save hands the editor the saved product back", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await input(el, "name", "Coffee to go");
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(true);
  el.value = { ...product, name: "Coffee to go", variants: [small, large] };
  await el.updateComplete;
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(false);
});

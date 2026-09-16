import { afterEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ProductEditor, productEditorField } from "./product-editor.js";
import type { EditorVariant, ProductEditorDraft } from "./product-editor-model.js";
import type { CategorySummary } from "../api/client.js";
import { resolveVatRate, priceLockedLines } from "@waitron/catalogue/src/pricing.js";
import { t } from "../i18n/t.js";

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
  available: true,
  vatClass: "reduced",
  variants: [],
  categoryIds: [],
  primaryCategoryId: null,
  modifierIds: [],
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
};
const large: EditorVariant = {
  id: "large",
  name: "Large",
  customerName: { en: "Large cup", es: "Taza grande" },
  kitchenName: "LG",
  image: null,
  unitPrice: "3.00",
  available: false,
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
      unitLabel: string;
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

it("does not submit from the allergen search and retains review state across an unrelated edit", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: {} },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openSection(el, "nutrition");
  const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
  await picker.updateComplete;
  await el.updateComplete;
  const search = picker.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("[data-test=allergen-search]")!;
  await search.updateComplete;
  search
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(submit).not.toHaveBeenCalled();
  picker.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-milk]")!.click();
  await picker.updateComplete;
  await el.updateComplete;
  await input(el, "name", "New coffee");
  expect(picker.value).toEqual({ milk: { presence: "contains" } });
});

it("shows only attached modifiers, attaches from the combobox, reorders and removes", async () => {
  const choices = [
    { id: "milk", name: { en: "Milk" } },
    { id: "sugar", name: { en: "Sugar" } },
    { id: "ice", name: { en: "Ice" } },
  ];
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifierIds: ["milk", "sugar"] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    modifiers: choices,
  });
  const rows = () => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=attached-modifier]"),
  ];
  expect(rows().map((row) => row.dataset.modifier)).toEqual(["milk", "sugar"]);
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { options: { value: string }[] }>(
    "[data-test=add-modifier]",
  )!;
  // Only the unattached modifier is offered, beside the create entry.
  expect(combobox.options.map((option) => option.value)).toEqual(["create", "ice"]);
  combobox.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "ice" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.modifierIds).toEqual(["milk", "sugar", "ice"]);
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-ice"]')!;
  handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await el.updateComplete;
  expect(el.currentValue.modifierIds).toEqual(["milk", "ice", "sugar"]);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-modifier-milk]")!.click();
  await el.updateComplete;
  expect(el.currentValue.modifierIds).toEqual(["ice", "sugar"]);
});

it("asks the screen to create a modifier, and to edit an attached one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifierIds: ["milk"] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
    modifiers: [{ id: "milk", name: { en: "Milk" } }],
  });
  const create = vi.fn();
  const edit = vi.fn();
  el.addEventListener("wt-create-related", create);
  el.addEventListener("wt-edit-related", edit);
  el.shadowRoot!.querySelector("[data-test=add-modifier]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "create" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "modifier" });
  // The create entry is a command, not a membership: it must not attach itself to the product.
  expect(el.currentValue.modifierIds).toEqual(["milk"]);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-modifier-milk]")!.click();
  expect(edit.mock.calls[0]![0].detail).toEqual({ kind: "modifier", id: "milk" });
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

it("shows inferred dietary badges without saving them as declarations", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, dietaryDeclarations: ["vegan", "halal"] },
    locales: ["en"],
  });
  await openSection(el, "nutrition");
  expect(
    [...el.shadowRoot!.querySelectorAll("[data-test=derived-diet]")].map((node) =>
      node.getAttribute("data-label"),
    ),
  ).toEqual(["vegetarian", "no_meat", "no_fish"]);
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

it("turns the plain price into a Regular variant on the first Add variant and opens the new one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  expect(variantTable(el)).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  expect(el.currentValue.variants).toEqual([
    {
      name: t("editor.variant_regular"),
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "9.00",
      available: true,
    },
  ]);
  // The window that opens is for the SECOND variant, not for the one the price just became.
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
  expect(el.currentValue.variants.map((variant) => variant.name)).toEqual([
    t("editor.variant_regular"),
    "Small",
  ]);
  expect(variantForm(el).open).toBe(false);
  expect(variantTable(el)!.variants).toHaveLength(2);
});

it("folds the lone variant back into the plain price when the second one is cancelled", async () => {
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
  // A draft never holds exactly one variant: the server refuses that shape outright.
  expect(el.currentValue.variants).toEqual([]);
  expect(el.currentValue.unitPrice).toBe("9.00");
  expect(variantTable(el)).toBeNull();
});

it("folds a removed second variant's sibling price back into the plain price field", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  const table = variantTable(el)!;
  expect(table.variants).toEqual([small, large]);
  table.dispatchEvent(
    new CustomEvent("wt-remove", { detail: { index: 1 }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.currentValue.variants).toEqual([]);
  expect(el.currentValue.unitPrice).toBe("2.00");
  expect(
    (el.shadowRoot!.querySelector("[name=unit-price]") as HTMLElement & { value: string }).value,
  ).toBe("2.00");
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
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  expect(variantTable(el)!.unitLabel).toBe("ea");
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
    available: true,
    vatClass: "general",
    variants: [],
    categoryIds: [],
    primaryCategoryId: null,
    modifierIds: [],
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

it("refuses the first Add variant while the price it would copy is invalid", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  await input(el, "unit-price", "-1");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  // Folding it would carry the bad price into a variant and take the field it lives in off screen,
  // leaving a save nobody can fix: the plain price is no longer checked once variants exist.
  expect(el.currentValue.variants).toEqual([]);
  expect(el.currentValue.unitPrice).toBe("-1");
  expect(variantForm(el).open).toBe(false);
  const price = el.shadowRoot!.querySelector<HTMLElement & { error: string }>("[name=unit-price]")!;
  expect(price.error).toBe(t("editor.price_invalid"));
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe("unit-price");
  await input(el, "unit-price", "4.00");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  expect(el.currentValue.variants.map((variant) => variant.unitPrice)).toEqual(["4.00"]);
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

it("opens the unit dropdown from the button beside Add variant", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: reduced,
  });
  // With variants there is no price field, so its unit button is gone too — without this control
  // the product's unit could never be changed again.
  expect(el.shadowRoot!.querySelector("[name=unit]")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-unit]")!.click();
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=unit]")!;
  expect(select.value).toBe(unit.id);
  select.value = "";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  expect(el.currentValue.unitId).toBeNull();
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
    t("editor.unit_each"),
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
      `(${Number(resolveVatRate(option.value as ProductEditorDraft["vatClass"]))}%)`,
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

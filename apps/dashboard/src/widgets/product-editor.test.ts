import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import { resolveVatRate, priceLockedLines } from "@waitron/catalogue/src/pricing.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);
const unit = { id: "unit-each", name: { en: "Each" }, abbreviation: { en: "ea" } };
const product: ProductEditorDraft = {
  name: { en: "Coffee", es: "Café" },
  description: { en: "Freshly roasted" },
  kitchenName: "BAR",
  image: null,
  unitId: unit.id,
  unitPrice: "9.00",
  available: true,
  vatClass: "reduced",
  variants: [
    { id: "small", name: { en: "Small", es: "Pequeño" }, unitPrice: "2.00", available: true },
  ],
  categoryIds: [],
  primaryCategoryId: null,
  modifierIds: [],
  allergens: null,
  dietaryDeclarations: [],
};
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

it("labels a unit option as its name then abbreviation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [{ id: "u", name: { en: "Kilogram" }, abbreviation: { en: "kg" } }],
  });
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
  const option = el.shadowRoot!.querySelector<HTMLOptionElement>(
    'select[name="unit"] option[value="u"]',
  )!;
  expect(option.textContent!.trim()).toBe("Portion");
});

it("keeps names, descriptions, kitchen name and variant prices independent", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name-en", "Espresso");
  await input(el, "description-en", "Dark roast");
  await input(el, "kitchen-name", "BAR ESPRESSO");
  await input(el, "variant-0-price", "2.50");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    ...product,
    name: { en: "Espresso", es: "Café" },
    description: { en: "Dark roast" },
    kitchenName: "BAR ESPRESSO",
    variants: [{ ...product.variants[0], unitPrice: "2.50" }],
  });
});

it("retains a dirty draft through child open, lookup refresh and cancellation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
  });
  await input(el, "name-en", "Dirty coffee");
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!.click();
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "unit" });
  el.childOpen = true;
  await el.updateComplete;
  save(el);
  const field = el.shadowRoot!.querySelector<HTMLElement>("[name=name-en]")!;
  await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  field
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(submit).not.toHaveBeenCalled();
  el.units = [...el.units, { id: "custom", name: { en: "Custom" }, abbreviation: {} }];
  el.childOpen = false;
  await el.updateComplete;
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.name).toEqual({ en: "Dirty coffee", es: "Café" });
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
  expect(summary.errors.length).toBeGreaterThanOrEqual(3);
  expect((el.shadowRoot!.querySelector("[name=unit-price]") as HTMLInputElement).value).toBe("-1");
});

it("does not submit from the allergen search and retains review state across an unrelated edit", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: {} },
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
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
  await input(el, "name-en", "New coffee");
  expect(picker.value).toEqual({ milk: { presence: "contains" } });
});

it("shows only selected memberships and lets you search, add, reorder and remove", async () => {
  const choices = [
    { id: "milk", name: { en: "Milk" } },
    { id: "sugar", name: { en: "Sugar" } },
    { id: "ice", name: { en: "Ice" } },
  ];
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifierIds: ["milk", "sugar"] },
    locales: ["en"],
    modifiers: choices,
  });
  expect(el.shadowRoot!.querySelectorAll("[data-test=selected-modifier]")).toHaveLength(2);
  expect(el.shadowRoot!.querySelector("[name=modifier-ice]")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=pick-modifier]")!.click();
  await el.updateComplete;
  await input(el, "membership-search", "ice");
  expect(el.shadowRoot!.querySelectorAll("[data-test=membership-choice]")).toHaveLength(1);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=membership-choice]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=modifier-up]")[2]!.click();
  await el.updateComplete;
  expect(el.currentValue.modifierIds).toEqual(["milk", "ice", "sugar"]);
  el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=modifier-remove]")[0]!.click();
  await el.updateComplete;
  expect(el.currentValue.modifierIds).toEqual(["ice", "sugar"]);
});

it("saves a product with categories and no reporting category", async () => {
  const categories = [
    { id: "drinks", name: { en: "Drinks" } },
    { id: "snacks", name: { en: "Snacks" } },
  ];
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, categoryIds: ["drinks", "snacks"], primaryCategoryId: "drinks" },
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
    categories,
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  const reporting = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=reporting-category]")!;
  reporting.value = "";
  reporting.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.primaryCategoryId).toBeNull();
  expect(
    el.shadowRoot!.querySelector<HTMLElement & { errors: string[] }>("wt-form-error-summary")!
      .errors,
  ).toEqual([]);
});

it("flags a reporting category that is not one of the selected categories", async () => {
  const categories = [
    { id: "drinks", name: { en: "Drinks" } },
    { id: "snacks", name: { en: "Snacks" } },
  ];
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, categoryIds: ["drinks"], primaryCategoryId: "snacks" },
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
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
  for (const name of ["unit", "tax"]) {
    const select = el.shadowRoot!.querySelector(`[name=${name}]`)!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const error = el.shadowRoot!.getElementById(select.getAttribute("aria-describedby")!);
    expect(error?.textContent?.trim()).toBeTruthy();
  }
  expect(el.shadowRoot!.getElementById("tax-error")!.textContent).toBe(
    "Tax is no longer available",
  );
});

it("reorders variants without replacing their identities and saves only once", async () => {
  const large = { id: "large", name: { en: "Large" }, unitPrice: "3.00", available: true };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [...product.variants, large] },
    locales: ["en"],
    units: [unit],
    taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=variant-down]")!.click();
  await el.updateComplete;
  await input(el, "variant-0-name-en", "Very large");
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.variants).toEqual([
    { ...large, name: { en: "Very large" } },
    product.variants[0],
  ]);
});

it("keeps station and course routing available for an existing product", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "product-1", stationId: "station-1", courseId: "course-1" },
    locales: ["en"],
    units: [unit],
    stations: [
      { id: "station-1", name: "Bar" },
      { id: "station-2", name: "Kitchen" },
    ],
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  const station = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-station]")!;
  const course = el.shadowRoot!.querySelector<HTMLSelectElement>("[name=product-course]")!;
  expect(station.value).toBe("station-1");
  expect(course.value).toBe("course-1");
  const stationChanged = vi.fn();
  const courseChanged = vi.fn();
  el.addEventListener("wt-set-product-station", stationChanged);
  el.addEventListener("wt-set-product-course", courseChanged);
  station.value = "station-2";
  station.dispatchEvent(new Event("change"));
  course.value = "";
  course.dispatchEvent(new Event("change"));
  expect(stationChanged.mock.calls[0]![0].detail).toEqual({
    productId: "product-1",
    stationId: "station-2",
  });
  expect(courseChanged.mock.calls[0]![0].detail).toEqual({
    productId: "product-1",
    courseId: null,
  });
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
      descriptions: { en: "Fixture" },
      category: null,
    },
  ]);
  expect(priced.vatBreakdown).toEqual([{ rate: "2.50", base: "100.00", tax: "2.50" }]);
});

import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import type { ProductNutritionPicker } from "./product-nutrition-picker.js";

registerIcons(DASHBOARD_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const product: ProductEditorDraft = {
  id: "bread",
  name: "Bread",
  customerName: { en: "House loaf" },
  kitchenName: "BAKE",
  description: null,
  image: null,
  unitId: null,
  unitPrice: "3.00",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [],
  primaryCategoryId: null,
  color: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
  courseId: null,
};
const parent = {
  name: "Bread",
  unitPrice: "3.00",
  vatClass: "reduced" as const,
  unitId: null,
  primaryCategoryId: null,
  courseId: null,
  description: null,
  image: null,
  allergens: { gluten: { kinds: ["barley" as const] }, nuts: { kinds: ["almonds" as const] } },
  dietaryDeclarations: ["vegan" as const],
};
async function mount(value: ProductEditorDraft = product) {
  setLocale("en");
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value,
    locales: ["en"],
  });
  const fold = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-section="nutrition"]',
  )!;
  await fold.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  return { el, fold, submit };
}
async function open(el: ProductEditor) {
  const fold = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-section="nutrition"]',
  )!;
  if (!fold.open) {
    await userEvent.click(fold.shadowRoot!.querySelector("button")!);
    await fold.updateComplete;
  }
  // A moving section can carry a chip away between pointer-down and pointer-up.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const body = fold.shadowRoot!.querySelector<HTMLElement>(".body")!;
  await Promise.all(body.getAnimations().map((animation) => animation.finished));
  const picker = el.shadowRoot!.querySelector<ProductNutritionPicker>(
    "dashboard-product-nutrition-picker",
  );
  expect(picker).not.toBeNull();
  await picker!.updateComplete;
  return picker!;
}
async function pick(el: ProductEditor, choice: string) {
  const picker = await open(el);
  const button = picker.shadowRoot!.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`);
  expect(button, choice).not.toBeNull();
  // Exercise a press long enough for an unfinished opening animation to move the target.
  await userEvent.click(button!, { delay: 150 });
  await el.updateComplete;
  await picker.updateComplete;
}
function save(el: ProductEditor) {
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
}
function saveButton(el: ProductEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
}

it.each<{ label: string; allergens: ProductEditorDraft["allergens"] }>([
  { label: "unreviewed", allergens: null },
  { label: "none", allergens: {} },
  {
    label: "kinds",
    allergens: { gluten: { kinds: ["wheat" as const] }, nuts: { kinds: ["walnuts" as const] } },
  },
])("nutrition diet-only save preserves $label allergens", async ({ allergens }) => {
  const { el, submit } = await mount({ ...product, allergens });
  await pick(el, "diet-halal");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    allergens,
    dietaryDeclarations: ["halal"],
  });
});

it("nutrition keeps incomplete kinds dirty and marks both fields after an attempted save", async () => {
  const { el, fold, submit } = await mount({ ...product, allergens: {} });
  expect(saveButton(el).disabled).toBe(true);
  await pick(el, "allergen-gluten");
  await pick(el, "allergen-nuts");
  expect(saveButton(el).disabled).toBe(false);
  expect(el.shadowRoot!.querySelector('[data-test="allergen-error"]')).toBeNull();
  save(el);
  await el.updateComplete;
  const picker = await open(el);
  expect(submit).not.toHaveBeenCalled();
  expect(fold.open).toBe(true);
  expect(picker.shadowRoot!.querySelector("#allergens-gluten-error")!.textContent).toBe(
    "Choose which cereals",
  );
  expect(picker.shadowRoot!.querySelector("#allergens-nuts-error")!.textContent).toBe(
    "Choose which nuts",
  );
  expect(saveButton(el).disabled).toBe(true);
  await expect
    .poll(() => picker.shadowRoot!.activeElement?.getAttribute("name"))
    .toBe("allergens-gluten");
  await pick(el, "kind-gluten-wheat");
  expect(saveButton(el).disabled).toBe(true);
  await pick(el, "kind-nuts-walnuts");
  expect(saveButton(el).disabled).toBe(false);
  expect(picker.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.allergens).toEqual({
    gluten: { kinds: ["wheat"] },
    nuts: { kinds: ["walnuts"] },
  });
});

it("nutrition saves explicit None on a variant without replacing its dietary inheritance", async () => {
  const { el, submit } = await mount({
    ...product,
    id: "slice",
    parentId: "bread",
    inherited: parent,
    allergens: null,
    dietaryDeclarations: null,
  });
  await pick(el, "none");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    allergens: {},
    dietaryDeclarations: null,
  });
});

it("nutrition Same as saves null while keeping the variant's explicit diet", async () => {
  const { el, submit } = await mount({
    ...product,
    id: "slice",
    parentId: "bread",
    inherited: parent,
    allergens: { gluten: { kinds: ["wheat"] }, nuts: { kinds: ["walnuts"] } },
    dietaryDeclarations: ["halal"],
  });
  await pick(el, "same-as");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    allergens: null,
    dietaryDeclarations: ["halal"],
  });
});

it.each<{ allergens: ProductEditorDraft["allergens"]; want: string }>([
  { allergens: null, want: "Allergens: Not yet reviewed · Dietary: None" },
  { allergens: {}, want: "Allergens: None · Dietary: None" },
  {
    allergens: { gluten: { kinds: ["wheat" as const] }, eggs: {}, milk: {} },
    want: "Allergens: Cereals containing gluten (Wheat), Eggs, Milk · Dietary: None",
  },
])("nutrition closed summary distinguishes $want", async ({ allergens, want }) => {
  const { el } = await mount({ ...product, allergens });
  const summary = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nutrition-summary"]');
  expect(summary).not.toBeNull();
  expect(summary!.textContent!.replace(/\s+/g, " ").trim()).toBe(want);
  if (allergens === null)
    expect(
      getComputedStyle(summary!.querySelector('[data-test="nutrition-allergens"]')!).color,
    ).not.toBe(getComputedStyle(summary!).color);
});

it("nutrition summary lists chosen diets before italic implications and inherited allergens in italic", async () => {
  const { el } = await mount({
    ...product,
    parentId: "bread",
    inherited: parent,
    dietaryDeclarations: ["vegan", "halal"],
  });
  const summary = el.shadowRoot!.querySelector<HTMLElement>('[data-test="nutrition-summary"]')!;
  expect(summary).not.toBeNull();
  expect(summary.textContent!.replace(/\s+/g, " ")).toContain(
    "Vegan, Halal, Vegetarian, No meat, No fish",
  );
  const implied = [...summary.querySelectorAll<HTMLElement>("[data-implied]")];
  expect(implied.map((node) => node.textContent)).toEqual(["Vegetarian", "No meat", "No fish"]);
  expect(implied.every((node) => getComputedStyle(node).fontStyle === "italic")).toBe(true);
  expect(
    getComputedStyle(summary.querySelector('[data-test="nutrition-allergens"]')!).fontStyle,
  ).toBe("italic");
});

it("nutrition ignores forged field changes while the editor is suspended", async () => {
  const { el, submit } = await mount();
  const picker = await open(el);
  el.busy = true;
  await el.updateComplete;
  picker.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "allergens", value: {} },
      bubbles: true,
      composed: true,
    }),
  );
  picker.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "dietaryDeclarations", value: ["vegan"] },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  save(el);
  expect(el.currentValue.allergens).toBeNull();
  expect(el.currentValue.dietaryDeclarations).toEqual([]);
  expect(submit).not.toHaveBeenCalled();
});

it("nutrition starts from the replacement record after reset and reopen", async () => {
  const { el } = await mount();
  await pick(el, "allergen-gluten");
  el.open = false;
  await el.updateComplete;
  el.value = {
    ...product,
    id: "soup",
    name: "Soup",
    allergens: { celery: {} },
    dietaryDeclarations: ["halal"],
  };
  el.open = true;
  await el.updateComplete;
  const picker = await open(el);
  expect(el.currentValue.allergens).toEqual({ celery: {} });
  expect(
    picker
      .shadowRoot!.querySelector('[data-choice="allergen-celery"]')!
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(picker.shadowRoot!.querySelector('[data-field="allergens-gluten"]')).toBeNull();
  expect(picker.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  expect(saveButton(el).disabled).toBe(true);
});

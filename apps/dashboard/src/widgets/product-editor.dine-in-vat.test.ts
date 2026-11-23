import { afterEach, expect, it, vi } from "vitest";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

const saved: ProductEditorDraft = {
  id: "p1",
  parentId: null,
  name: "Lemonade",
  customerName: null,
  description: null,
  kitchenName: null,
  image: null,
  unitId: null,
  unitPrice: "3.00",
  active: true,
  available: true,
  ordering: "public",
  // What the editor's read still answers; the save refuses it.
  vatClass: "reduced",
  takeawayVatRate: "10.00",
  variants: [],
  primaryCategoryId: null,
  color: null,
  modifiers: [],
  allergens: null,
  dietaryDeclarations: [],
  courseId: null,
};

const variant: ProductEditorDraft = {
  ...saved,
  id: "v1",
  parentId: "p1",
  name: "Large",
  unitPrice: null,
  vatClass: null,
  takeawayVatRate: null,
  variants: [],
  dietaryDeclarations: null,
  inherited: {
    name: "Lemonade",
    description: null,
    image: null,
    unitPrice: "3.00",
    vatClass: "reduced",
    takeawayVatRate: "10.00",
    unitId: null,
    primaryCategoryId: null,
    courseId: null,
    allergens: null,
    dietaryDeclarations: [],
  },
};

async function mount(props: Partial<ProductEditor>) {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    dineInVatRate: "10.00",
    ...props,
  });
  return el;
}

const note = (el: ProductEditor) =>
  el.shadowRoot!.querySelector("[data-test=dine-in-vat]")?.textContent?.trim();

async function saveBody(el: ProductEditor) {
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  el.shadowRoot!.querySelector('[name="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Lemonade with mint" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  expect(submitted).toHaveBeenCalledOnce();
  return submitted.mock.calls[0]![0].detail.body as Record<string, unknown>;
}

it.each([
  ["a new product", undefined],
  ["a saved product", saved],
  ["a variant", variant],
])("draws no eat-in VAT field on %s and says the one rate instead", async (_, value) => {
  const el = await mount({ value: value ?? null });
  expect(el.shadowRoot!.querySelector('[name="tax"]')).toBeNull();
  expect(note(el)).toBe("Eaten here: 10% (all food and drink)");
});

it("says the rate the way the takeaway field does, in Spanish too", async () => {
  setLocale("es");
  const el = await mount({ dineInVatRate: "7.50" });
  expect(note(el)).toBe(es["editor.dine_in_vat"].replace("{rate}", "7,5"));
  expect(note(el)).toMatch(/: 7,5 % \(/);
});

it("says nothing about the rate before one is known", async () => {
  const el = await mount({ dineInVatRate: "" });
  expect(el.shadowRoot!.querySelector("[data-test=dine-in-vat]")).toBeNull();
});

it.each([
  ["a new product", undefined],
  ["a saved product whose read names a VAT class", saved],
  ["a variant", variant],
])("saves %s with no VAT class in the body", async (_, value) => {
  const el = await mount({
    value: value ?? null,
    takeawayVat: true,
    vatRates: ["10.00"],
    defaultTakeawayVatRate: "10.00",
  });
  const body = await saveBody(el);
  expect(body).not.toHaveProperty("vatClass");
  expect(body.takeawayVatRate).toBe(value === variant ? null : "10.00");
});

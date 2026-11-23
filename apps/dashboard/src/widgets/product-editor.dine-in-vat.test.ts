import { afterEach, expect, it, vi } from "vitest";
import { setHelpMode, type WtHelpTooltip } from "@waitron/ui";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

afterEach(() => {
  setHelpMode(false);
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

async function badgeOf(el: ProductEditor): Promise<WtHelpTooltip> {
  const badge = el.shadowRoot!.querySelector<WtHelpTooltip>(".dine-in-vat > wt-help-tooltip")!;
  expect(badge).not.toBeNull();
  await badge.updateComplete;
  return badge;
}

it.each([
  [false, "help.products.dine_in_vat"],
  [true, "help.products.dine_in_vat_takeaway"],
] as const)(
  "puts a help badge beside the rate, shown only while help is on (takeaway field %s)",
  async (takeawayVat, key) => {
    const el = await mount({ takeawayVat, vatRates: ["10.00"] });
    const badge = await badgeOf(el);
    expect(badge.getAttribute("mode")).toBe("help-mode");
    expect(badge.checkVisibility()).toBe(false);
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expect
      .element(badge.shadowRoot!.querySelector("button")!)
      .toHaveAccessibleName("Help: VAT");
    expect(badge.textContent!.trim()).toBe(t(key));
    expect(badge.getAttribute("guide-href")).toBe("/help/en/products#vat");
    expect(badge.getAttribute("guide-label")).toBe(t("help.guide_link"));
    // The note itself reads the rate alone, not the bubble's text.
    expect(note(el)).toBe("Eaten here: 10% (all food and drink)");
  },
);

it("words the help as staff read it, saying the takeaway rate is chosen per product only beside that field", () => {
  expect(t("help.products.dine_in_vat")).toBe(
    "Everything eaten or drunk here is charged this one rate, whatever the product. Waitron updates it when the law changes; there is nothing to set.",
  );
  expect(t("help.products.dine_in_vat_takeaway")).toBe(
    "Everything eaten or drunk here is charged this one rate, whatever the product. Waitron updates it when the law changes; there is nothing to set. Taken away, each product is charged the rate chosen for it below.",
  );
});

it("reads the Spanish help and links the Spanish guide in Spanish", async () => {
  setLocale("es");
  const el = await mount({});
  setHelpMode(true);
  const badge = await badgeOf(el);
  await expect
    .element(badge.shadowRoot!.querySelector("button")!)
    .toHaveAccessibleName(es["help.badge_label"].replace("{part}", es["product.vat"]));
  expect(badge.textContent!.trim()).toBe(es["help.products.dine_in_vat"]);
  expect(badge.getAttribute("guide-href")).toBe("/help/es/products#vat");
});

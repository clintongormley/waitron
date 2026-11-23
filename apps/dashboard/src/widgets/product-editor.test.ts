import { allergensFromChoices } from "./allergen-choices.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  registerIcons,
  setContentLanguages,
  setHelpMode,
  type ComboboxOption,
  type WtHelpTooltip,
  type WtTextarea,
} from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import {
  mediaTestReference,
  useMediaPresentations,
  chooseOption,
  formMessageOf,
  middleWithin,
  textLines,
} from "@waitron/ui/src/test-helpers.js";
import { EACH_CHOICE, ProductEditor, productEditorField } from "./product-editor.js";
import type { EditorVariant, ProductEditorDraft, UnitChoice } from "./product-editor-model.js";
import type { CategorySummary, ExtraList, OptionList } from "../api/client.js";
import type { InheritedValues } from "@waitron/shared";
import { formatMoney } from "@waitron/shared";
import { es } from "../i18n/strings.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { allergenName, vatRateText } from "../i18n/domain.js";

// The app registers these at startup; without them every icon in the editor — the "+" chip, both
// chevrons, the drag grips, the row menus — renders EMPTY, and a suite that never draws the chrome
// cannot catch a defect in it.
useMediaPresentations();
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
beforeEach(() => setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] }));

it.each([0, 150])(
  "keeps unreviewed allergens null when only a dietary label is saved (press %s ms)",
  async (delay) => {
    const el = await mountPricing({ ...saved, allergens: null, dietaryDeclarations: [] });
    await openSection(el, "details");
    const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
    await picker.updateComplete;
    await userEvent.click(
      picker.shadowRoot!.querySelector<HTMLElement>('[data-choice="diet-vegan"]')!,
      { delay },
    );
    await el.updateComplete;
    expect(el.currentValue.dietaryDeclarations).toEqual(["vegan"]);
    const submit = vi.fn();
    el.addEventListener("wt-submit", submit);
    save(el);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0].detail.value.allergens).toBeNull();
    expect(submit.mock.calls[0]![0].detail.value.dietaryDeclarations).toEqual(["vegan"]);
  },
);

it("keeps a variant's explicit empty diet when only its allergens change", async () => {
  const el = await mountVariant({ ...glass, dietaryDeclarations: [] });
  el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "allergens", value: allergensFromChoices(["eggs"]) },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.allergens).toEqual({ eggs: {} });
  expect(submit.mock.calls[0]![0].detail.value.dietaryDeclarations).toEqual([]);
});

it.each([
  { locale: "en-GB", labels: ["Each", "Apple (a)", "Litre (su)", "Zucchini (z)"] },
  {
    locale: "es-ES",
    labels: [es["editor.unit_each"], "Aubergine (z)", "Litre (su)", "Zed apple (a)"],
  },
])(
  "sorts pricing units in the dashboard language $locale in a Catalan venue",
  async ({ locale, labels }) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      setContentLanguages({ defaultLanguage: "ca", languages: ["ca", "es", "en"] });
      const units: UnitChoice[] = [
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          id: "random-first",
          name: { ca: "CA aubergine", en: "Zucchini", es: "Aubergine" },
          abbreviation: { ca: "ca-z", en: "z", es: "z" },
        },
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          id: "random-middle",
          name: { ca: "Litre", en: "  " },
          abbreviation: {},
        },
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          id: "random-last",
          name: { ca: "CA apple", en: "Apple", es: "Zed apple" },
          abbreviation: { ca: "ca-a", en: "a", es: "a" },
        },
      ];
      const original = structuredClone(units);
      const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        locales: ["ca", "es", "en"],
        units,
      });
      await openUnits(el);
      expect(combobox(el, "unit")!.options.map((option) => option.label)).toEqual(labels);
      expect(combobox(el, "unit")!.options.map((option) => option.value)).toEqual([
        EACH_CHOICE,
        ...(locale === "en-GB"
          ? ["random-last", "random-middle", "random-first"]
          : ["random-first", "random-middle", "random-last"]),
      ]);
      const field = combobox(el, "unit")!;
      await field.updateComplete;
      field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
      await field.updateComplete;
      expect(
        [...field.shadowRoot!.querySelectorAll('[role="option"]')].map((row) =>
          row.textContent!.trim(),
        ),
      ).toEqual(labels);
      expect(units).toEqual(original);
    } finally {
      setLocale(before);
    }
  },
);
const unit = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
  id: "unit-each",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
};
// Staff name and customer name differ in every fixture on purpose: an assertion cannot tell the two
// apart when they hold the same text.
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
  ordering: "public",
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
const categories: CategorySummary[] = [
  { id: "drinks", name: "Drinks", parentId: null, color: null },
  { id: "snacks", name: "Appetisers", parentId: null, color: null },
  // A category with no colour of its own: the reporting mark has to survive this one being chosen.
  { id: "plates", name: "Plates", parentId: null, color: null },
];

it.each([false, true])(
  "A647 starts Details folded and keeps price, variants and extras open with variants=%s",
  async (hasVariants) => {
    const el = await mountPricing({ ...saved, variants: hasVariants ? [small] : [] });
    const folds = [...el.shadowRoot!.querySelectorAll(".form wt-disclosure")];
    expect(folds.map((fold) => (fold as HTMLElement).dataset.section)).toEqual(["details"]);
    expect(folded(el, "details").open).toBe(false);
    await input(el, "name", "Draft coffee");
    expect(folded(el, "details").open).toBe(false);
    expect(group(el, "price").querySelector("[name=unit-price]")).not.toBeNull();
  },
);

it("A647 shows attached modifiers with no click", async () => {
  const el = await mountPricing(
    { ...saved, modifiers: [{ kind: "extras", id: "sauces" }] },
    {
      extraLists: [{ id: "sauces", name: "Sauces" }],
    },
  );
  const modifiers = group(el, "modifiers");
  expect(modifiers.closest("wt-disclosure")).toBeNull();
  expect(modifiers.querySelector("[data-test=modifier-name]")!.textContent).toContain("Sauces");
});

it("orders the form as three cards: identity, Details, then price with variants and extras", async () => {
  const el = await mountPricing(saved);
  const form = el.shadowRoot!.querySelector(".form")!;
  expect([...form.children].map((child) => (child as HTMLElement).dataset.section)).toEqual([
    "identity",
    "details",
    "price",
  ]);
  const identity = form.querySelector('[data-section="identity"]')!;
  expect([...identity.children].map((child) => (child as HTMLElement).dataset.section)).toEqual([
    "categories",
    "name",
    "available",
  ]);
  const price = form.querySelector('[data-section="price"]')!;
  expect([...price.children].map((child) => (child as HTMLElement).dataset.group)).toEqual([
    "price",
    "variants",
    "modifiers",
  ]);
  expect(ownText(group(el, "variants").querySelector("legend")!)).toBe(t("editor.variants"));
  expect(group(el, "modifiers").querySelector("legend")!.textContent!.trim()).toBe(
    t("editor.modifiers"),
  );
  expect(
    [...form.querySelectorAll("wt-disclosure")].map(
      (fold) => (fold as HTMLElement).dataset.section,
    ),
  ).toEqual(["details"]);
  cleanupWidgets();
  const variant = await mountVariant();
  const variantPrice = variant.shadowRoot!.querySelector('.form > [data-section="price"]')!;
  expect([...variantPrice.children].map((child) => (child as HTMLElement).dataset.group)).toEqual([
    "price",
  ]);
});

it("the editor draws three cards on a grey dialog", async () => {
  const el = await mountPricing(saved);
  el.style.setProperty("--wt-color-bg", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-space-4", "16px");
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector(".form")!;
  const cards = [...form.children] as HTMLElement[];
  expect(cards[0]!.matches('wt-card[raised][data-section="identity"]')).toBe(true);
  expect(cards[1]!.matches('wt-disclosure[card][data-section="details"]')).toBe(true);
  expect(cards[2]!.matches('wt-card[raised][data-section="price"]')).toBe(true);
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  expect(getComputedStyle(modal).getPropertyValue("--wt-dialog-surface").trim()).toBe(
    "rgb(1, 2, 3)",
  );
  for (let index = 1; index < cards.length; index++)
    expect(
      cards[index]!.getBoundingClientRect().top - cards[index - 1]!.getBoundingClientRect().bottom,
    ).toBe(16);
});

it.each([
  { label: "active variants", variants: [small] },
  { label: "neither variants nor extras", variants: [] },
])("price, variants and extras are always on screen ($label)", async ({ variants }) => {
  const el = await mountPricing({ ...saved, variants });
  for (const field of [
    "[name=unit-price]",
    "[data-test=add-variant]",
    "wt-combobox[name=modifier]",
  ]) {
    const control = el.shadowRoot!.querySelector<HTMLElement>(field)!;
    expect(control, field).not.toBeNull();
    expect(control.closest("wt-disclosure"), field).toBeNull();
    expect(control.getBoundingClientRect().height, field).toBeGreaterThan(0);
  }
  if (variants.length)
    expect(el.shadowRoot!.querySelector("dashboard-variant-table")).not.toBeNull();
});

it("Details shows one summary row per group that has something set", async () => {
  const el = await mountPricing(
    {
      ...saved,
      kitchenName: "BAR",
      customerName: { en: "House coffee" },
      description: { en: "Freshly roasted" },
      allergens: null,
      takeawayVatRate: "4.00",
      ordering: "public",
    },
    { takeawayVat: true, vatRates: pickableRates },
  );
  const rows = folded(el, "details").summaryRows;
  expect(rows.map(({ fields }) => fields.map(({ label }) => label))).toEqual([
    [t("editor.kitchen_name")],
    [t("editor.customer_name"), t("editor.description")],
    [t("modifiers.allergens")],
    [t("editor.takeaway_vat")],
  ]);
  expect(rows[2]!.fields[0]!.warning).toBe(true);
  expect(rows.every(({ lines }) => lines === 2)).toBe(true);
});

it("A647 offers three visible ordering choices and only the selected explanation inside Details", async () => {
  const before = currentLocale();
  setLocale("en-GB");
  try {
    const el = await mountPricing(saved);
    expect(folded(el, "details")).not.toBeNull();
    await openSection(el, "details");
    const choices =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
        '[name="ordering"]',
      );
    expect(choices).not.toBeNull();
    await choices!.updateComplete;
    expect(choices!.label).toBe("Standalone ordering by");
    expect(
      [...choices!.shadowRoot!.querySelectorAll('[role="radio"]')].map((button) =>
        button.textContent!.trim(),
      ),
    ).toEqual(["Anyone", "Staff only", "Nobody"]);
    choices!.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")[2]!.click();
    await el.updateComplete;
    await choices!.updateComplete;
    expect(choices!.hint).toBe("Only as an extra on another dish.");
    expect(choices!.shadowRoot!.querySelectorAll(".hint")).toHaveLength(1);
    expect(submittedValue(el).ordering).toBe("not_sold_separately");
  } finally {
    setLocale(before);
  }
});

it("names a product's ordering on the Details line, and a variant's not at all", async () => {
  const el = await mountPricing({ ...saved, available: false, ordering: "staff_only" });
  const ordering = { label: t("editor.ordered_on_own"), value: t("product.ordering_staff_only") };
  expect(summaryOf(el, "details").at(-1)).toEqual(ordering);
  expect(summaryOf(el, "details").map(({ value }) => value)).not.toContain(
    t("product.unavailable_badge"),
  );
  cleanupWidgets();
  const variant = await mountVariant();
  expect(summaryOf(variant, "details").map(({ label }) => label)).not.toContain(
    t("editor.ordered_on_own"),
  );
});

async function input(el: ProductEditor, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElement>(`[name="${name}"]`)!;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function save(el: ProductEditor) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
}
/** One change, so Save has something to send: an untouched form's Save sends nothing. */
async function edit(el: ProductEditor) {
  await input(el, "kitchen-name", "COUNTER");
}
function saveButton(el: ProductEditor): HTMLElementTagNameMap["wt-button"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
}
async function bottomOf(el: ProductEditor): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}
function errorOf(el: ProductEditor, name: string): string {
  return el.shadowRoot!.querySelector<HTMLElement & { error: string }>(`[name="${name}"]`)!.error;
}
function section(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector<
    HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
  >(`[data-section="${name}"]`)!;
}
function folded(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    `wt-disclosure[data-section="${name}"]`,
  )!;
}
/** The named values a section's closed line shows, every row's in order. */
function summaryOf(el: ProductEditor, name: string) {
  return folded(el, name).summaryRows.flatMap(({ fields }) => fields);
}
/** An element's own text, leaving out what a help badge inside it says. */
function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("")
    .trim();
}
/** A group inside a card: the price card's price, variants and modifiers. */
function group(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-group="${name}"]`)!;
}
/** The labels each group inside Details contributes to its closed line. */
const DETAILS_PART_LABELS = {
  kitchen: () => [t("editor.kitchen_name"), t("editor.summary_course")],
  descriptors: () => [t("editor.customer_name"), t("editor.description")],
  nutrition: () => [t("modifiers.allergens"), t("editor.nutrition.dietary")],
};
/** The named values one group contributes to the Details line, in the line's order. */
function detailsPart(el: ProductEditor, part: keyof typeof DETAILS_PART_LABELS) {
  const labels = DETAILS_PART_LABELS[part]();
  return summaryOf(el, "details").filter(({ label }) => labels.includes(label));
}
async function openSection(el: ProductEditor, name: string) {
  const disclosure = section(el, name);
  await disclosure.updateComplete;
  if (!disclosure.open) {
    disclosure.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
    await disclosure.updateComplete;
    await el.updateComplete;
  }
  // Rendering finishes before the opening animation stops moving pointer targets.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const body = disclosure.shadowRoot!.querySelector<HTMLElement>(".body")!;
  await Promise.all(body.getAnimations().map((animation) => animation.finished));
}
/** Presses the price field's unit button, which is how the unit dropdown is reached. */
async function openUnits(el: ProductEditor) {
  el.shadowRoot!.querySelector("[name=unit-price]")!.dispatchEvent(
    new CustomEvent("wt-unit-click", { detail: {}, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
/** The dialog the unit buttons open, holding the unit dropdown and Add unit. */
function unitChooser(el: ProductEditor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    'wt-dialog[data-test="unit-chooser"]',
  )!;
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
      archivedIds: ReadonlySet<string>;
      updateComplete: Promise<unknown>;
    }
  >("dashboard-variant-table");
}

it("labels a unit option as its name then abbreviation", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "u",
        name: { en: "Kilogram" },
        abbreviation: { en: "kg" },
      },
    ],
  });
  await openUnits(el);
  const option = combobox(el, "unit")!.options.find((choice) => choice.value === "u")!;
  expect(option.label).toBe("Kilogram (kg)");
});

it("labels a unit option with its staff abbreviation when the translated abbreviation is absent", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "u",
        name: { en: "Portion" },
        abbreviation: {},
      },
    ],
  });
  await openUnits(el);
  const option = combobox(el, "unit")!.options.find((choice) => choice.value === "u")!;
  expect(option.label).toBe("Portion (su)");
});

it('renders a short unit as "per unit" on the price control', async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: "litre" },
    locales: ["en"],
    units: [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "litre",
        name: { en: "Litre" },
        abbreviation: { en: "l" },
      },
    ],
  });
  expect(el.shadowRoot!.querySelector("[name=unit-price]")!.getAttribute("unit")).toBe(
    t("editor.per_unit").replace("{unit}", "l"),
  );
});

const kg = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
  id: "kg",
  name: { en: "Kilogram" },
  abbreviation: { en: "kg" },
};
it.each([
  { locale: "en-GB", unitId: null, variants: [], label: "Price", button: "Each" },
  { locale: "es-ES", unitId: null, variants: [], label: "Precio", button: "Unidad" },
  { locale: "en-GB", unitId: kg.id, variants: [], label: "Price per kg", button: "per kg" },
  { locale: "es-ES", unitId: kg.id, variants: [], label: "Precio por kg", button: "por kg" },
  { locale: "en-GB", unitId: null, variants: [small], label: "Base price", button: "Each" },
  { locale: "es-ES", unitId: null, variants: [small], label: "Precio base", button: "Unidad" },
  {
    locale: "en-GB",
    unitId: kg.id,
    variants: [small],
    label: "Base price per kg",
    button: "per kg",
  },
  {
    locale: "es-ES",
    unitId: kg.id,
    variants: [small],
    label: "Precio base por kg",
    button: "por kg",
  },
])(
  "labels the price $label with the unit button $button in $locale",
  async ({ locale, unitId, variants, label, button }) => {
    setLocale(locale);
    try {
      const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: { ...product, unitId, variants },
        locales: ["en"],
        units: [kg],
      });
      const price = control<{ label: string; unit: string }>(el, "unit-price");
      expect(price.label).toBe(label);
      expect(price.unit).toBe(button);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("hands the variant window no unit when the product has none, so its price reads Price", async () => {
  setLocale("en-GB");
  try {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, unitId: null },
      locales: ["en"],
      units: [kg],
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
    await el.updateComplete;
    const form = variantForm(el);
    await form.updateComplete;
    expect((form as unknown as { unitLabel: string }).unitLabel).toBe("");
    const price = form.shadowRoot!.querySelector<HTMLElement & { label: string }>(
      'wt-price-input[name="unitPrice"]',
    )!;
    expect(price.label).toBe("Price");
  } finally {
    setLocale("es-ES");
  }
});

it.each([
  { locale: "en-GB", side: "before" },
  { locale: "es-ES", side: "after" },
])("draws the euro sign in the price field where $locale writes it", async ({ locale, side }) => {
  setLocale(locale);
  try {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: product,
      locales: ["en"],
      units: [unit],
    });
    const price = el.shadowRoot!.querySelector<HTMLElement & { locale: string }>(
      "[name=unit-price]",
    )!;
    expect(price.locale).toBe(locale);
    const shadow = price.shadowRoot!;
    const sign = shadow.querySelector<HTMLElement>('[part~="currency"]')!;
    expect(sign.textContent).toBe("€");
    const signBox = sign.getBoundingClientRect();
    const amountBox = shadow.querySelector("input")!.getBoundingClientRect();
    const middle = (amountBox.left + amountBox.right) / 2;
    if (side === "before") expect(signBox.right).toBeLessThan(middle);
    else expect(signBox.left).toBeGreaterThan(middle);
  } finally {
    setLocale("es-ES");
  }
});

it("uses direct nutritional chips with an explicit None choice", async () => {
  const el = await mountPricing({ ...saved, allergens: {}, dietaryDeclarations: ["no_meat"] });
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  expect(picker).not.toBeNull();
  expect(el.shadowRoot!.querySelector("dashboard-allergen-picker")).toBeNull();
  expect(picker.shadowRoot!.querySelector('[data-test="reviewed"]')).toBeNull();
  expect(
    picker.shadowRoot!.querySelector('[data-choice="none"]')!.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    picker.shadowRoot!.querySelector('[data-choice="diet-no_meat"]')!.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(picker.shadowRoot!.querySelector('[data-choice="diet-no_meat"]')!.textContent).toContain(
    t("editor.diet.no_meat"),
  );
});
/** Runs `body` with the test frame at a desktop width, where the variants table keeps its price
 * column and the unit button in that column's heading. */
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
      units: [
        unit,
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          id: "litre",
          name: { en: "Litre" },
          abbreviation: { en: "l" },
        },
      ],
    });
    const table = variantTable(el)!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector('[data-test="pricing-unit"]')!;
    expect(select.getClientRects().length).toBeGreaterThan(0);
    expect(el.shadowRoot!.querySelector('[data-test="choose-unit"]')).toBeNull();
  });
});

// A full-width price field left the amount at one edge and its unit link at the other.
it("keeps the base price field six tap targets wide on a wide dialog, and the card's width on a phone", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  onTestFinished(() => page.viewport(width, height));
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
  });
  el.style.setProperty("--wt-tap-min", "44px");
  const field = () => el.shadowRoot!.querySelector<HTMLElement>("wt-price-input[name=unit-price]")!;
  const containerWidth = () => {
    const container = field().parentElement!;
    const styles = getComputedStyle(container);
    return container.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  await page.viewport(1280, 800);
  await frame();
  expect(containerWidth()).toBeGreaterThan(264);
  expect(field().getBoundingClientRect().width).toBe(264);

  await page.viewport(320, 800);
  await frame();
  expect(containerWidth()).toBeLessThan(264);
  expect(field().getBoundingClientRect().width).toBeCloseTo(containerWidth(), 1);
});

// A phone hides the variants table's price column and the unit button in its heading; the price
// field's own unit button opens the same chooser.
it("changes a product's unit from the price field when the table's heading unit button is hidden", async () => {
  const litre = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "litre",
    name: { en: "Litre" },
    abbreviation: { en: "l" },
  };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit, litre],
  });
  const table = variantTable(el)!;
  table.style.width = "20rem";
  await table.updateComplete;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const heading = table.shadowRoot!.querySelector('[data-test="pricing-unit"]')!;
  expect(heading.getClientRects()).toHaveLength(0);
  await openUnits(el);
  const select = combobox(el, "unit")!;
  expect(select.getClientRects().length).toBeGreaterThan(0);
  expect(select.options.map((option) => option.value)).toEqual([EACH_CHOICE, unit.id, litre.id]);
  expect(el.shadowRoot!.querySelector('[data-test="add-unit"]')).not.toBeNull();
  await chooseOption(select, litre.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(litre.id);
});

it("opens the unit chooser from the variant table's heading, choosing there and offering Add unit", async () => {
  const litre = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "litre",
    name: { en: "Litre" },
    abbreviation: { en: "l" },
  };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit, litre],
  });
  const table = variantTable(el)!;
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  table.dispatchEvent(new CustomEvent("wt-unit-click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(true);
  expect(combobox(el, "unit")!.value).toBe(unit.id);
  await chooseOption(combobox(el, "unit")!, litre.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(litre.id);
  expect(unitChooser(el).open).toBe(false);
  table.dispatchEvent(new CustomEvent("wt-unit-click", { bubbles: true, composed: true }));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!.click();
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "unit" });
});

it("opens the unit chooser from the price field's unit button as a titled dialog, the product's unit chosen", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: kg.id },
    locales: ["en"],
    units: [unit, kg],
  });
  expect(unitChooser(el).open).toBe(false);
  expect(combobox(el, "unit")).toBeNull();
  await openUnits(el);
  const dialog = unitChooser(el);
  await dialog.updateComplete;
  expect(dialog.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector("h2")!.textContent).toBe(t("editor.pricing_unit"));
  const select = combobox(el, "unit")!;
  expect(dialog.contains(select)).toBe(true);
  expect(select.value).toBe(kg.id);
  expect(await shownIn(el, "unit")).toBe("Kilogram (kg)");
  expect(dialog.querySelector("[data-test=add-unit]")).not.toBeNull();
  // Beside the editor's own window, never inside a Pricing section that may be folded shut.
  expect(dialog.closest("wt-modal")).toBeNull();
});

it("changes the unit on a choice, shuts the chooser and puts focus back on the price field's unit button", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  await openUnits(el);
  await chooseOption(combobox(el, "unit")!, kg.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(kg.id);
  expect(unitChooser(el).open).toBe(false);
  expect(combobox(el, "unit")).toBeNull();
  const price = priceInput(el);
  await expect
    .poll(() => price.shadowRoot!.activeElement)
    .toBe(price.shadowRoot!.querySelector("button.unit"));
});

it("shuts the chooser from its Close button without changing the unit, putting focus back on the opener", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  const reachedScreen = vi.fn();
  el.addEventListener("wt-close", reachedScreen);
  await openUnits(el);
  const close = unitChooser(el).querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=close-unit-chooser]",
  )!;
  expect(close.textContent!.trim()).toBe(t("action.close"));
  close.click();
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(false);
  expect(el.currentValue.unitId).toBe(unit.id);
  const price = priceInput(el);
  await expect
    .poll(() => price.shadowRoot!.activeElement)
    .toBe(price.shadowRoot!.querySelector("button.unit"));
  await closeReportsDelivered();
  expect(reachedScreen).not.toHaveBeenCalled();
});

// Opened by a real press, as products-screen.test.ts's unit-form Escape case is (C74).
it("shuts only the chooser on Escape, leaving the unit and the editor as they were", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  const reachedScreen = vi.fn();
  el.addEventListener("wt-close", reachedScreen);
  const cancelled = vi.fn();
  el.addEventListener("wt-cancel", cancelled);
  await userEvent.click((await unitButton(el))!);
  await el.updateComplete;
  const dialog = unitChooser(el);
  await dialog.updateComplete;
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  const closed = new Promise((resolve) =>
    dialog.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  await vi.waitFor(() => expect(unitChooser(el).open).toBe(false));
  const price = priceInput(el);
  await expect
    .poll(() => price.shadowRoot!.activeElement)
    .toBe(price.shadowRoot!.querySelector("button.unit"));
  await closeReportsDelivered();
  expect(el.currentValue.unitId).toBe(unit.id);
  expect(el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
  expect(cancelled).not.toHaveBeenCalled();
  expect(reachedScreen).not.toHaveBeenCalled();
});

it("opens the chooser from a saved product's variant table heading, and returns focus there", async () => {
  await atDesktopWidth(async () => {
    const el = await mountPricing({ ...saved, variants: [small, large] }, { units: [unit, kg] });
    const table = variantTable(el)!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="pricing-unit"]')!.click();
    await el.updateComplete;
    const dialog = unitChooser(el);
    await dialog.updateComplete;
    const box = dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    await expect.poll(() => dialog.contains(el.shadowRoot!.activeElement)).toBe(true);
    dialog.querySelector<HTMLElement>("[data-test=close-unit-chooser]")!.click();
    await el.updateComplete;
    await expect
      .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
      .toBe("pricing-unit");
    expect(el.currentValue.unitId).toBe(unit.id);
  });
});

it("keeps the chooser open under the unit form, so a cancelled Add unit returns focus to Add unit", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await input(el, "name", "Dirty coffee");
  await input(el, "unit-price", "4.50");
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  await openUnits(el);
  unitChooser(el).querySelector<HTMLElement>("[data-test=add-unit]")!.click();
  expect(create.mock.calls[0]![0].detail).toEqual({ kind: "unit" });
  el.childOpen = true;
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(true);
  // The unit form is cancelled: the screen closes it and hands focus back.
  el.childOpen = false;
  await el.updateComplete;
  el.returnRelatedFocus("unit");
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("data-test")).toBe("add-unit");
  expect(el.currentValue).toMatchObject({
    name: "Dirty coffee",
    unitPrice: "4.50",
    unitId: unit.id,
  });
});

it("chooses a unit Add unit made, shuts the chooser, and keeps the unsaved draft through the unit list's reload", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await input(el, "name", "Dirty coffee");
  await input(el, "unit-price", "4.50");
  await openUnits(el);
  unitChooser(el).querySelector<HTMLElement>("[data-test=add-unit]")!.click();
  el.childOpen = true;
  await el.updateComplete;
  // The unit form saved: the screen picks the new unit, closes the form, returns focus and then
  // reloads the units.
  el.selectRelated("unit", kg.id);
  el.childOpen = false;
  await el.updateComplete;
  el.returnRelatedFocus("unit");
  expect(unitChooser(el).open).toBe(false);
  const price = priceInput(el);
  await expect
    .poll(() => price.shadowRoot!.activeElement)
    .toBe(price.shadowRoot!.querySelector("button.unit"));
  el.units = [unit, kg];
  await el.updateComplete;
  expect(el.currentValue).toMatchObject({ name: "Dirty coffee", unitPrice: "4.50", unitId: kg.id });
  expect(price.unit).toBe(t("editor.per_unit").replace("{unit}", "kg"));
});

it("opens the chooser showing a refused unit, and keeps the refusal on the price field once it is shut", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  el.fieldErrors = { unit: "That unit is gone" };
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(true);
  expect(sharedField(el, "wt-combobox", "unit").error).toBe("That unit is gone");
  unitChooser(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(false);
  expect(priceInput(el).error).toBe("That unit is gone");
  // Shut once, it stays shut while the editor redraws for other reasons.
  await input(el, "name", "Coffee to go");
  expect(unitChooser(el).open).toBe(false);
  await openUnits(el);
  expect(unitChooser(el).open).toBe(true);
  expect(sharedField(el, "wt-combobox", "unit").error).toBe("That unit is gone");
  await chooseOption(combobox(el, "unit")!, kg.id);
  await el.updateComplete;
  expect(priceInput(el).error).toBe("");
});

it("shows a refused unit beside the price's own error on the price field once the chooser is shut", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  await edit(el);
  save(el);
  el.fieldErrors = { unit: "That unit is gone" };
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(true);
  unitChooser(el).querySelector<HTMLElement>("[data-test=close-unit-chooser]")!.click();
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(false);
  expect(priceInput(el).error).toBe("That unit is gone");
  await input(el, "unit-price", "");
  const price = priceInput(el);
  expect(price.error).toBe(`${t("editor.price_invalid")} That unit is gone`);
  await price.updateComplete;
  expect(price.shadowRoot!.querySelector("[data-error]")!.textContent).toBe(
    `${t("editor.price_invalid")} That unit is gone`,
  );
  // Both stand under the price field, so the sentence above Save only points at it.
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  await input(el, "unit-price", "4.50");
  expect(priceInput(el).error).toBe("That unit is gone");
});

it("says the price field's unit button opens a dialog, as the variant table heading's button does", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  const price = priceInput(el);
  await price.updateComplete;
  expect(price.shadowRoot!.querySelector("button.unit")!.getAttribute("aria-haspopup")).toBe(
    "dialog",
  );
});

it("locks the chooser's unit dropdown while the editor is saving, so a choice then changes nothing", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  await openUnits(el);
  expect(sharedField(el, "wt-combobox", "unit").disabled).toBe(false);
  el.busy = true;
  await el.updateComplete;
  const box = sharedField(el, "wt-combobox", "unit");
  expect(box.disabled).toBe(true);
  await chooseOption(box, kg.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(unit.id);
  expect(unitChooser(el).open).toBe(true);
  el.busy = false;
  await el.updateComplete;
  expect(sharedField(el, "wt-combobox", "unit").disabled).toBe(false);
});

it("never leaves the unit chooser over a page whose editor the screen has closed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, kg],
  });
  await openUnits(el);
  expect(unitChooser(el).open).toBe(true);
  el.open = false;
  await el.updateComplete;
  expect(unitChooser(el).open).toBe(false);
  expect(combobox(el, "unit")).toBeNull();
});

it("draws no unit chooser on a variant's page, whose unit is its product's", async () => {
  const el = await mountVariant();
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  el.fieldErrors = { unit: "A variant takes its product's unit" };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
});

it("renders the sections in the designed order, with VAT in Details", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    dineInVatRate: "10.00",
  });
  el.style.setProperty("--wt-space-4", "16px");
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".form > [data-section]")].map(
      (node) => node.dataset.section,
    ),
  ).toEqual(["identity", "details", "price"]);
  expect(
    [...section(el, "identity").children].map((node) => (node as HTMLElement).dataset.section),
  ).toEqual(["categories", "name", "available"]);
  expect(
    [...section(el, "price").children].map((node) => (node as HTMLElement).dataset.group),
  ).toEqual(["price", "variants", "modifiers"]);
  const groups = [
    ...section(el, "details").querySelectorAll<HTMLFieldSetElement>("fieldset[data-group]"),
  ];
  expect(groups.map((group) => group.dataset.group)).toEqual([
    "kitchen",
    "menu",
    "nutrition",
    "vat",
    "ordering",
  ]);
  expect(
    groups.map((group) => group.querySelector(":scope > legend")!.textContent!.trim()),
  ).toEqual([
    t("editor.section_kitchen"),
    t("editor.group_menu"),
    t("editor.group_nutrition"),
    t("product.vat"),
    t("editor.ordered_on_own_group"),
  ]);
  const vat = groups.find((group) => group.dataset.group === "vat")!;
  expect(vat.querySelector("[data-test=dine-in-vat]")).not.toBeNull();
  const pricing = group(el, "price");
  expect(pricing.querySelector("[name=unit-price]")).not.toBeNull();
  expect(pricing.querySelector("wt-combobox")).toBeNull();
  expect(pricing.querySelector(".group-label, legend")).toBeNull();
  expect(getComputedStyle(el.shadowRoot!.querySelector(".form")!).rowGap).toBe("16px");
});

it("Details starts closed on an existing product and open on a new one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  expect(section(el, "details").open).toBe(false);
  cleanupWidgets();
  const { el: created } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: null,
    locales: ["en"],
    units: [unit],
  });
  expect(section(created, "details").open).toBe(true);
});

it("Details closes again when the editor moves to another existing product", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await openSection(el, "details");
  expect(section(el, "details").open).toBe(true);
  el.value = { ...product, id: "product-b", name: "Tea" };
  await el.updateComplete;
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(false);
});

it("Details opens again for a second new product", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: null,
    locales: ["en"],
    units: [unit],
  });
  const details = section(el, "details");
  await details.updateComplete;
  details.shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
  await details.updateComplete;
  expect(details.open).toBe(false);
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(true);
});

it.each([
  "takeaway-tax",
  "ordering",
  "customer-name-en",
  "description-en",
  "kitchen-name",
  "product-course",
  "allergens",
])("a refusal inside closed Details opens it and focuses the field: %s", async (name) => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    courses: [{ id: "course-1", name: "Starters" }],
    takeawayVat: true,
    vatRates: ["10.00", "21.00"],
  });
  expect(section(el, "details").open).toBe(false);
  el.fieldErrors = { [name]: t("editor.field_rejected") };
  await el.updateComplete;
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(true);
  if (name === "allergens") {
    const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
    await expect
      .poll(() => picker.shadowRoot!.activeElement?.getAttribute("name"))
      .toBe("allergens");
  } else {
    await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe(name);
  }
});

it("a variant's page has no Ordering group and keeps Available under Name", async () => {
  const el = await mountVariant();
  const sections = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".form > [data-section]")].map(
    (node) => node.dataset.section,
  );
  expect(sections).toEqual(["identity", "details", "price"]);
  expect(
    [...section(el, "identity").children].map((node) => (node as HTMLElement).dataset.section),
  ).toEqual(["categories", "name", "available"]);
  expect(section(el, "available").querySelector("[name=available]")).not.toBeNull();
  expect(section(el, "details").querySelector('fieldset[data-group="ordering"]')).toBeNull();
  expect(el.shadowRoot!.querySelector("[name=ordering]")).toBeNull();
});

it("with neither a dine-in rate nor takeaway VAT, Details has no VAT group", async () => {
  const el = await mountPricing(saved, { dineInVatRate: "", takeawayVat: false });
  expect(section(el, "details").querySelector('fieldset[data-group="vat"]')).toBeNull();
  expect(summaryOf(el, "details").map(({ label }) => label)).not.toContain(
    t("editor.takeaway_vat"),
  );
});

it("the takeaway VAT appears in Details' line, not in the price card", async () => {
  const el = await mountPricing(
    { ...saved, takeawayVatRate: "10.00" },
    { takeawayVat: true, vatRates: ["10.00", "21.00"] },
  );
  const takeaway = { label: t("editor.takeaway_vat"), value: vatRateText("10.00") };
  expect(summaryOf(el, "details")).toContainEqual(takeaway);
  expect(section(el, "price").textContent).not.toContain(t("editor.takeaway_vat"));
});

it("keeps the staff name, customer name, description and kitchen name independent", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Espresso");
  await openSection(el, "details");
  await input(el, "customer-name-en", "Single espresso");
  await input(el, "description-en", "Dark roast");
  await openSection(el, "details");
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
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openSection(el, "details");
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
  el.units = [
    ...el.units,
    {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      id: "custom",
      name: { en: "Custom" },
      abbreviation: {},
    },
  ];
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
  expect(errorOf(el, "name")).toBe(t("editor.name_required"));
  expect(errorOf(el, "unit-price")).toBe(t("editor.price_invalid"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
  expect(
    (el.shadowRoot!.querySelector("[name=unit-price]") as HTMLElement & { value: string }).value,
  ).toBe("-1");
});

it("says nothing about errors before the first submission, and Save works", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await input(el, "name", "");
  await input(el, "unit-price", "-1");

  expect(errorOf(el, "name")).toBe("");
  expect(errorOf(el, "unit-price")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission focuses the first invalid field and disables Save", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await input(el, "unit-price", "-1");
  save(el);
  await el.updateComplete;

  expect(errorOf(el, "name")).toBe("");
  expect(errorOf(el, "unit-price")).toBe(t("editor.price_invalid"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe("unit-price");
});

it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await input(el, "name", " ");
  await input(el, "unit-price", "-1");
  save(el);
  await el.updateComplete;

  await input(el, "name", "Tea");
  expect(errorOf(el, "name")).toBe("");
  expect(errorOf(el, "unit-price")).toBe(t("editor.price_invalid"));
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);

  await input(el, "name", "");
  expect(errorOf(el, "name")).toBe(t("editor.name_required"));

  await input(el, "name", "Tea");
  await input(el, "unit-price", "2.50");
  expect(errorOf(el, "unit-price")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
});

it("re-checks a variant row after a failed submission, and frees Save once the variant is fixed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, unitPrice: "-1" }] },
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  save(el);
  await el.updateComplete;
  expect(variantTable(el)!.errors).toEqual({ 1: t("editor.price_invalid") });
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);

  variantTable(el)!.dispatchEvent(
    new CustomEvent("wt-edit", {
      detail: { index: 1, via: "menu" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...large, unitPrice: "3.50" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(variantTable(el)!.errors).toEqual({});
  expect(await bottomOf(el)).toBe("");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
});

it("puts a refusal for a folded field under it, opening its section, until that field changes", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  el.fieldErrors = { "description-en": t("editor.field_rejected") };
  await el.updateComplete;
  await section(el, "details").updateComplete;

  expect(section(el, "details").open).toBe(true);
  // The text box and the sentence describing it both live inside the shared text area.
  const area = el.shadowRoot!.querySelector("wt-textarea[name=description-en]")!;
  const description = area.shadowRoot!.querySelector("textarea")!;
  expect(description.getAttribute("aria-invalid")).toBe("true");
  expect(
    area.shadowRoot!.getElementById(description.getAttribute("aria-describedby")!)!.textContent,
  ).toBe(t("editor.field_rejected"));
  await expect
    .poll(() => el.shadowRoot!.activeElement?.getAttribute("name"))
    .toBe("description-en");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(false);

  await input(el, "name", "Large coffee");
  expect(description.getAttribute("aria-invalid")).toBe("true");
  expect(saveButton(el).disabled).toBe(false);

  await input(el, "description-en", "Roasted this morning");
  expect(description.getAttribute("aria-invalid")).toBe("false");
  expect(await bottomOf(el)).toBe("");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);

  el.fieldErrors = { "description-en": "Try another description" };
  await el.updateComplete;
  expect(description.getAttribute("aria-invalid")).toBe("true");
  expect(errorOf(el, "description-en")).toBe("Try another description");
});

it("submits past a refusal beside a field or on a variant's row, which then go", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  el.fieldErrors = {
    "kitchen-name": t("editor.field_rejected"),
    "variant-1-price": t("editor.field_rejected"),
  };
  await el.updateComplete;
  expect(errorOf(el, "kitchen-name")).toBe(t("editor.field_rejected"));
  expect(variantTable(el)!.errors).toEqual({ 1: t("editor.field_rejected") });
  expect(saveButton(el).disabled).toBe(false);

  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).toHaveBeenCalledOnce();
  expect(errorOf(el, "kitchen-name")).toBe("");
  expect(variantTable(el)!.errors).toEqual({});
  expect(await bottomOf(el)).toBe("");
});

it.each([["product-course", "courseId"]])(
  "puts a refused %s under its dropdown, opening the kitchen section, until it changes",
  async (name) => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: product,
      locales: ["en"],
      units: [unit],
      courses: [{ id: "course-1", name: "Starters" }],
    });
    await edit(el);
    el.fieldErrors = { [name]: "That one is gone" };
    await el.updateComplete;
    await section(el, "details").updateComplete;
    expect(section(el, "details").open).toBe(true);
    // The dropdown's own button carries the marking, and the sentence it names is inside it.
    const box = combobox(el, name)!;
    await (box as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const select = box.shadowRoot!.querySelector(".trigger")!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(
      box.shadowRoot!.getElementById(select.getAttribute("aria-describedby")!)!.textContent,
    ).toBe("That one is gone");
    await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe(name);
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(saveButton(el).disabled).toBe(false);

    await chooseOption(box, "");
    await el.updateComplete;
    await (box as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(select.getAttribute("aria-invalid")).toBe("false");
    expect(await bottomOf(el)).toBe("");
  },
);

it("keeps a refusal that names no field of the form in the bottom message, leaving Save working", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  el.fieldErrors = { active: "Those extras lists still offer it" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe("Those extras lists still offer it");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);

  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).toHaveBeenCalledOnce();
  expect(await bottomOf(el)).toBe("");
});

it("keeps a refused translation for a language the form does not show in the bottom message alone", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  el.fieldErrors = { "customer-name-fr": "Add the French name" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe("Add the French name");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
});

it("shows the refusal and the generic sentence together when both apply", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  el.fieldErrors = { active: "Those extras lists still offer it", "kitchen-name": "Too long" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe(`Those extras lists still offer it ${t("form.fix_fields")}`);
});

it("starts again when reopened: no messages and Save quiet", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  save(el);
  await el.updateComplete;
  expect(errorOf(el, "name")).toBe(t("editor.name_required"));
  expect(saveButton(el).variant).toBe("primary");
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;

  expect(errorOf(el, "name")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveButton(el).variant).toBe("secondary");
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);
  await edit(el);
  expect(saveButton(el).variant).toBe("primary");
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
});

it("opens the section holding a reported error, puts focus in the field and leaves it open once fixed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
  });
  expect(section(el, "details").open).toBe(false);
  el.fieldErrors = { "customer-name-en": "That language is no longer enabled" };
  await el.updateComplete;
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(true);
  await expect
    .poll(() => el.shadowRoot!.activeElement?.getAttribute("name"))
    .toBe("customer-name-en");
  // The section stays open when the error clears — collapsing it under the person who is fixing it
  // would hide the field they just corrected. See the decision comment in wt-disclosure.
  el.fieldErrors = {};
  await el.updateComplete;
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(true);
  section(el, "details").shadowRoot!.querySelector<HTMLElement>("button.header")!.click();
  await section(el, "details").updateComplete;
  expect(section(el, "details").open).toBe(false);
});

it("retains a compact-picker allergen selection across an unrelated edit", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: {} },
    locales: ["en"],
    units: [unit],
  });
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  picker.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "allergens", value: allergensFromChoices(["milk"]) },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  await input(el, "name", "New coffee");
  expect(el.currentValue.allergens).toEqual({ milk: {} });
});

it("restores explicit kinds when they are removed then re-added", async () => {
  const gluten = { kinds: ["wheat", "barley"] as const };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: { gluten: { kinds: [...gluten.kinds] } } },
    locales: ["en"],
    units: [unit],
  });
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  for (const allergens of [[], ["gluten:wheat", "gluten:barley"]]) {
    picker.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: { allergens, dietary: [] } },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
  }
  expect(el.currentValue.allergens).toEqual({ gluten });
});

it("keeps stored kinds when another allergen is added", async () => {
  const gluten = { kinds: ["wheat", "barley"] as const };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, allergens: { gluten: { kinds: [...gluten.kinds] } } },
    locales: ["en"],
    units: [unit],
  });
  await openSection(el, "details");
  el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: {
        field: "allergens",
        value: allergensFromChoices(["gluten:wheat", "gluten:barley", "nuts:walnuts"]),
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.allergens).toEqual({ gluten, nuts: { kinds: ["walnuts"] } });
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
    kitchenName: "SAUCE",
    minPicks: 0,
    maxPicks: null,
    active: true,
    items: [],
  },
  {
    id: "shared",
    name: "Extra bread",
    customerName: { en: "More bread", es: "Mas pan" },
    kitchenName: "BREAD",
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
    kitchenName: "COOK",
    defaultLabelId: null,
    active: true,
    labels: [],
  },
  {
    id: "shared",
    name: "Cut",
    customerName: { en: "How shall we cut it?", es: "Como lo cortamos" },
    kitchenName: "CUT",
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
  const locale = currentLocale();
  setLocale("es");
  onTestFinished(() => setLocale(locale));
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    extraLists,
    optionLists,
  });
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { options: ComboboxOption[] }>(
    "[data-test=add-modifier]",
  )!;
  expect(combobox.options.map((option) => option.value)).toEqual([
    "create-extras",
    "extras:shared",
    "create-options",
    "options:cooked",
    "options:shared",
  ]);
  expect(combobox.options.map((option) => option.label)).toEqual([
    t("editor.create_extra_list"),
    "Extra bread",
    t("editor.create_option_list"),
    "Cooked",
    "Cut",
  ]);
  expect([t("editor.create_extra_list"), t("editor.create_option_list")]).toEqual([
    "Añadir lista de extras…",
    "Añadir lista de opciones…",
  ]);
  expect(combobox.options.map((option) => option.group)).toEqual([
    t("extras.title"),
    t("extras.title"),
    t("options.title"),
    t("options.title"),
    t("options.title"),
  ]);
  expect(combobox.options.map((option) => Boolean(option.primary))).toEqual([
    true,
    false,
    true,
    false,
    false,
  ]);
  expect(combobox.options.map((option) => option.icon)).toEqual([
    "plus",
    undefined,
    "plus",
    undefined,
    undefined,
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

it("still offers a kind's make-new choice under its heading once every list of that kind is attached", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      modifiers: [
        { kind: "extras", id: "sauces" },
        { kind: "extras", id: "shared" },
      ],
    },
    locales: ["en"],
    units: [unit],
    extraLists,
    optionLists: [],
  });
  const combobox = el.shadowRoot!.querySelector<HTMLElement & { options: ComboboxOption[] }>(
    "[data-test=add-modifier]",
  )!;
  expect(combobox.options.map(({ value, group }) => ({ value, group }))).toEqual([
    { value: "create-extras", group: t("extras.title") },
    { value: "create-options", group: t("options.title") },
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

// --- An attached row opens its list's editor ---

const twoAttached: ProductEditorDraft = {
  ...product,
  modifiers: [
    { kind: "extras", id: "sauces" },
    { kind: "options", id: "cooked" },
  ],
};

async function mountTwoAttached() {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: twoAttached,
    locales: ["en"],
    units: [unit],
    extraLists,
    optionLists,
  });
  const edits: unknown[] = [];
  el.addEventListener("wt-edit-related", (event) => edits.push((event as CustomEvent).detail));
  return { el, edits };
}

const attachedRow = (el: ProductEditor, key: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `[data-test=attached-modifier][data-modifier="${key}"]`,
  )!;
const openModifier = (el: ProductEditor, key: string) =>
  attachedRow(el, key).querySelector<HTMLButtonElement>(`[data-test="open-modifier-${key}"]`)!;

describe.each([
  ["extras:sauces", { kind: "extras", id: "sauces" }, "Sauces", "extras.title"],
  ["options:cooked", { kind: "options", id: "cooked" }, "Cooked", "options.title"],
] as const)("the attached row %s", (key, detail, name, kindTitle) => {
  it("names its activator by the list's name and kind", async () => {
    const { el } = await mountTwoAttached();
    const activator = openModifier(el, key);
    expect(activator.getAttribute("aria-label")).toBe(
      `${t("action.edit")}: ${name} · ${t(kindTitle)}`,
    );
  });

  // `force` skips Playwright's check that the cell itself is topmost, so the browser's own hit test
  // decides what a real press at the cell's middle reaches.
  it.each(["modifier-name", "modifier-kind"])(
    "asks for its list's editor once when %s is clicked, leaving the draft alone",
    async (cell) => {
      const { el, edits } = await mountTwoAttached();
      await userEvent.click(
        attachedRow(el, key).querySelector<HTMLElement>(`[data-test=${cell}]`)!,
        {
          force: true,
        },
      );
      await el.updateComplete;
      expect(edits).toEqual([detail]);
      expect(el.currentValue).toEqual(twoAttached);
    },
  );

  it.each(["{Enter}", " "])(
    "asks for its list's editor once from the keyboard (%s)",
    async (press) => {
      const { el, edits } = await mountTwoAttached();
      openModifier(el, key).focus();
      await userEvent.keyboard(press);
      await el.updateComplete;
      expect(edits).toEqual([detail]);
      expect(el.currentValue).toEqual(twoAttached);
    },
  );

  it("asks for nothing when its drag handle, row menu or Remove is clicked", async () => {
    const { el, edits } = await mountTwoAttached();
    const row = attachedRow(el, key);
    await userEvent.click(row.querySelector<HTMLElement>(`[data-test="drag-${key}"]`)!, {
      force: true,
    });
    await el.updateComplete;
    expect(edits).toEqual([]);
    const menu = row.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-row-actions",
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!, { force: true });
    await menu.updateComplete;
    expect(edits).toEqual([]);
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    expect(el.currentValue).toEqual(twoAttached);
    await userEvent.click(row.querySelector<HTMLElement>(`[data-test="remove-modifier-${key}"]`)!);
    await el.updateComplete;
    expect(edits).toEqual([]);
    expect(el.currentValue.modifiers).toEqual(
      twoAttached.modifiers.filter((ref) => `${ref.kind}:${ref.id}` !== key),
    );
  });

  it("asks once from its row menu's Edit", async () => {
    const { el, edits } = await mountTwoAttached();
    const row = attachedRow(el, key);
    const menu = row.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-row-actions",
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    await menu.updateComplete;
    await userEvent.click(row.querySelector<HTMLElement>(`[data-test="edit-modifier-${key}"]`)!);
    await el.updateComplete;
    expect(edits).toEqual([detail]);
  });

  it("asks for nothing while the editor is suspended", async () => {
    const { el, edits } = await mountTwoAttached();
    el.childOpen = true;
    await el.updateComplete;
    const row = attachedRow(el, key);
    const activator = openModifier(el, key);
    expect(activator.disabled).toBe(true);
    await userEvent.click(row.querySelector<HTMLElement>("[data-test=modifier-kind]")!, {
      force: true,
    });
    activator.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(edits).toEqual([]);
  });
});

it.each(["light", "dark"] as const)(
  "draws a modifier's Remove quiet like its Edit while a window opened from the editor is open, and red once it closes (%s theme)",
  async (theme) => {
    const { el } = await mountWidget<ProductEditor>(
      "dashboard-product-editor",
      {
        open: true,
        value: twoAttached,
        locales: ["en"],
        units: [unit],
        extraLists,
        optionLists,
        childOpen: true,
      },
      theme,
    );
    const row = attachedRow(el, "extras:sauces");
    const button = (test: string) =>
      row.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test="${test}"]`)!;
    const fill = (host: Element) =>
      getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
    const remove = button("remove-modifier-extras:sauces");
    const edit = button("edit-modifier-extras:sauces");
    await Promise.all([remove.updateComplete, edit.updateComplete]);
    expect(remove.disabled).toBe(true);
    expect(remove.variant).toBe("secondary");
    expect(fill(remove)).toBe(fill(edit));
    el.childOpen = false;
    await el.updateComplete;
    await remove.updateComplete;
    expect(remove.disabled).toBe(false);
    expect(remove.variant).toBe("danger");
    expect(fill(remove)).not.toBe(fill(edit));
  },
);

it("keeps a modifier's Remove red while the editor's own save is being sent", async () => {
  const { el } = await mountTwoAttached();
  el.busy = true;
  await el.updateComplete;
  const remove = attachedRow(el, "extras:sauces").querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="remove-modifier-extras:sauces"]',
  )!;
  expect(remove.disabled).toBe(true);
  expect(remove.variant).toBe("danger");
});

it.each([
  [
    "a list's window",
    async (el: ProductEditor) => {
      el.childOpen = true;
    },
  ],
  [
    "the image picker",
    async (el: ProductEditor) => {
      photoControl(el).dispatchEvent(
        new CustomEvent("image-picker-state", {
          detail: { open: true },
          bubbles: true,
          composed: true,
        }),
      );
    },
  ],
  [
    "the variant window",
    async (el: ProductEditor) => {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
    },
  ],
])(
  "keeps a modifier's Remove red while the editor's own save is being sent, even with %s open",
  async (_window, openWindow) => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: twoAttached,
      locales: ["en"],
      units: [unit],
      extraLists,
      optionLists,
      api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never,
    });
    await openWindow(el);
    await el.updateComplete;
    const remove = attachedRow(el, "extras:sauces").querySelector<
      HTMLElementTagNameMap["wt-button"]
    >('[data-test="remove-modifier-extras:sauces"]')!;
    expect(remove.variant).toBe("secondary");
    el.busy = true;
    await el.updateComplete;
    expect(remove.disabled).toBe(true);
    expect(remove.variant).toBe("danger");
  },
);

it("still reorders attached rows from the drag handle's keyboard, asking for no editor", async () => {
  const { el, edits } = await mountTwoAttached();
  attachedRow(el, "options:cooked")
    .querySelector<HTMLElement>('[data-test="drag-options:cooked"]')!
    .focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "options", id: "cooked" },
    { kind: "extras", id: "sauces" },
  ]);
  expect(edits).toEqual([]);
});

it("keeps an attached row's click from reaching the row around its button", async () => {
  const { el, edits } = await mountTwoAttached();
  const reached = vi.fn();
  attachedRow(el, "extras:sauces").addEventListener("click", reached);
  openModifier(el, "extras:sauces").click();
  await el.updateComplete;
  expect(edits).toEqual([{ kind: "extras", id: "sauces" }]);
  expect(reached).not.toHaveBeenCalled();
});

it("reorders attached rows when the handle is dragged with the pointer, asking for no editor", async () => {
  const { el, edits } = await mountTwoAttached();
  // The rows sit below the price and variants; brought to the middle, the drop is not under the
  // dialog's footer.
  openModifier(el, "options:cooked").scrollIntoView({ block: "center" });
  await userEvent.dragAndDrop(
    attachedRow(el, "extras:sauces").querySelector<HTMLElement>(
      '[data-test="drag-extras:sauces"]',
    )!,
    openModifier(el, "options:cooked"),
  );
  await el.updateComplete;
  expect(el.currentValue.modifiers).toEqual([
    { kind: "options", id: "cooked" },
    { kind: "extras", id: "sauces" },
  ]);
  expect(edits).toEqual([]);
});

it("draws a dragged attached row over the controls of the row it passes", async () => {
  await atDesktopWidth(async () => {
    const { el } = await mountTwoAttached();
    const dragged = attachedRow(el, "extras:sauces");
    const passed = attachedRow(el, "options:cooked");
    dragged.scrollIntoView({ block: "center" });
    const start = dragged.getBoundingClientRect();
    const centre = start.top + start.height / 2;
    const pointer = (target: EventTarget, type: string, clientY: number) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientY }));
    pointer(dragged.querySelector('[data-test="drag-extras:sauces"]')!, "pointerdown", centre);
    try {
      // Not far enough to swap the rows: the dragged one now overlaps the top of the next.
      pointer(document, "pointermove", centre + 0.4 * start.height);
      await el.updateComplete;
      expect(el.currentValue.modifiers).toEqual(twoAttached.modifiers);
      const menu = passed.querySelector("wt-row-actions")!.getBoundingClientRect();
      const y = menu.top + 2;
      expect(y).toBeLessThan(dragged.getBoundingClientRect().bottom);
      const under = el.shadowRoot!.elementFromPoint(menu.left + menu.width / 2, y);
      expect(dragged.contains(under)).toBe(true);
    } finally {
      pointer(document, "pointerup", centre);
    }
  });
});

/** The colour `token` resolves to where the editor is mounted, read off a probe painted with it. */
function resolved(el: ProductEditor, token: string): string {
  const probe = document.createElement("div");
  probe.style.background = `var(${token})`;
  el.parentElement!.appendChild(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

it.each(["light", "dark"] as const)(
  "tints a hovered or focused attached row in a colour the dialog's panel is not, and leaves a dragged row lifted (%s)",
  async (theme) => {
    const { el } = await mountWidget<ProductEditor>(
      "dashboard-product-editor",
      {
        open: true,
        value: twoAttached,
        locales: ["en"],
        units: [unit],
        extraLists,
        optionLists,
      },
      theme,
    );
    const tint = resolved(el, "--wt-color-bg");
    // The table sits inside the editor's dialog, painted with the raised surface.
    expect(tint).not.toBe(resolved(el, "--wt-color-surface-raised"));
    const keys = ["extras:sauces", "options:cooked"];
    const name = (index: number) =>
      attachedRow(el, keys[index]!).querySelector<HTMLElement>("[data-test=modifier-name]")!;
    attachedRow(el, keys[0]!).scrollIntoView({ block: "center" });
    expect(getComputedStyle(name(0)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // Aimed at the name, which nothing but the row's button covers.
    const button = openModifier(el, keys[0]!).getBoundingClientRect();
    const onName = name(0).getBoundingClientRect();
    const y = onName.top + onName.height / 2;
    await userEvent.hover(openModifier(el, keys[0]!), {
      position: { x: onName.left + onName.width / 2 - button.left, y: y - button.top },
    });
    expect(getComputedStyle(name(0)).backgroundColor).toBe(tint);
    openModifier(el, keys[1]!).focus();
    expect(getComputedStyle(name(1)).backgroundColor).toBe(tint);

    const row = attachedRow(el, keys[0]!);
    row
      .querySelector('[data-test="drag-extras:sauces"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientY: y }));
    try {
      expect(row.hasAttribute("data-dragging")).toBe(true);
      expect(row.matches(":hover")).toBe(true);
      expect(getComputedStyle(name(0)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(row).backgroundColor).toBe(resolved(el, "--wt-color-surface-lifted"));
    } finally {
      document.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientY: y }),
      );
    }
  },
);

describe("where focus goes when the list editor an attached row asked for closes", () => {
  it("goes back to the row's button when the row asked", async () => {
    const { el, edits } = await mountTwoAttached();
    const activator = openModifier(el, "options:cooked");
    activator.focus();
    await userEvent.keyboard("{Enter}");
    expect(edits).toEqual([{ kind: "options", id: "cooked" }]);
    activator.blur();
    el.returnRelatedFocus("options");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(activator);
  });

  it("goes back to the row's menu when the menu's Edit asked", async () => {
    const { el, edits } = await mountTwoAttached();
    const row = attachedRow(el, "extras:sauces");
    const menu = row.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-row-actions",
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    await menu.updateComplete;
    await userEvent.click(
      row.querySelector<HTMLElement>('[data-test="edit-modifier-extras:sauces"]')!,
    );
    expect(edits).toEqual([{ kind: "extras", id: "sauces" }]);
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.returnRelatedFocus("extras");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(menu);
  });

  it("goes to the Modifiers control when the row that asked is gone", async () => {
    const { el } = await mountTwoAttached();
    const row = attachedRow(el, "extras:sauces");
    openModifier(el, "extras:sauces").click();
    const menu = row.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-row-actions",
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    await menu.updateComplete;
    await userEvent.click(
      row.querySelector<HTMLElement>('[data-test="remove-modifier-extras:sauces"]')!,
    );
    await el.updateComplete;
    expect(row.isConnected).toBe(false);
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.returnRelatedFocus("extras");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(addModifier(el));
  });

  it("goes to the Modifiers control after a new list, even when a row asked before", async () => {
    const { el } = await mountTwoAttached();
    openModifier(el, "options:cooked").click();
    addModifier(el).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "create-options" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    el.returnRelatedFocus("options");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(addModifier(el));
  });
});

// The screen hands focus back once the nested form and its dialog have updated, without waiting for
// this editor, so the control can still be drawn disabled.
describe("focus handed back before the editor draws its controls enabled again", () => {
  async function openNestedForm(el: ProductEditor) {
    el.childOpen = true;
    await el.updateComplete;
  }
  const isDisabled = (control: HTMLElement) =>
    (control as HTMLElement & { disabled: boolean }).disabled;

  it("goes to the Modifiers control once it is drawn enabled", async () => {
    const { el } = await mountTwoAttached();
    await openNestedForm(el);
    el.childOpen = false;
    expect(isDisabled(addModifier(el))).toBe(true);
    el.returnRelatedFocus("extras");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(addModifier(el));
  });

  it("goes back to the row's button once it is drawn enabled", async () => {
    const { el, edits } = await mountTwoAttached();
    const activator = openModifier(el, "options:cooked");
    activator.click();
    expect(edits).toEqual([{ kind: "options", id: "cooked" }]);
    await openNestedForm(el);
    el.childOpen = false;
    expect(activator.disabled).toBe(true);
    el.returnRelatedFocus("options");
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(activator);
  });

  it("leaves focus where it was moved while it waited", async () => {
    const { el } = await mountTwoAttached();
    await openNestedForm(el);
    el.childOpen = false;
    el.returnRelatedFocus("extras");
    const name = el.shadowRoot!.querySelector<HTMLElement>('[name="name"]')!;
    name.focus();
    expect(el.shadowRoot!.activeElement).toBe(name);
    await el.updateComplete;
    await addModifier(el).updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(isDisabled(addModifier(el))).toBe(false);
    expect(el.shadowRoot!.activeElement).toBe(name);
  });
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

  await chooseModifier(el, "Cooked");
  expect(el.currentValue.modifiers).toEqual([{ kind: "options", id: "cooked" }]);
  expect(combobox.value).toBe("");
  expect(triggerText(combobox)).toBe(t("editor.choose"));
  // Reset in place, not by replacing the control: a replaced one would drop the focus its own
  // choice handling just returned, and a manager attaching a second list would have to find it
  // again.
  expect(el.shadowRoot!.activeElement).toBe(combobox);
});

it("draws each make-new row first under its kind's heading, and clicking it asks for that kind", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [] },
    locales: ["en"],
    units: [unit],
    extraLists,
    optionLists,
  });
  const created = vi.fn();
  el.addEventListener("wt-create-related", created);
  const combobox = addModifier(el);
  await combobox.updateComplete;
  combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await combobox.updateComplete;
  const groups = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="group"]')];
  expect(
    groups.map((group) => [
      combobox
        .shadowRoot!.getElementById(group.getAttribute("aria-labelledby")!)!
        .textContent!.trim(),
      [...group.querySelectorAll('[role="option"]')][0]!.textContent!.trim(),
    ]),
  ).toEqual([
    [t("extras.title"), t("editor.create_extra_list")],
    [t("options.title"), t("editor.create_option_list")],
  ]);
  combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await combobox.updateComplete;
  await chooseModifier(el, t("editor.create_extra_list"));
  await chooseModifier(el, t("editor.create_option_list"));
  expect(created.mock.calls.map((call) => call[0].detail)).toEqual([
    { kind: "extras" },
    { kind: "options" },
  ]);
  expect(el.currentValue.modifiers).toEqual([]);
});

it.each([1280, 390])(
  "shows both create choices without scrolling the small-list picker at %ipx",
  async (frame) => {
    const width = window.innerWidth,
      height = window.innerHeight,
      locale = currentLocale();
    await page.viewport(frame, 900);
    try {
      const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: { ...product, modifiers: [] },
        locales: ["en"],
        units: [unit],
        extraLists,
        optionLists,
      });
      const combobox = addModifier(el);
      await combobox.updateComplete;
      combobox.scrollIntoView({ block: "center" });
      await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
      const list = combobox.shadowRoot!.querySelector<HTMLElement>(".list")!;
      await expect.poll(() => list.getBoundingClientRect().height).toBeGreaterThan(0);
      const bounds = list.getBoundingClientRect();
      for (const label of [t("editor.create_extra_list"), t("editor.create_option_list")]) {
        const row = [...list.querySelectorAll<HTMLElement>('[role="option"]')]
          .find((option) => option.textContent!.trim() === label)!
          .getBoundingClientRect();
        expect(row.top, label).toBeGreaterThanOrEqual(bounds.top);
        expect(row.bottom, label).toBeLessThanOrEqual(bounds.bottom);
      }
    } finally {
      setLocale(locale);
      await page.viewport(width, height);
    }
  },
);

it("shows a refusal naming an attached list beside the Modifiers control", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
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

type Combobox = HTMLElementTagNameMap["wt-combobox"];
function combobox(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector<Combobox>(`wt-combobox[name="${name}"]`);
}
async function pickIn(el: ProductEditor, name: string, detail: object) {
  combobox(el, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("chooses the main category in the editor itself, and saves no categoryIds or labelIds", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, primaryCategoryId: "drinks" },
    locales: ["en"],
    units: [unit],
    categories,
  });
  expect(combobox(el, "primary")!.value).toBe("drinks");
  expect(combobox(el, "labels")).toBeNull();
  // "plates" is a category the product was never in: any category can be the main one.
  await pickIn(el, "primary", { value: "plates" });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  const value = submit.mock.calls[0]![0].detail.value;
  expect(value.primaryCategoryId).toBe("plates");
  expect("categoryIds" in value).toBe(false);
  expect("labelIds" in value).toBe(false);
});

it("offers No category as the main category, and saves it as none", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, primaryCategoryId: "drinks" },
    locales: ["en"],
    units: [unit],
    categories,
  });
  expect(combobox(el, "primary")!.options[0]).toEqual({
    value: "",
    label: t("categories.none"),
  });
  await pickIn(el, "primary", { value: "" });
  const categoryText = combobox(el, "primary")!.shadowRoot!.querySelector<HTMLElement>(
    ".trigger .value",
  )!;
  expect(categoryText.textContent!.trim()).toBe(t("categories.none"));
  expect(categoryText.classList.contains("placeholder")).toBe(false);
  expect(getComputedStyle(categoryText).fontStyle).toBe("normal");
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.primaryCategoryId).toBeNull();
});

// --- The colour ---

// "wine" has no colour of its own and takes its parent's, so a chooser that read only the main
// category's own colour would say "no colour" here.
const colouredCategories: CategorySummary[] = [
  { id: "drinks", name: "Drinks", parentId: null, color: "#25b125" },
  { id: "wine", name: "Wine", parentId: "drinks", color: null },
  { id: "snacks", name: "Appetisers", parentId: null, color: "#256bb1" },
  { id: "plates", name: "Plates", parentId: null, color: null },
];
async function mountColoured(value: Partial<ProductEditorDraft> = {}) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, primaryCategoryId: "wine", ...value },
      locales: ["en"],
      units: [unit],
      categories: colouredCategories,
    })
  ).el;
}
function useCategory(el: ProductEditor) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('fieldset.color [data-color=""]')!;
}
function colourSwatch(el: ProductEditor, color: string) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`fieldset.color [data-color="${color}"]`)!;
}

it("A647 keeps colour controls in the thumbnail panel and previews the draft before saving", async () => {
  const el = await mountColoured();
  const appearance = el.shadowRoot!.querySelector<
    HTMLElementTagNameMap["dashboard-product-appearance"]
  >("dashboard-product-appearance");
  expect(appearance).not.toBeNull();
  await appearance!.updateComplete;
  const colour = el.shadowRoot!.querySelector("fieldset.color")!;
  expect(el.shadowRoot!.querySelector('[data-section="name"]')!.contains(colour)).toBe(true);
  expect(colour.checkVisibility()).toBe(false);
  appearance!.shadowRoot!.querySelector<HTMLButtonElement>(".thumb")!.click();
  expect(colour.checkVisibility()).toBe(true);
  colourSwatch(el, "#256bb1").click();
  await el.updateComplete;
  await appearance!.updateComplete;
  expect(getComputedStyle(appearance!.shadowRoot!.querySelector(".thumb")!).backgroundColor).toBe(
    "rgb(37, 107, 177)",
  );
  expect(el.currentValue.color).toBe("#256bb1");
});
function submittedValue(el: ProductEditor): ProductEditorDraft {
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  return submit.mock.calls[0]![0].detail.value;
}

it("puts the colour chooser after Name on a product of its own, its custom input named product-color", async () => {
  const el = await mountColoured();
  const group = el.shadowRoot!.querySelector("fieldset.color")!;
  expect(group.querySelector('input[type="color"]')!.getAttribute("name")).toBe("product-color");
  const name = el.shadowRoot!.querySelector('[data-section="name"]')!;
  expect(name.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(name.contains(group)).toBe(true);
  appearance(el).openPanel();
  await expect
    .element(page.elementLocator(useCategory(el)))
    .toHaveAccessibleName(t("editor.color_use_category"));
});

it("draws the Custom colour input on the same line as its label, after the word", async () => {
  const el = await mountColoured();
  el.shadowRoot!.querySelector("dashboard-product-appearance")!.openPanel();
  const label = el.shadowRoot!.querySelector<HTMLLabelElement>("fieldset.color label.custom")!;
  const input = label.querySelector("input")!.getBoundingClientRect();
  const words = document.createRange();
  words.selectNodeContents(
    [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
    )!,
  );
  const text = words.getBoundingClientRect();
  expect(input.left).toBeGreaterThanOrEqual(text.right);
  expect(input.top).toBeLessThan(text.bottom);
  expect(input.bottom).toBeGreaterThan(text.top);
});

it("describes Use category colour by the draft category's colour, and follows a category chosen since", async () => {
  const el = await mountColoured();
  const describes = (text: string) =>
    expect.element(page.elementLocator(useCategory(el))).toHaveAccessibleDescription(text);
  await describes("#25b125");
  expect(getComputedStyle(useCategory(el).querySelector(".chip")!).backgroundColor).toBe(
    "rgb(37, 177, 37)",
  );
  await pickIn(el, "primary", { value: "snacks" });
  await describes("#256bb1");
  await pickIn(el, "primary", { value: "plates" });
  await describes("");
  expect(useCategory(el).querySelector(".note, .chip")).toBeNull();
  // A category recoloured while the editor is open arrives as a new list.
  el.categories = colouredCategories.map((category) =>
    category.id === "plates" ? { ...category, color: "#7a25b1" } : category,
  );
  await el.updateComplete;
  await describes("#7a25b1");
});

it("describes the inherited choice by the venue default when the product has no category", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, primaryCategoryId: null },
    locales: ["en"],
    units: [unit],
    categories: colouredCategories,
    defaultColor: "#b12525",
  });
  await expect.element(page.elementLocator(useCategory(el))).toHaveAccessibleDescription("#b12525");
  expect(getComputedStyle(useCategory(el).querySelector(".chip")!).backgroundColor).toBe(
    "rgb(177, 37, 37)",
  );
});

it.each([
  { locale: "en-GB", useDefault: "Use default colour", useCategory: "Use category colour" },
  {
    locale: "es-ES",
    useDefault: "Usar el color predeterminado",
    useCategory: "Usar el color de la categoría",
  },
])(
  "in $locale, names the inherited choice by the venue default when no category above the product has a colour, and by the category when one does",
  async ({ locale, useDefault, useCategory: categoryLabel }) => {
    const before = currentLocale();
    setLocale(locale);
    try {
      for (const primaryCategoryId of [null, "plates"]) {
        const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
          open: true,
          value: { ...product, primaryCategoryId },
          locales: ["en"],
          units: [unit],
          categories: colouredCategories,
          defaultColor: "#b12525",
        });
        appearance(el).openPanel();
        await expect.element(page.elementLocator(useCategory(el))).toHaveAccessibleName(useDefault);
        await pickIn(el, "primary", { value: "wine" });
        await expect
          .element(page.elementLocator(useCategory(el)))
          .toHaveAccessibleName(categoryLabel);
        cleanupWidgets();
      }
    } finally {
      setLocale(before);
    }
  },
);

it("saves a chosen swatch as the product's own colour", async () => {
  const el = await mountColoured();
  expect(useCategory(el).getAttribute("aria-checked")).toBe("true");
  colourSwatch(el, "#b12525").click();
  await el.updateComplete;
  expect(colourSwatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
  expect(submittedValue(el).color).toBe("#b12525");
});

it("opens with the product's own colour chosen, and Use category colour saves none", async () => {
  const el = await mountColoured({ color: "#b12525" });
  expect(colourSwatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
  expect(useCategory(el).getAttribute("aria-checked")).toBe("false");
  useCategory(el).click();
  await el.updateComplete;
  expect(useCategory(el).getAttribute("aria-checked")).toBe("true");
  expect(submittedValue(el).color).toBeNull();
});

it("holds the colour chooser while a save is in flight", async () => {
  const el = await mountColoured();
  el.busy = true;
  await el.updateComplete;
  expect(useCategory(el).disabled).toBe(true);
  expect(colourSwatch(el, "#b12525").disabled).toBe(true);
});

it("keeps the product's own colour through a category change, and Use category colour then takes the new category's", async () => {
  const el = await mountColoured({ color: "#b12525" });
  await pickIn(el, "primary", { value: "snacks" });
  expect(colourSwatch(el, "#b12525").getAttribute("aria-checked")).toBe("true");
  expect(submittedValue(el).color).toBe("#b12525");
  // The screen's save cycle, which lets the form send again.
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  useCategory(el).click();
  await el.updateComplete;
  await expect.element(page.elementLocator(useCategory(el))).toHaveAccessibleDescription("#256bb1");
  expect(submittedValue(el).color).toBeNull();
});

it("shows no colour chooser on a variant's page, and saves no colour of its own", async () => {
  // A colour left stored on the variant: the server refuses a variant body that carries one.
  const el = await mountVariant({ ...glass, color: "#b12525" });
  expect(el.shadowRoot!.querySelector("fieldset.color")).toBeNull();
  expect(el.shadowRoot!.querySelector('[name="product-color"]')).toBeNull();
  await edit(el);
  expect(submittedValue(el).color).toBeNull();
});

it("shows a refused colour under the chooser, puts focus there, and drops it once a colour is chosen", async () => {
  expect(productEditorField("color", "en")).toBe("product-color");
  const el = await mountColoured();
  el.fieldErrors = { [productEditorField("color", "en")!]: "That colour is refused" };
  await el.updateComplete;
  const message = () =>
    el.shadowRoot!.querySelector("fieldset.color #product-color-error")!.textContent!.trim();
  expect(message()).toBe("That colour is refused");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  const custom = el.shadowRoot!.querySelector<HTMLInputElement>('input[name="product-color"]')!;
  expect(custom.getAttribute("aria-invalid")).toBe("true");
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(custom);
  colourSwatch(el, "#256bb1").click();
  await el.updateComplete;
  expect(message()).toBe("");
  expect(await bottomOf(el)).toBe("");
});

// --- The category path ---

// Listed out of order, with sibling names that sort differently by name and by id, so a tree read
// in list order, or siblings sorted by id, fails.
const tree: CategorySummary[] = [
  { id: "c-plates", name: "Plates", parentId: null, color: null },
  { id: "a-soft", name: "Soft drinks", parentId: "drinks", color: null },
  { id: "cocktails", name: "Cocktails", parentId: "b-alcohol", color: null },
  { id: "drinks", name: "Drinks", parentId: null, color: null },
  { id: "b-alcohol", name: "Drinks with alcohol", parentId: "drinks", color: null },
  { id: "z-snacks", name: "Appetisers", parentId: null, color: null },
];
const cocktailsPath = "Drinks › Drinks with alcohol › Cocktails";

type LinkCombobox = HTMLElement & {
  value: string;
  options: ComboboxOption[];
  appearance: string;
  actionLabel: string;
  label: string;
  showEmptyOption: boolean;
  error: string;
  updateComplete: Promise<unknown>;
};
async function categoryLink(el: ProductEditor): Promise<LinkCombobox> {
  const link = el.shadowRoot!.querySelector<LinkCombobox>('wt-combobox[name="primary"]')!;
  await link.updateComplete;
  return link;
}
/** The path a link trigger shows, without the hidden field name before it. */
function linkPath(link: LinkCombobox): string {
  return link.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim();
}
async function mountCategorised(value: Partial<ProductEditorDraft> = {}) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, primaryCategoryId: "cocktails", ...value },
      locales: ["en"],
      units: [unit],
      categories: tree,
    })
  ).el;
}

it("shows a product's category as its path, first in the window, with Change and no other category control", async () => {
  const el = await mountCategorised();
  const link = await categoryLink(el);
  expect(link.appearance).toBe("link");
  expect(link.actionLabel).toBe(t("editor.change_category"));
  expect(link.label).toBe(t("editor.classification"));
  expect(linkPath(link)).toBe(cocktailsPath);
  const form = el.shadowRoot!.querySelector(".form")!;
  expect(form.firstElementChild!.firstElementChild!.getAttribute("data-section")).toBe(
    "categories",
  );
  expect(form.firstElementChild!.contains(link)).toBe(true);
  expect(el.shadowRoot!.querySelectorAll('wt-combobox[name="primary"]')).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("[data-test=add-category]")).toBeNull();
});

it("keeps the category path first without an inactive notice", async () => {
  const el = await mountCategorised({ active: false });
  const link = await categoryLink(el);
  expect(el.shadowRoot!.querySelector(".form")!.firstElementChild!.contains(link)).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-test=inactive-notice]")).toBeNull();
});

it("lists No category and then every category as a tree, each under its parent and siblings by name", async () => {
  const el = await mountCategorised();
  const link = await categoryLink(el);
  expect(link.showEmptyOption).toBe(true);
  expect(link.options).toEqual([
    { value: "", label: t("categories.none") },
    { value: "z-snacks", label: "Appetisers", depth: 0, valueLabel: "Appetisers" },
    { value: "drinks", label: "Drinks", depth: 0, valueLabel: "Drinks" },
    {
      value: "b-alcohol",
      label: "Drinks with alcohol",
      depth: 1,
      valueLabel: "Drinks › Drinks with alcohol",
    },
    { value: "cocktails", label: "Cocktails", depth: 2, valueLabel: cocktailsPath },
    { value: "a-soft", label: "Soft drinks", depth: 1, valueLabel: "Drinks › Soft drinks" },
    { value: "c-plates", label: "Plates", depth: 0, valueLabel: "Plates" },
  ]);
});

it("orders numbered sibling categories by value, as the category list does", async () => {
  const el = await mountCategorised();
  el.categories = [
    { id: "c10", name: "Cat 10", parentId: null, color: null },
    { id: "c9", name: "Cat 9", parentId: null, color: null },
  ];
  await el.updateComplete;
  expect((await categoryLink(el)).options.map((option) => option.label)).toEqual([
    t("categories.none"),
    "Cat 9",
    "Cat 10",
  ]);
});

it("changes the category from Change: the path shown follows, and Save sends the chosen one", async () => {
  const el = await mountCategorised({ primaryCategoryId: "c-plates" });
  const link = await categoryLink(el);
  expect(linkPath(link)).toBe("Plates");
  await userEvent.click(link.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  const row = [...link.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent!.trim() === "Cocktails",
  )!;
  await userEvent.click(row);
  await el.updateComplete;
  await link.updateComplete;
  expect(linkPath(link)).toBe(cocktailsPath);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.primaryCategoryId).toBe("cocktails");
});

it("reads No category for a product with no category, and the path for a new one made in a category", async () => {
  const uncategorised = await mountCategorised({ primaryCategoryId: null });
  expect(linkPath(await categoryLink(uncategorised))).toBe(t("categories.none"));
  cleanupWidgets();
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
    categories: tree,
    newCategoryId: "cocktails",
  });
  expect(linkPath(await categoryLink(el))).toBe(cocktailsPath);
});

it.each([
  { locale: "en-GB", label: "No category" },
  { locale: "es-ES", label: "Sin categoría" },
])(
  "in $locale, reads $label for a product with no category, and offers it first",
  async ({ locale, label }) => {
    setLocale(locale);
    try {
      const link = await categoryLink(await mountCategorised({ primaryCategoryId: null }));
      expect(linkPath(link)).toBe(label);
      expect(link.options[0]).toEqual({ value: "", label });
    } finally {
      setLocale("es-ES");
    }
  },
);

it("names a category missing from the list as unavailable, never as No category", async () => {
  const el = await mountCategorised({ primaryCategoryId: "gone" });
  expect(linkPath(await categoryLink(el))).toBe(t("editor.missing_choice"));
});

it("puts a refused category under the path and focuses it, until another is chosen", async () => {
  const el = await mountCategorised();
  el.fieldErrors = { primary: "That category is gone" };
  await el.updateComplete;
  const link = await categoryLink(el);
  expect(link.error).toBe("That category is gone");
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(link);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  await chooseOption(link, "c-plates");
  await el.updateComplete;
  expect(link.error).toBe("");
});

/** The path a variant's page shows, as read aloud: the hidden field name, then the path. */
function variantPath(el: ProductEditor): string | undefined {
  return el.shadowRoot!.querySelector("[data-test=category-path]")?.textContent?.trim();
}

it("shows a variant's product's path as plain text, with no Change, and saves no category of its own", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    // A category left stored on the variant from before it could not have one.
    value: {
      ...glass,
      primaryCategoryId: "c-plates",
      inherited: { ...parentValues, primaryCategoryId: "cocktails" },
    },
    locales: ["en"],
    units: [unit, litre],
    categories: tree,
  });
  expect(el.shadowRoot!.querySelector('wt-combobox[name="primary"]')).toBeNull();
  expect(variantPath(el)).toBe(`${t("editor.classification")}: ${cocktailsPath}`);
  const form = el.shadowRoot!.querySelector(".form")!;
  expect(form.firstElementChild!.firstElementChild!.getAttribute("data-section")).toBe(
    "categories",
  );
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.primaryCategoryId).toBeNull();
});

it("reads No category, or unavailable, on a variant whose product has no category or a missing one", async () => {
  const label = t("editor.classification");
  for (const [primaryCategoryId, shown] of [
    [null, t("categories.none")],
    ["gone", t("editor.missing_choice")],
  ] as const) {
    const el = await mountVariant({
      ...glass,
      inherited: { ...parentValues, primaryCategoryId },
    });
    expect(variantPath(el)).toBe(`${label}: ${shown}`);
    cleanupWidgets();
  }
});

it("says a refused category on a variant's page in the message above Save, having no field for it", async () => {
  const el = await mountVariant();
  el.fieldErrors = { primary: "A variant takes its product's category" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe("A variant takes its product's category");
});

it("activates a nutritional chip with Enter without saving or closing the window", async () => {
  const el = await mountPricing({ ...saved, allergens: { milk: {} } });
  const cancelled = vi.fn(),
    submit = vi.fn();
  el.addEventListener("wt-cancel", cancelled);
  el.addEventListener("wt-submit", submit);
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-choice="allergen-eggs"]')!.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.currentValue.allergens).toEqual({ milk: {}, eggs: {} });
  expect(submit).not.toHaveBeenCalled();
  expect(cancelled).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
});
it("saves a cereal clicked in the chips after Details is collapsed", async () => {
  const el = await mountPricing({ ...saved, allergens: {} });
  const cancelled = vi.fn();
  el.addEventListener("wt-cancel", cancelled);
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  await userEvent.click(
    picker.shadowRoot!.querySelector<HTMLElement>('[data-choice="allergen-gluten"]')!,
  );
  await el.updateComplete;
  await picker.updateComplete;
  await userEvent.click(
    picker.shadowRoot!.querySelector<HTMLElement>('[data-choice="kind-gluten-wheat"]')!,
  );
  await el.updateComplete;
  const fold = folded(el, "details");
  await fold.updateComplete;
  await userEvent.click(fold.shadowRoot!.querySelector<HTMLElement>("button.header")!);
  await fold.updateComplete;
  expect(fold.open).toBe(false);
  expect(detailsPart(el, "nutrition")[0]!.value).toContain(allergenName("gluten"));
  expect(cancelled).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!.open).toBe(
    true,
  );
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.allergens).toEqual({
    gluten: { kinds: ["wheat" as const] },
  });
});
it("offers all six product dietary declarations without changing the saved set", async () => {
  const el = await mountPricing({ ...saved, dietaryDeclarations: ["vegan", "halal"] });
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  expect(
    [...picker.shadowRoot!.querySelectorAll<HTMLElement>('[data-choice^="diet-"]')].map(
      (button) => button.dataset.choice,
    ),
  ).toEqual([
    "diet-vegan",
    "diet-vegetarian",
    "diet-halal",
    "diet-kosher",
    "diet-no_meat",
    "diet-no_fish",
  ]);
  expect(el.currentValue.dietaryDeclarations).toEqual(["vegan", "halal"]);
});
it("associates a server refusal with its dropdown until the next save", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    fieldErrors: { "product-course": "That course is gone" },
  });
  // The dropdown's own button carries the marking, and the sentence it names is inside it.
  const box = el.shadowRoot!.querySelector<
    HTMLElement & { error: string; updateComplete: Promise<unknown> }
  >("wt-combobox[name=product-course]")!;
  await box.updateComplete;
  const select = box.shadowRoot!.querySelector(".trigger")!;
  expect(select.getAttribute("aria-invalid")).toBe("true");
  expect(
    box.shadowRoot!.getElementById(select.getAttribute("aria-describedby")!)!.textContent,
  ).toBe("That course is gone");
  expect(box.error).toBe("That course is gone");
  // Submitting again is past the refusal.
  await edit(el);
  await box.updateComplete;
  expect(box.error).toBe("That course is gone");
  save(el);
  await el.updateComplete;
  await box.updateComplete;
  expect(select.getAttribute("aria-invalid")).toBe("false");
});

it("saves a variant with no price of its own, which sells at the product's", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [{ ...small, unitPrice: null }, large] },
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
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
    new CustomEvent("wt-edit", {
      detail: { index: 1, via: "menu" },
      bubbles: true,
      composed: true,
    }),
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

it("opens a variant's edit window when its row is clicked", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
  });
  const table = variantTable(el)! as HTMLElement & { updateComplete: Promise<unknown> };
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-row-1"]')!.click();
  await el.updateComplete;
  expect(variantForm(el).open).toBe(true);
  expect(variantForm(el).value).toEqual(large);
});

it("names the product's unit in the variants table's price column", async () => {
  await atDesktopWidth(async () => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, variants: [small, large] },
      locales: ["en"],
      units: [unit],
    });
    const table = variantTable(el)!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('[data-test="pricing-unit"]')!;
    expect(select.getClientRects().length).toBeGreaterThan(0);
    await select.updateComplete;
    expect(select.textContent!.trim()).toBe("ea");
  });
});

it("saves course with a new product, without a separate routing event", async () => {
  const routed = vi.fn();
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
    defaultTakeawayVatRate: "21.00",
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  el.addEventListener("wt-set-product-course", routed);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await openSection(el, "details");
  await input(el, "name", "Omelette");
  await chooseOption(combobox(el, "product-course")!, "course-1");
  await el.updateComplete;
  save(el);
  expect(routed).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    name: "Omelette",
    customerName: null,
    description: null,
    kitchenName: null,
    image: null,
    unitId: null,
    unitPrice: "0.00",
    active: true,
    available: true,
    ordering: "public",
    vatClass: null,
    takeawayVatRate: "21.00",
    variants: [],
    primaryCategoryId: null,
    color: null,
    modifiers: [],
    allergens: null,
    dietaryDeclarations: [],
    courseId: "course-1",
  });
});

it("preselects the saved course", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "product-1", courseId: "course-1" },
    locales: ["en"],
    units: [unit],
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  await openSection(el, "details");
  const course = combobox(el, "product-course")!;
  expect(course.value).toBe("course-1");
  expect(await shownIn(el, "product-course")).toBe("Starters");
});

it("saves only once and refuses a second press", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.variants).toEqual([small, large]);
});

// The Available switch is "sold out for now" and writes only `available`; whether the
// product exists is `active`, which the editor carries through untouched and changes only by Restore.
it("sends the Available switch as available and leaves active as it was", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1" },
    locales: ["en"],
    units: [unit],
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

/** Reads the three visible choices and the chosen explanation in Selling. */
async function orderingTexts(el: ProductEditor): Promise<[string, string][]> {
  await openSection(el, "details");
  const field = sharedField(el, "wt-combobox", "ordering");
  await field.updateComplete;
  const rows = [...field.shadowRoot!.querySelectorAll<HTMLElement>('[role="radio"]')];
  for (const row of rows) expect(row.checkVisibility()).toBe(true);
  return rows.map((row) => [
    row.textContent!.trim(),
    row.getAttribute("aria-checked") === "true"
      ? field.shadowRoot!.querySelector(".hint")!.textContent!.trim()
      : "",
  ]);
}
async function pickOrdering(el: ProductEditor, value: string): Promise<void> {
  await chooseOption(sharedField(el, "wt-combobox", "ordering"), value);
  await el.updateComplete;
}

it("offers who may order the product on its own as three choices, the saved one chosen, and saves the one picked", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1", ordering: "not_sold_separately" },
    locales: ["en"],
    units: [unit],
  });
  const field = sharedField(el, "wt-combobox", "ordering");
  expect(section(el, "details").contains(field)).toBe(true);
  expect(field.label).toBe(t("editor.ordered_on_own"));
  expect(field.options.map((option) => option.value)).toEqual([
    "public",
    "staff_only",
    "not_sold_separately",
  ]);
  expect(field.value).toBe("not_sold_separately");
  expect(await shownIn(el, "ordering")).toBe(t("product.ordering_not_sold_separately"));
  expect(el.shadowRoot!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await pickOrdering(el, "staff_only");
  expect(el.currentValue.ordering).toBe("staff_only");
  expect(await shownIn(el, "ordering")).toBe(t("product.ordering_staff_only"));
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.ordering).toBe("staff_only");
});

it("shows only the chosen ordering's explanation underneath the choices", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, ordering: "staff_only" },
    locales: ["en"],
    units: [unit],
  });
  await openSection(el, "details");
  const field = sharedField(el, "wt-combobox", "ordering");
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector(".hint")!.textContent!.trim()).toBe(
    t("product.ordering_staff_only_hint"),
  );
  for (const ordering of ["public", "not_sold_separately"] as const)
    expect(field.shadowRoot!.textContent).not.toContain(t(`product.ordering_${ordering}_hint`));
});

it("starts a new product with Anyone ordering", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
  });
  expect(sharedField(el, "wt-combobox", "ordering").value).toBe("public");
  expect(await shownIn(el, "ordering")).toBe(t("product.ordering_public"));
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Water");
  await input(el, "unit-price", "1.00");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.ordering).toBe("public");
});

it("describes Staff only ordering briefly in English and Spanish", async () => {
  const mount = () =>
    mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: product,
      locales: ["en"],
      units: [unit],
    });
  setLocale("en-GB");
  try {
    const { el } = await mount();
    expect(sharedField(el, "wt-combobox", "ordering").label).toBe("Standalone ordering by");
    expect(await orderingTexts(el)).toEqual([
      ["Anyone", "Can be ordered on its own."],
      ["Staff only", ""],
      ["Nobody", ""],
    ]);
    cleanupWidgets();
    setLocale("es-ES");
    const { el: spanish } = await mount();
    expect(sharedField(spanish, "wt-combobox", "ordering").label).toBe("Pedir por separado");
    expect(await orderingTexts(spanish)).toEqual([
      ["Cualquiera", "Se puede pedir por sí solo."],
      ["Solo el personal", ""],
      ["Nadie", ""],
    ]);
  } finally {
    setLocale("es-ES");
  }
});

it("locks the ordering choices while a save is in flight", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
    busy: true,
  });
  expect(sharedField(el, "wt-combobox", "ordering").disabled).toBe(true);
  el.busy = false;
  await el.updateComplete;
  expect(sharedField(el, "wt-combobox", "ordering").disabled).toBe(false);
});

it("puts a refusal of the ordering under its choice group, focusing it, until another choice is picked", async () => {
  expect(productEditorField("ordering", "es")).toBe("ordering");
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, ordering: "staff_only" },
    locales: ["en"],
    units: [unit],
  });
  el.fieldErrors = { ordering: t("editor.field_rejected") };
  await el.updateComplete;
  const field = sharedField(el, "wt-combobox", "ordering");
  expect(field.error).toBe(t("editor.field_rejected"));
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("[data-error]")!.textContent!.trim()).toBe(
    t("editor.field_rejected"),
  );
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe("ordering");
  expect((el.shadowRoot!.activeElement as Field).value).toBe("staff_only");
  expect(
    el.shadowRoot!.activeElement!.shadowRoot!.activeElement?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

  await pickOrdering(el, "not_sold_separately");
  expect(field.error).toBe("");
  expect(await bottomOf(el)).toBe("");
});

it("creates a new product Active", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Water");
  await input(el, "unit-price", "1.00");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.active).toBe(true);
});

it.each([true, false])("offers no Enable or inactive notice for active=%s", async (active) => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1", active, available: false },
    locales: ["en"],
    units: [unit],
  });
  expect(el.shadowRoot!.querySelector("[data-test=restore]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=inactive-notice]")).toBeNull();
  expect(el.currentValue.available).toBe(false);
});

it("saves a disabled product's other edits without enabling it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, id: "p1", active: false },
    locales: ["en"],
    units: [unit],
  });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.active).toBe(false);
  expect(submit.mock.calls[0]![0].detail.value.kitchenName).toBe("COUNTER");
});

it("summarises Details' groups from their filled-in values", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      image: "abc.png",
      courseId: "course-1",
      allergens: { milk: {} },
      dietaryDeclarations: ["vegan"],
    },
    locales: ["en", "es"],
    units: [unit],
    courses: [{ id: "course-1", name: "Starters" }],
  });
  expect(detailsPart(el, "kitchen")).toEqual([
    { label: t("editor.kitchen_name"), value: "BAR" },
    { label: t("editor.summary_course"), value: "Starters" },
  ]);
  // The image is not on the line: the photo sits beside Name.
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: House coffee · ES: Café de la casa" },
    { label: t("editor.description"), value: "EN: Freshly roasted" },
  ]);
  // The dashboard's shipped locale is Spanish, so these summaries are the Spanish strings.
  expect(detailsPart(el, "nutrition")).toEqual([
    { label: t("modifiers.allergens"), value: allergenName("milk") },
    {
      label: t("editor.nutrition.dietary"),
      value: `Vegano, ${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}`,
    },
  ]);
});

it("keeps stored regional names and descriptions separate when editing main-language text", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      customerName: { "en-GB": "House coffee", "es-ES": "Café de la casa" },
      description: { "en-GB": "Freshly roasted" },
    },
    locales: ["en", "es"],
    units: [unit],
  });
  expect(detailsPart(el, "descriptors")).toEqual([]);
  await openSection(el, "details");
  expect(control<HTMLInputElement>(el, "customer-name-en").value).toBe("");
  expect(control<HTMLTextAreaElement>(el, "description-en").value).toBe("");
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "description-en", "Dark roast");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    ...product,
    customerName: { "en-GB": "House coffee", "es-ES": "Café de la casa" },
    description: { "en-GB": "Freshly roasted", en: "Dark roast" },
  });
});

it("reports a Cancel when its window is dismissed, never when the screen shuts it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
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
  });
  const submit = vi.fn();
  const cancelled = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancelled);
  variantTable(el)!.dispatchEvent(
    new CustomEvent("wt-edit", {
      detail: { index: 0, via: "menu" },
      bubbles: true,
      composed: true,
    }),
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
  });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  // The message above Save alone cannot say WHICH variant is wrong, and a variant has no field in
  // this form.
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
  });
  await edit(el);
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
  expect(productEditorField("vatClass", "es")).toBeNull();
  expect(productEditorField("primaryCategoryId", "es")).toBe("primary");
  expect(productEditorField("variants.2.unitPrice", "es")).toBe("variant-2-price");
  expect(productEditorField("variants.0.name", "es")).toBe("variant-0-name");
  // A refused attachment names a POSITION in the product's list; the Modifiers section holds one
  // control, so every position reports there.
  expect(productEditorField("modifiers.0.id", "es")).toBe("modifier");
  expect(productEditorField("modifiers.11.id", "es")).toBe("modifier");
  expect(productEditorField("courseId", "es")).toBe("product-course");
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
    units: [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "kg",
        name: { en: "Kilogram" },
        abbreviation: { en: "kg" },
      },
    ],
  });
  // Each is a chosen unit like any other, so the price field's button names it rather than asking
  // the person to choose — which is the only thing on screen until they open the chooser.
  expect(el.shadowRoot!.querySelector("[name=unit-price]")!.getAttribute("unit")).toBe(
    t("editor.unit_each"),
  );
  await openUnits(el);
  const select = combobox(el, "unit")!;
  expect(select.value).toBe(EACH_CHOICE);
  expect(await shownIn(el, "unit")).toBe(t("editor.unit_each"));
  expect(el.shadowRoot!.querySelector('[data-test="add-unit"]')).toBeTruthy();
});

it("submits unitId null when Each stays selected", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [
      {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "kg",
        name: { en: "Kilogram" },
        abbreviation: { en: "kg" },
      },
    ],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Water");
  await input(el, "unit-price", "1.00");
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBeNull();
});

it("draws Each as a chosen unit on a product, not as the grey prompt for nothing chosen, and saves no unit", async () => {
  const kg = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "kg",
    name: { en: "Kilogram" },
    abbreviation: { en: "kg" },
  };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: null },
    locales: ["en"],
    units: [kg],
  });
  await openUnits(el);
  const box = sharedField(el, "wt-combobox", "unit");
  const each = box.options.find((option) => option.label === t("editor.unit_each"))!;
  expect(each.value).not.toBe("");
  expect(box.value).toBe(each.value);
  expect(await shownIn(el, "unit")).toBe(t("editor.unit_each"));
  expect(box.shadowRoot!.querySelector(".trigger .value")!.classList).not.toContain("placeholder");
  await chooseOption(box, kg.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(kg.id);
  await openUnits(el);
  await chooseOption(sharedField(el, "wt-combobox", "unit"), each.value);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBeNull();
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBeNull();
});

it("submits the chosen real unit and marks it selected after load", async () => {
  const kg = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "kg",
    name: { en: "Kilogram" },
    abbreviation: { en: "kg" },
  };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, unitId: kg.id },
    locales: ["en"],
    units: [kg],
  });
  await openUnits(el);
  const select = combobox(el, "unit")!;
  expect(select.value).toBe(kg.id);
  expect(await shownIn(el, "unit")).toBe("Kilogram (kg)");
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBe(kg.id);
});

// A one-line row only reads as a row when its text and its 44px controls share one middle. Geometry
// is the only thing that can catch it; every attribute assertion passes either way.
it("keeps an attached row's name, type, grip and row menu on one line", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
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

it.each([
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "puts an attached row's grip, type and row menu on the first line of a wrapping list name at %ipx (%s)",
  async (frame, theme) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mountWidget<ProductEditor>(
        "dashboard-product-editor",
        {
          open: true,
          value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
          locales: ["en"],
          units: [unit],
          extraLists: [
            {
              ...extraLists[0]!,
              name: "Sauces, dips and dressings made in the kitchen every morning from whatever the market had, served cold in small pots beside the plate, with more on request at no charge to the table",
            },
          ],
          optionLists,
        },
        theme,
      );
      expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
      const row = attachedRows(el)[0]!;
      const name = row.querySelector("[data-test=modifier-name]")!;
      const handle = row.querySelector<HTMLElement>(".handle")!;

      expect(window.innerWidth).toBe(frame);
      expect(row.getBoundingClientRect().height).toBeGreaterThan(
        handle.getBoundingClientRect().height * 1.5,
      );
      expect(textLines(name).length, "the name wraps").toBeGreaterThan(1);
      const line = textLines(name)[0]!;
      const within = middleWithin(line);
      const icon = (handle.querySelector("wt-icon") ?? handle).getBoundingClientRect();
      const menu = row.querySelector("wt-row-actions")!.getBoundingClientRect();
      const kind = textLines(row.querySelector("[data-test=modifier-kind]")!)[0]!;
      expect(
        { icon: within(icon), menu: within(menu), kind: within(kind) },
        JSON.stringify({ line, icon, menu, kind }),
      ).toEqual({ icon: true, menu: true, kind: true });
    } finally {
      await page.viewport(width, height);
    }
  },
);

it.each([
  { locale: "en-GB", font: "default" },
  { locale: "es-ES", font: "default" },
  { locale: "en-GB", font: "Verdana" },
  { locale: "es-ES", font: "Verdana" },
])(
  "keeps every attached extras and options row's menu on screen at 390 px ($locale, font: $font)",
  async ({ locale, font }) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    const previous = currentLocale();
    try {
      setLocale(locale);
      await page.viewport(390, 844);
      expect(window.innerWidth).toBe(390);
      const { el, host } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: {
          ...product,
          modifiers: [
            { kind: "extras", id: "sauces" },
            { kind: "options", id: "cooked" },
            { kind: "extras", id: "shared" },
          ],
        },
        locales: ["en"],
        units: [unit],
        extraLists: [
          {
            ...extraLists[0]!,
            name: "Sauces, dips and dressings made in the kitchen every morning, served cold",
          },
          { ...extraLists[1]!, name: "Neighbourhoodartisanbakerysinceeighteenseventy" },
        ],
        optionLists: [optionLists[0]!],
      });
      if (font === "Verdana") {
        const family = getComputedStyle(host).getPropertyValue("--wt-font-family");
        expect(family).not.toBe("");
        host.style.setProperty("--wt-font-family", `Verdana, ${family}`);
      }
      await el.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rows = attachedRows(el);
      expect(rows).toHaveLength(3);
      const wrap = rows[0]!.closest<HTMLElement>(".table-wrap")!;
      expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth);
      const edge = wrap.getBoundingClientRect().right;
      for (const [index, row] of rows.entries()) {
        const menu = row.querySelector("wt-row-actions")!.getBoundingClientRect();
        expect(menu.width, `row ${index} is drawn`).toBeGreaterThan(0);
        expect(menu.right, `row ${index}`).toBeLessThanOrEqual(edge);
        expect(menu.right, `row ${index} against the screen`).toBeLessThanOrEqual(
          window.innerWidth,
        );
      }
    } finally {
      setLocale(previous);
      await page.viewport(width, height);
    }
  },
);

// --- The parent's variants section ---

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

it("names the product in the variant window as its form holds the name now, unsaved", async () => {
  setLocale("en-GB");
  try {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: product,
      locales: ["en"],
      units: [unit],
    });
    await input(el, "name", "Flat white");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
    await el.updateComplete;
    const form = variantForm(el);
    await form.updateComplete;
    const modal = form.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("h2")!.textContent).toBe("Add variant to: Flat white");
  } finally {
    setLocale("es-ES");
  }
});

it("adds nothing when the first Add variant is cancelled", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit],
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

it("puts a unit holding a replacement pattern into the price labels as written", async () => {
  const odd = { ...unit, abbreviation: { en: "ea $&" } };
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [odd],
  });
  const price = el.shadowRoot!.querySelector<HTMLElement & { label: string; unit: string }>(
    "[name=unit-price]",
  )!;
  expect(price.label).toBe(t("editor.base_price_unit").split("{unit}").join("ea $&"));
  expect(price.unit).toBe(t("editor.per_unit").split("{unit}").join("ea $&"));
});

it("keeps the price field beside the variants, labelled as the base price", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
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

it("keeps a variant archived in this draft from the variants section", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
  });
  await tableEvent(el, "wt-remove", { index: 1 });
  await tableEvent(el, "wt-restore", { index: 1 });
  expect(el.currentValue.variants[1]).toEqual(large);
});

it("never reactivates an Inactive variant on a save that did not restore it", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, { ...large, active: false }] },
    locales: ["en"],
    units: [unit],
  });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  await input(el, "name", "Coffee to go");
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.variants).toEqual([
    small,
    { ...large, active: false },
  ]);
});

it("asks the screen to open a saved variant's own page", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small, large] },
    locales: ["en"],
    units: [unit],
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
    value: { ...product, image: mediaTestReference("coffee.png"), variants: [small, large] },
    locales: ["en"],
    units: [unit],
  });
  await input(el, "unit-price", "9.50");
  const table = variantTable(el) as unknown as { basePrice: string };
  expect(table.basePrice).toBe("9.50");
  const form = variantForm(el) as unknown as { basePrice: string; inheritedImage: string | null };
  expect(form.basePrice).toBe("9.50");
  expect(form.inheritedImage).toBe(mediaTestReference("coffee.png"));
});

// --- A variant's own page ---

// The parent's value for every inherited field, each DIFFERENT from what the variant might set, so
// an assertion can tell a hint read from the parent from a value read from the variant.
const litre = {
  staffName: "Staff unit",
  staffAbbreviation: "su",
  id: "litre",
  name: { en: "Litre" },
  abbreviation: { en: "l" },
};
const parentValues: InheritedValues = {
  name: "Coffee",
  description: { en: "Roasted in house" },
  image: mediaTestReference("coffee.png"),
  unitPrice: "9.00",
  vatClass: "reduced",
  takeawayVatRate: "10.00",
  unitId: litre.id,
  primaryCategoryId: "drinks",
  courseId: "mains",
  allergens: { milk: {} },
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
  takeawayVatRate: null,
  primaryCategoryId: null,
  allergens: null,
  dietaryDeclarations: null,
  courseId: null,
};
const courses = [
  { id: "mains", name: "Mains" },
  { id: "desserts", name: "Desserts" },
];

async function mountVariant(value: ProductEditorDraft = glass) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value,
      locales: ["en"],
      units: [unit, litre],
      categories,
      courses,
      dineInVatRate: "10.00",
      api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never,
    })
  ).el;
}
function control<T = HTMLElement>(el: ProductEditor, name: string) {
  return el.shadowRoot!.querySelector(`[name="${name}"]`) as unknown as T;
}
function firstOption(el: ProductEditor, name: string) {
  return combobox(el, name)!.options[0]!;
}
function inheritedNutrition(el: ProductEditor, name: string) {
  const label = t(name === "allergens" ? "modifiers.allergens" : "editor.nutrition.dietary");
  const field = detailsPart(el, "nutrition").find((entry) => entry.label === label);
  return field?.placeholder ? `${field.label}: ${field.value}` : undefined;
}

it("titles a variant's page as a variant, with no Modifiers or Variants group", async () => {
  const el = await mountVariant();
  expect(el.shadowRoot!.querySelector("wt-modal")!.getAttribute("heading")).toBe(
    t("editor.edit_variant_of").replace("{name}", "Coffee"),
  );
  expect(group(el, "modifiers")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=add-variant]")).toBeNull();
  expect(variantTable(el)).toBeNull();
});

it("shows replacement-marker characters literally in a variant parent's name", async () => {
  const previous = currentLocale();
  try {
    setLocale("en");
    const el = await mountVariant({
      ...glass,
      inherited: { ...parentValues, name: "$& coffee $` $'" },
    });
    expect(el.shadowRoot!.querySelector("wt-modal")!.getAttribute("heading")).toBe(
      "Edit variant of: $& coffee $` $'",
    );
  } finally {
    setLocale(previous);
  }
});

// Who may order a dish on its own is read from the dish; a variant is only ever ordered under it.
it("shows no standalone ordering choice on a variant's page, and keeps the variant's own value", async () => {
  const el = await mountVariant({ ...glass, ordering: "public" });
  expect(section(el, "ordering")).toBeNull();
  expect(combobox(el, "ordering")).toBeNull();
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.ordering).toBe("public");
  expect(submit.mock.calls[0]![0].detail.value.name).toBe("Glass of coffee");
  expect(submit.mock.calls[0]![0].detail.value).not.toHaveProperty("inherited");
});

it("shows a variant's inherited price and description empty, with the parent's value as the hint", async () => {
  const el = await mountVariant();
  const price = control<{ value: string; placeholder: string; required: boolean }>(
    el,
    "unit-price",
  );
  expect(price.value).toBe("");
  expect(price.placeholder).toBe("9.00");
  // A variant's price is optional: blank sells at the base price.
  expect(price.required).toBe(false);
  const description = control<HTMLTextAreaElement>(el, "description-en");
  expect(description.value).toBe("");
  expect(description.placeholder).toBe("Roasted in house");
});

// Storage inherits a variant's description as ONE value across every language
// (`packages/menu/src/variant-fallback.ts`), so a language left blank beside one with text reads
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
    categories,
  });
  return el;
}
const placeholders = (el: ProductEditor, locales = ["en", "es"]) =>
  locales.map((locale) => control<HTMLTextAreaElement>(el, `description-${locale}`).placeholder);

it("hints a variant's description with its parent's only while every language is blank", async () => {
  const el = await mountBilingualVariant();
  expect(placeholders(el)).toEqual(["Roasted in house", "Tostado en casa"]);
  await input(el, "description-en", "Served in a glass");
  expect(placeholders(el)).toEqual(["", "Served in a glass"]);
  await input(el, "description-en", "  ");
  expect(placeholders(el)).toEqual(["Roasted in house", "Tostado en casa"]);
});

it("shows no description hint on a variant described only in a language other than the default", async () => {
  const el = await mountBilingualVariant({ es: "Servido en vaso" });
  expect(placeholders(el)).toEqual(["", ""]);
});

it("hints a product's blank description in another language with the default-language one, as it is typed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
  });
  expect(placeholders(el)).toEqual(["", "Freshly roasted"]);
  await input(el, "description-en", "Dark roast");
  expect(placeholders(el)).toEqual(["", "Dark roast"]);
  await input(el, "description-en", "");
  expect(placeholders(el)).toEqual(["", ""]);
});

it("leaves a product's default-language description unhinted when only another language has one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, description: { es: "Recién tostado" } },
    locales: ["en", "es"],
    units: [unit],
  });
  expect(control<HTMLTextAreaElement>(el, "description-en").placeholder).toBe("");
});

it("hints a variant's description in a language its parent left blank with the parent's default-language one", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...glass, inherited: { ...parentValues, description: { en: "Roasted in house" } } },
    locales: ["en", "es"],
    units: [unit, litre],
    categories,
  });
  expect(placeholders(el)).toEqual(["Roasted in house", "Roasted in house"]);
});

it("hints a variant's blank language with its own default-language description, as it is typed", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...glass,
      description: { es: "Servido en vaso" },
      inherited: { ...parentValues, description: { es: "Tostado en casa", ca: "Torrat a casa" } },
    },
    locales: ["es", "ca"],
    units: [unit, litre],
    categories,
  });
  expect(placeholders(el, ["es", "ca"])).toEqual(["", "Servido en vaso"]);
  await input(el, "description-es", "Servido en copa");
  expect(placeholders(el, ["es", "ca"])).toEqual(["", "Servido en copa"]);
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

const nameHints = (el: ProductEditor, locales: readonly string[]) =>
  ["kitchen-name", ...locales.map((locale) => `customer-name-${locale}`)].map(
    (name) => control<{ placeholder: string }>(el, name).placeholder,
  );

it("hints a product's blank names with what they fall back to, following the fields they copy", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, customerName: null, kitchenName: null },
    locales: ["en", "es"],
    units: [unit],
  });
  expect(nameHints(el, ["en", "es"])).toEqual(["Coffee", "Coffee", "Coffee"]);
  await input(el, "customer-name-en", "House coffee");
  expect(nameHints(el, ["en", "es"])).toEqual(["Coffee", "Coffee", "House coffee"]);
  await input(el, "name", "Espresso");
  expect(nameHints(el, ["en", "es"])).toEqual(["Espresso", "Espresso", "House coffee"]);
  await input(el, "customer-name-en", " ");
  expect(nameHints(el, ["en", "es"])).toEqual(["Espresso", "Espresso", "Espresso"]);
});

it("never hints a product's customer-facing names with its kitchen name, which keeps its own text", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, customerName: null },
    locales: ["en", "es"],
    units: [unit],
  });
  const kitchenName = () => control<{ value: string }>(el, "kitchen-name").value;
  expect(kitchenName()).toBe("BAR");
  expect(nameHints(el, ["en", "es"]).slice(1)).toEqual(["Coffee", "Coffee"]);
  await input(el, "customer-name-en", "House coffee");
  expect(nameHints(el, ["en", "es"]).slice(1)).toEqual(["Coffee", "House coffee"]);
  await input(el, "kitchen-name", "ESPRESSO BAR");
  expect(kitchenName()).toBe("ESPRESSO BAR");
  expect(nameHints(el, ["en", "es"]).slice(1)).toEqual(["Coffee", "House coffee"]);
});

it("hints a variant's blank names on its own page with the variant's name", async () => {
  const el = await mountVariant({ ...glass, customerName: null, kitchenName: null });
  expect(nameHints(el, ["en"])).toEqual(["Glass of coffee", "Glass of coffee"]);
  await input(el, "name", "Tall glass");
  expect(nameHints(el, ["en"])).toEqual(["Tall glass", "Tall glass"]);
});

it("never hints a variant's names from the parent's", async () => {
  const el = await mountVariant({ ...glass, customerName: null, kitchenName: null });
  const expected = {
    name: "",
    "customer-name-en": "Glass of coffee",
    "kitchen-name": "Glass of coffee",
  };
  for (const [name, hint] of Object.entries(expected))
    expect(control<{ placeholder: string }>(el, name).placeholder, name).toBe(hint);
});

it("offers each inherited choice first as the parent's value, with an empty value", async () => {
  const el = await mountVariant();
  const expected = {
    "product-course": "Mains",
  };
  for (const [name, text] of Object.entries(expected)) {
    const option = firstOption(el, name);
    expect(option.value, name).toBe("");
    expect(option.label, name).toBe(text);
    expect(combobox(el, name)!.value, name).toBe("");
  }
  // The price field names the unit the variant sells in: the parent's.
  expect(control<{ unit: string }>(el, "unit-price").unit).toBe(
    t("editor.per_unit").replace("{unit}", "l"),
  );
});

it.each([
  { locale: "en-GB", label: "Price", unit: "Each" },
  { locale: "es-ES", label: "Precio", unit: "Unidad" },
])(
  "labels a variant's price $label with the fixed unit $unit when the parent has no unit ($locale)",
  async ({ locale, label, unit }) => {
    setLocale(locale);
    try {
      const el = await mountVariant({ ...glass, inherited: { ...parentValues, unitId: null } });
      const price = control<{ label: string; unit: string; fixedUnit: boolean }>(el, "unit-price");
      expect(price.label).toBe(label);
      expect(price.unit).toBe(unit);
      expect(price.fixedUnit).toBe(true);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("marks a variant's own choice selected over the parent's value", async () => {
  const el = await mountVariant({
    ...glass,
    courseId: "desserts",
  });
  expect(combobox(el, "product-course")!.value).toBe("desserts");
  expect(await shownIn(el, "product-course")).toBe("Desserts");
});

it("shows the parent's category, inherited nutritional values and photo", async () => {
  const el = await mountVariant();
  expect(variantPath(el)).toBe(`${t("editor.classification")}: Drinks`);
  expect(inheritedNutrition(el, "allergens")).toBe(
    `${t("modifiers.allergens")}: ${allergenName("milk")}`,
  );
  expect(inheritedNutrition(el, "dietary")).toBe(
    `${t("editor.nutrition.dietary")}: ${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}`,
  );
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  expect(upload.inheritedImage).toBe(mediaTestReference("coffee.png"));
  expect(upload.image).toBeNull();
});

it("hints what a variant will actually use where its parent names nothing there", async () => {
  const el = await mountVariant({
    ...glass,
    inherited: {
      ...parentValues,
      primaryCategoryId: null,
      courseId: null,
      allergens: {},
      dietaryDeclarations: [],
    },
  });
  expect(variantPath(el)).toBe(`${t("editor.classification")}: ${t("categories.none")}`);
  expect(combobox(el, "product-course")!.placeholder).toBe(t("modifiers.none_specified"));
  expect(
    combobox(el, "product-course")!
      .shadowRoot!.querySelector(".trigger .value")!
      .classList.contains("placeholder"),
  ).toBe(true);
  expect(inheritedNutrition(el, "allergens")).toBe(
    `${t("modifiers.allergens")}: ${t("editor.nutrition.allergens_none")}`,
  );
  expect(inheritedNutrition(el, "dietary")).toBeUndefined();
});

it("hints a parent's allergens not yet reviewed as that, never as none", async () => {
  const el = await mountVariant({ ...glass, inherited: { ...parentValues, allergens: null } });
  expect(inheritedNutrition(el, "allergens")).toBe(
    `${t("modifiers.allergens")}: ${t("editor.allergens_unreviewed")}`,
  );
});

it("names a parent's course or unit missing from the lists as unavailable, never as none", async () => {
  const el = await mountVariant({
    ...glass,
    inherited: { ...parentValues, courseId: "gone", unitId: "gone" },
  });
  expect(combobox(el, "product-course")!.placeholder).toBe(t("editor.missing_choice"));
  expect(firstOption(el, "product-course")).toEqual({
    value: "",
    label: t("editor.missing_choice"),
  });
  expect(control<{ unit: string }>(el, "unit-price").unit).toBe(
    t("editor.per_unit").replace("{unit}", t("editor.missing_choice")),
  );
});

function priceInput(el: ProductEditor) {
  return control<HTMLElementTagNameMap["wt-price-input"]>(el, "unit-price");
}
async function unitButton(el: ProductEditor) {
  const price = priceInput(el);
  await price.updateComplete;
  return price.shadowRoot!.querySelector("button.unit");
}

it("shows a variant's product's unit as fixed text in the price field, with no unit button or dropdown, and saves no unit of its own", async () => {
  // A unit left stored on the variant from before it could not have one.
  const el = await mountVariant({ ...glass, unitId: unit.id });
  const price = priceInput(el);
  expect(price.fixedUnit).toBe(true);
  expect(price.unit).toBe(t("editor.per_unit").replace("{unit}", "l"));
  expect(price.label).toBe(t("editor.price_unit").replace("{unit}", "l"));
  expect(await unitButton(el)).toBeNull();
  expect(price.shadowRoot!.querySelector("span.unit")!.textContent).toBe(price.unit);
  await openUnits(el);
  expect(combobox(el, "unit")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=add-unit]")).toBeNull();
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.unitId).toBeNull();
});

it("says a refused unit on a variant's page in the message above Save, opening no unit dropdown", async () => {
  const el = await mountVariant();
  el.fieldErrors = { unit: "A variant takes its product's unit" };
  await el.updateComplete;
  expect(await bottomOf(el)).toBe("A variant takes its product's unit");
  expect(combobox(el, "unit")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=add-unit]")).toBeNull();
});

it("keeps a product's unit button, its dropdown and Add unit on the product's own page", async () => {
  const el = await mountPricing(
    { ...product, id: "coffee", unitId: litre.id },
    { units: [unit, litre] },
  );
  expect(priceInput(el).fixedUnit).toBe(false);
  expect((await unitButton(el))!.textContent!.trim()).toBe(
    t("editor.per_unit").replace("{unit}", "l"),
  );
  await openUnits(el);
  expect(combobox(el, "unit")!.value).toBe(litre.id);
  expect(el.shadowRoot!.querySelector("[data-test=add-unit]")).not.toBeNull();
});

it.each([
  {
    locale: "en-GB",
    unit: "Each",
    category: "No category",
    course: "None specified",
    allergens: "Allergens: None",
    unreviewed: "Allergens: Not yet reviewed",
  },
  {
    locale: "es-ES",
    unit: "Unidad",
    category: "Sin categoría",
    course: "Sin especificar",
    allergens: "Alérgenos: Ninguno",
    unreviewed: "Alérgenos: Sin revisar todavía",
  },
])(
  "in $locale, hints what a variant will use where its parent names nothing",
  async ({ locale, unreviewed, ...expected }) => {
    setLocale(locale);
    try {
      const el = await mountVariant({
        ...glass,
        inherited: {
          ...parentValues,
          unitId: null,
          primaryCategoryId: null,
          courseId: null,
          allergens: {},
          dietaryDeclarations: [],
        },
      });
      expect(control<{ unit: string }>(el, "unit-price").unit).toBe(expected.unit);
      expect(variantPath(el)).toBe(`${t("editor.classification")}: ${expected.category}`);
      expect(combobox(el, "product-course")!.placeholder).toBe(expected.course);
      expect(inheritedNutrition(el, "allergens")).toBe(expected.allergens);
      expect(inheritedNutrition(el, "dietary")).toBeUndefined();
      cleanupWidgets();
      const unreviewedEl = await mountVariant({
        ...glass,
        inherited: { ...parentValues, allergens: null },
      });
      expect(inheritedNutrition(unreviewedEl, "allergens")).toBe(unreviewed);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("draws inherited nutritional values as quiet italic chips with read-only allergens", async () => {
  const el = await mountVariant();
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  el.style.setProperty("--wt-color-surface-lifted", "rgb(7, 8, 9)");
  for (const choice of ["allergen-milk", "diet-vegetarian"]) {
    const shown = picker.shadowRoot!.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!;
    expect(getComputedStyle(shown).fontStyle, choice).toBe("italic");
    expect(getComputedStyle(shown).backgroundColor, choice).toBe("rgb(7, 8, 9)");
    expect(shown.disabled).toBe(choice === "allergen-milk");
    expect(shown.getAttribute("aria-pressed")).toBe("true");
  }
});
it("shows own nutritional values without the inherited style after an override", async () => {
  const el = await mountVariant({
    ...glass,
    allergens: { gluten: { kinds: ["wheat" as const] } },
    dietaryDeclarations: ["vegan"],
  });
  expect(inheritedNutrition(el, "allergens")).toBeUndefined();
  expect(inheritedNutrition(el, "dietary")).toBeUndefined();
});

it("saves every field a variant left blank as null, so it keeps reading the parent's", async () => {
  const el = await mountVariant();
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  const value = submit.mock.calls[0]![0].detail.value;
  expect(value).toMatchObject({
    name: "Glass of coffee",
    unitPrice: null,
    vatClass: null,
    unitId: null,
    courseId: null,
    description: null,
    image: null,
    allergens: null,
    dietaryDeclarations: null,
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
  const course = combobox(el, "product-course")!;
  await chooseOption(course, "desserts");
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    unitPrice: "4.50",
    courseId: "desserts",
  });
  // A second save needs the first one settled.
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  await input(el, "unit-price", "");
  await chooseOption(course, "");
  await el.updateComplete;
  await edit(el);
  save(el);
  expect(submit.mock.calls[1]![0].detail.value).toMatchObject({ unitPrice: null, courseId: null });
});

it("saves explicit allergen None and an emptied dietary choice independently on a variant", async () => {
  const el = await mountVariant({
    ...glass,
    allergens: { gluten: { kinds: ["wheat" as const] } },
    dietaryDeclarations: ["vegan"],
  });
  el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "allergens", value: allergensFromChoices([]) },
      bubbles: true,
      composed: true,
    }),
  );
  el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "dietaryDeclarations", value: null },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value).toMatchObject({
    allergens: {},
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
  const description = control<HTMLElement>(el, "description-en").shadowRoot!.querySelector(
    "textarea",
  )!;
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
it.each(
  [390, 360, 320].flatMap((phoneWidth) => [
    ...phoneCases.map((phone) => ({ ...phone, phoneWidth, font: "default" })),
    ...phoneCases.map((phone) => ({ ...phone, phoneWidth, font: "Verdana" })),
  ]),
)(
  "keeps every variant row's menu on screen at phone width, with no sideways scroll ($phoneWidth px, $locale, larger text: $scaled, unit: $unitId, font: $font)",
  async ({ locale, scaled, unitId, font, phoneWidth }) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      setLocale(locale);
      // `page.viewport` resizes the frame the widget renders in; resizing the outer page does not.
      await page.viewport(phoneWidth, 844);
      expect(window.innerWidth).toBe(phoneWidth);
      const { el, host } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: {
          ...product,
          unitId,
          variants: [
            { ...small, name: "House red wine, one large glass of 125 ml", unitPrice: null },
            { ...large, name: "Wine 175 ml" },
            { ...large, id: "w250", name: "Wine 250 ml", unitPrice: "1250.00" },
          ],
        },
        locales: ["en"],
        units: [unit],
      });
      host.style.setProperty("--wt-duration-disclosure", "1ms");
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
      expect(
        linesOf(cells[0]!, formatMoney("9.00", locale)),
        "the base price the first row falls back to",
      ).toBe(1);
      expect(linesOf(cells[1]!, formatMoney("3.00", locale))).toBe(1);
      expect(linesOf(cells[2]!, formatMoney("1250.00", locale))).toBe(1);
      // Kept on one line, an amount wider than the name column would run over the switch beside it.
      for (const cell of cells) {
        const amount = cell.querySelector(".amount")!.getBoundingClientRect();
        expect(amount.width).toBeGreaterThan(0);
        expect(amount.right).toBeLessThanOrEqual(cell.getBoundingClientRect().right);
      }
      const available = table.shadowRoot!.querySelectorAll("thead th")[3]!;
      expect(linesOf(available, t("editor.available")), "the Available heading").toBe(1);
      // The heading's unit button goes with the price column; the price field's unit button above
      // the table opens the same chooser.
      const unitSelect = table.shadowRoot!.querySelector('[data-test="pricing-unit"]')!;
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
  });
  await tableEvent(el, "wt-remove", { index: 1 });
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(true);
  await tableEvent(el, "wt-restore", { index: 1 });
  // The window hands a variant back as a NEW object with its keys in its own order.
  const reordered = Object.fromEntries(Object.entries(small).reverse()) as EditorVariant;
  await tableEvent(el, "wt-edit", { index: 0, via: "menu" });
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
  });
  await input(el, "name", "Coffee to go");
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(true);
  el.value = { ...product, name: "Coffee to go", variants: [small, large] };
  await el.updateComplete;
  expect((variantTable(el) as unknown as { openBlocked: boolean }).openBlocked).toBe(false);
});

it("submits the current folder for a new product", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
    units: [unit],
    categories,
    newCategoryId: "drinks",
  });
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  await input(el, "name", "Tea");
  await input(el, "unit-price", "3.00");
  save(el);
  expect(submitted).toHaveBeenCalledOnce();
  expect((submitted.mock.calls[0]![0] as CustomEvent).detail.value.primaryCategoryId).toBe(
    "drinks",
  );
});

// --- The shared field components ---

type Field = HTMLElement & {
  label: string;
  search: string;
  required: boolean;
  placeholder: string;
  options: { value: string; label: string }[];
  value: string;
  error: string;
  disabled: boolean;
  updateComplete: Promise<unknown>;
};
function sharedField(el: ProductEditor, tag: "wt-combobox" | "wt-textarea", name: string) {
  return el.shadowRoot!.querySelector<Field>(
    `${name === "ordering" ? "wt-segmented-control" : tag}[name="${name}"]`,
  )!;
}
/** What a closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownIn(el: ProductEditor, name: string): Promise<string | undefined> {
  const box = sharedField(el, "wt-combobox", name);
  await box.updateComplete;
  return box
    .shadowRoot!.querySelector(name === "ordering" ? '[aria-checked="true"]' : ".trigger .value")
    ?.textContent?.trim();
}

it("picks the course from a shared dropdown, with none as a chosen value and a row", async () => {
  const before = currentLocale();
  setLocale("en-GB");
  try {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, courseId: "course-2" },
      locales: ["en"],
      units: [unit],
      courses: [
        { id: "course-1", name: "Starters" },
        { id: "course-2", name: "Mains" },
      ],
    });
    await openSection(el, "details");
    const course = sharedField(el, "wt-combobox", "product-course");
    expect(course).not.toBeNull();
    expect(course.label).toBe(t("product.course"));
    expect(course.label).toBe("Course");
    expect(course.search).toBe("auto");
    expect(course.placeholder).toBe(t("modifiers.none_specified"));
    expect(course.options).toEqual([
      { value: "", label: t("modifiers.none_specified") },
      { value: "course-1", label: "Starters" },
      { value: "course-2", label: "Mains" },
      { value: "edit-courses", label: t("editor.edit_courses"), action: true, primary: true },
    ]);
    expect(course.value).toBe("course-2");
    expect(await shownIn(el, "product-course")).toBe("Mains");
    await chooseOption(course, "");
    await el.updateComplete;
    expect(el.currentValue.courseId).toBeNull();
    expect(await shownIn(el, "product-course")).toBe(t("modifiers.none_specified"));
    const courseText = course.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!;
    expect(courseText.classList.contains("placeholder")).toBe(false);
    expect(getComputedStyle(courseText).fontStyle).toBe("normal");
    el.fieldErrors = { "product-course": "That one is gone" };
    await el.updateComplete;
    expect(course.error).toBe("That one is gone");
  } finally {
    setLocale(before);
  }
});

async function mountCourses(value: ProductEditorDraft = { ...product, courseId: "course-2" }) {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value,
    locales: ["en"],
    units: [unit],
    courses: [
      { id: "course-1", name: "Starters" },
      { id: "course-2", name: "Mains" },
    ],
  });
  await openSection(el, "details");
  return el;
}
/** Opens the course dropdown and clicks the row with this label, the way a person does. */
async function clickCourseRow(el: ProductEditor, label: string) {
  const box = sharedField(el, "wt-combobox", "product-course");
  await box.updateComplete;
  box.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await box.updateComplete;
  [...box.shadowRoot!.querySelectorAll<HTMLElement>("li[role=option]")]
    .find((option) => option.textContent!.trim() === label)!
    .click();
  await box.updateComplete;
  await el.updateComplete;
  return box;
}

it("ends the course dropdown with Edit courses…, a command row drawn in the primary colour with no icon", async () => {
  const el = await mountCourses();
  const last = sharedField(el, "wt-combobox", "product-course").options.at(-1)!;
  expect(last).toEqual({
    value: "edit-courses",
    label: t("editor.edit_courses"),
    action: true,
    primary: true,
  });
});

it("asks for the courses window when Edit courses… is chosen, keeping the product's course", async () => {
  const el = await mountCourses();
  const create = vi.fn();
  el.addEventListener("wt-create-related", create);
  const box = await clickCourseRow(el, t("editor.edit_courses"));
  expect(create.mock.calls.map((call) => call[0].detail)).toEqual([{ kind: "courses" }]);
  expect(el.currentValue.courseId).toBe("course-2");
  expect(box.value).toBe("course-2");
  expect(await shownIn(el, "product-course")).toBe("Mains");
});

it("keeps no course when Edit courses… is chosen on a product with none", async () => {
  const el = await mountCourses({ ...product, courseId: null });
  const box = await clickCourseRow(el, t("editor.edit_courses"));
  expect(el.currentValue.courseId).toBeNull();
  expect(box.value).toBe("");
  expect(await shownIn(el, "product-course")).toBe(t("modifiers.none_specified"));
});

it("selects the course the courses window hands back, and clears a course it removed", async () => {
  const el = await mountCourses();
  el.selectRelated("courses", "course-1");
  await el.updateComplete;
  expect(el.currentValue.courseId).toBe("course-1");
  expect(await shownIn(el, "product-course")).toBe("Starters");
  el.clearCourse();
  await el.updateComplete;
  expect(el.currentValue.courseId).toBeNull();
  expect(await shownIn(el, "product-course")).toBe(t("modifiers.none_specified"));
});

it("returns focus to the course dropdown after the courses window", async () => {
  const el = await mountCourses();
  (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
  el.returnRelatedFocus("courses");
  expect(el.shadowRoot!.activeElement).toBe(sharedField(el, "wt-combobox", "product-course"));
});

it("offers Edit courses… on a variant's page too", async () => {
  const el = await mountVariant();
  const options = sharedField(el, "wt-combobox", "product-course").options;
  expect(options.map(({ value }) => value)).toEqual(["", "mains", "desserts", "edit-courses"]);
  expect(options.at(-1)).toEqual({
    value: "edit-courses",
    label: t("editor.edit_courses"),
    action: true,
    primary: true,
  });
});

it("describes the product in a shared text area per language, the language in its label", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
  });
  await openSection(el, "details");
  const english = sharedField(el, "wt-textarea", "description-en");
  const spanish = sharedField(el, "wt-textarea", "description-es");
  expect(english).not.toBeNull();
  expect(english.label).toBe(`${t("editor.description")} (en)`);
  expect(spanish.label).toBe(`${t("editor.description")} (es)`);
  expect(english.value).toBe("Freshly roasted");
  expect(spanish.value).toBe("");
  spanish.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Recién tostado" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.description).toEqual({ en: "Freshly roasted", es: "Recién tostado" });
  el.fieldErrors = { "description-es": t("editor.field_rejected") };
  await el.updateComplete;
  expect(spanish.error).toBe(t("editor.field_rejected"));
  expect(english.error).toBe("");
});

// --- The VAT rate when taken away ---

// The menu-settings answer's `vatRates` for a Spanish venue (D18(a)): the rates a person may pick.
const pickableRates = ["0.00", "4.00", "10.00", "21.00"];
const rateOptions = [
  { value: "0.00", label: "0%" },
  { value: "4.00", label: "4%" },
  { value: "10.00", label: "10%" },
  { value: "21.00", label: "21%" },
];
const same = (product: string, rate: string) => fill("editor.takeaway_vat_same", { product, rate });
/** Writes the case's labels in one locale, whatever an earlier case left set. */
function inLocale(locale: "en-GB" | "es-ES") {
  const before = currentLocale();
  setLocale(locale);
  onTestFinished(() => setLocale(before));
}
async function mountTakeaway(
  value: ProductEditorDraft | null,
  takeawayVat = true,
  props: Partial<ProductEditor> = {},
) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value,
      locales: ["en"],
      units: [unit, litre],
      categories,
      courses,
      takeawayVat,
      vatRates: pickableRates,
      api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never,
      ...props,
    })
  ).el;
}

it("words the takeaway field as staff read it, in English and Spanish", () => {
  const before = currentLocale();
  try {
    setLocale("en-GB");
    expect(t("editor.takeaway_vat")).toBe("VAT when taken away");
    expect(same("Coffee", "10")).toBe("Same as Coffee — 10%");
    expect(t("editor.takeaway_vat_required")).toBe("Choose the VAT when taken away.");
    setLocale("es-ES");
    expect(t("editor.takeaway_vat")).toBe("IVA para llevar");
    expect(same("Café", "10")).toBe("Igual que Café — 10 %");
    expect(t("editor.takeaway_vat_required")).toBe("Elige el IVA para llevar.");
  } finally {
    setLocale(before);
  }
});

it("locks the takeaway VAT dropdown while a save is in flight, like the form's other fields", async () => {
  const el = await mountTakeaway(saved);
  expect(combobox(el, "takeaway-tax")!.disabled).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(combobox(el, "takeaway-tax")!.disabled).toBe(true);
  el.busy = false;
  await el.updateComplete;
  expect(combobox(el, "takeaway-tax")!.disabled).toBe(false);
});

it("locks the course dropdown and every description while a save is in flight", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en", "es"],
    units: [unit],
    courses,
  });
  const locked = () => [
    combobox(el, "product-course")!.disabled,
    ...["en", "es"].map((locale) => control<WtTextarea>(el, `description-${locale}`).disabled),
  ];
  expect(locked()).toEqual([false, false, false]);
  el.busy = true;
  await el.updateComplete;
  expect(locked()).toEqual([true, true, true]);
  el.busy = false;
  await el.updateComplete;
  expect(locked()).toEqual([false, false, false]);
});

it("offers exactly the answer's rates as percentages on a product, its own rate chosen and the field required", async () => {
  inLocale("en-GB");
  const el = await mountTakeaway(saved);
  const takeaway = combobox(el, "takeaway-tax")!;
  expect(takeaway.label).toBe(t("editor.takeaway_vat"));
  expect(takeaway.required).toBe(true);
  expect(takeaway.options).toEqual(rateOptions);
  expect(takeaway.value).toBe("10.00");
  expect(await shownIn(el, "takeaway-tax")).toBe("10%");
});

it("lists whatever rates the answer gives, not a list of its own", async () => {
  inLocale("en-GB");
  const el = await mountTakeaway({ ...saved, takeawayVatRate: "7.50" }, true, {
    vatRates: ["7.50", "21.00"],
  });
  expect(combobox(el, "takeaway-tax")!.options).toEqual([
    { value: "7.50", label: "7.5%" },
    { value: "21.00", label: "21%" },
  ]);
});

it("writes a rate's percentage the Spanish way under Spanish", async () => {
  inLocale("es-ES");
  const el = await mountTakeaway({ ...saved, takeawayVatRate: "7.50" }, true, {
    vatRates: ["7.50", "21.00"],
  });
  expect(combobox(el, "takeaway-tax")!.options.map((option) => option.label)).toEqual([
    "7,5 %",
    "21 %",
  ]);
});

it("saves a chosen rate as its stored spelling, and the choice alone enables Save", async () => {
  const el = await mountTakeaway(saved);
  expect(saveButton(el).hasAttribute("disabled")).toBe(true);
  await chooseOption(combobox(el, "takeaway-tax")!, "4.00");
  await el.updateComplete;
  expect(saveButton(el).hasAttribute("disabled")).toBe(false);
  expect(submittedValue(el).takeawayVatRate).toBe("4.00");
});

it("starts a new product at the venue's default takeaway rate", async () => {
  const el = await mountTakeaway(null, true, { defaultTakeawayVatRate: "21.00" });
  expect(combobox(el, "takeaway-tax")!.value).toBe("21.00");
  await input(el, "name", "Omelette");
  expect(submittedValue(el).takeawayVatRate).toBe("21.00");
});

it("marks a product's missing takeaway rate inline and refuses to save until one is chosen", async () => {
  const el = await mountTakeaway({ ...saved, takeawayVatRate: "" });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(combobox(el, "takeaway-tax")!.error).toBe(t("editor.takeaway_vat_required"));
  await chooseOption(combobox(el, "takeaway-tax")!, "21.00");
  await el.updateComplete;
  expect(combobox(el, "takeaway-tax")!.error).toBe("");
});

it("refuses a stored rate the answer no longer offers, and points a server refusal at the field", async () => {
  expect(productEditorField("takeawayVatRate", "en")).toBe("takeaway-tax");
  expect(productEditorField("takeawayVatClass", "en")).toBeNull();
  const el = await mountTakeaway({ ...saved, takeawayVatRate: "5.00" });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(combobox(el, "takeaway-tax")!.error).toBe(t("editor.takeaway_vat_required"));
});

it("offers a variant its product's rate first, not required, and saves that choice as null", async () => {
  inLocale("en-GB");
  const el = await mountTakeaway({
    ...glass,
    inherited: { ...parentValues, takeawayVatRate: "10.00" },
  });
  const takeaway = combobox(el, "takeaway-tax")!;
  expect(takeaway.required).toBe(false);
  expect(takeaway.placeholder).toBe(same("Coffee", "10"));
  expect(takeaway.options).toEqual([{ value: "", label: same("Coffee", "10") }, ...rateOptions]);
  expect(takeaway.value).toBe("");
  expect(await shownIn(el, "takeaway-tax")).toBe(same("Coffee", "10"));
  await chooseOption(takeaway, "21.00");
  await el.updateComplete;
  expect(el.currentValue.takeawayVatRate).toBe("21.00");
  await chooseOption(combobox(el, "takeaway-tax")!, "");
  await el.updateComplete;
  await edit(el);
  expect(submittedValue(el).takeawayVatRate).toBeNull();
});

it("sends a new product's default takeaway rate where the region does not charge it", async () => {
  const el = await mountTakeaway(null, false, { defaultTakeawayVatRate: "0.00" });
  expect(combobox(el, "takeaway-tax")).toBeNull();
  await input(el, "name", "Omelette");
  expect(submittedValue(el).takeawayVatRate).toBe("0.00");
});

it("draws no takeaway field where the region does not charge it, and saves the stored rate unchanged", async () => {
  const el = await mountTakeaway({ ...saved, takeawayVatRate: "21.00" }, false);
  expect(combobox(el, "takeaway-tax")).toBeNull();
  await edit(el);
  expect(submittedValue(el).takeawayVatRate).toBe("21.00");
});

it("picks the unit from a shared dropdown behind the price field, Each being its prompt and a row", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: product,
    locales: ["en"],
    units: [unit, litre],
  });
  await openUnits(el);
  const box = sharedField(el, "wt-combobox", "unit");
  expect(box).not.toBeNull();
  expect(box.label).toBe(t("product.unit"));
  expect(box.search).toBe("auto");
  expect(box.placeholder).toBe(t("editor.unit_each"));
  expect(box.options).toEqual([
    { value: EACH_CHOICE, fixed: true, label: t("editor.unit_each") },
    { value: unit.id, label: "Each (ea)" },
    { value: litre.id, label: "Litre (l)" },
  ]);
  expect(box.value).toBe(unit.id);
  expect(await shownIn(el, "unit")).toBe("Each (ea)");
  await chooseOption(box, litre.id);
  await el.updateComplete;
  expect(el.currentValue.unitId).toBe(litre.id);
  // Choosing closes the chooser, leaving the price field's button naming the unit.
  expect(el.shadowRoot!.querySelector("[name=unit]")).toBeNull();
  el.fieldErrors = { unit: "That unit is gone" };
  await el.updateComplete;
  expect(sharedField(el, "wt-combobox", "unit").error).toBe("That unit is gone");
});

it("keeps a variant's inherited choice as each inherited dropdown's prompt and first row", async () => {
  const el = await mountVariant();
  const expected = {
    "product-course": "Mains",
  };
  for (const [name, text] of Object.entries(expected)) {
    const box = sharedField(el, "wt-combobox", name);
    expect(box.placeholder, name).toBe(text);
    expect(box.options[0], name).toEqual({ value: "", label: text });
    expect(box.value, name).toBe("");
    expect(box.required, name).toBe(false);
    expect(await shownIn(el, name), name).toBe(text);
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector(".trigger .value")!.classList, name).toContain(
      "placeholder",
    );
  }
});

// --- The Pricing and Variants sections ---

const saved: ProductEditorDraft = { ...product, id: "coffee" };
async function mountPricing(value: ProductEditorDraft, props: Partial<ProductEditor> = {}) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value,
      locales: ["en"],
      units: [unit],
      dineInVatRate: "10.00",
      ...props,
    })
  ).el;
}
const priceField = (el: ProductEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>("[name=unit-price]")!;
/** Whether a control takes up room on screen, so a person sees it without opening anything. */
const onScreen = (element: Element) =>
  element.closest("wt-disclosure") === null && element.getBoundingClientRect().height > 0;
const takeawayOnDetails = (el: ProductEditor) =>
  summaryOf(el, "details").filter(({ label }) => label === t("editor.takeaway_vat"));
const showInactiveLink = (el: ProductEditor) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=show-inactive]");
const followsInDocument = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

it("keeps the closed Details card one card gap above the price card", async () => {
  const el = await mountPricing({ ...saved, variants: [small] });
  el.style.setProperty("--wt-space-4", "16px");
  const details = folded(el, "details").getBoundingClientRect();
  const price = section(el, "price").getBoundingClientRect();
  expect(price.top - details.bottom).toBe(16);
});

it("keeps the card gap when Details opens", async () => {
  const el = await mountPricing({ ...saved, variants: [small] });
  el.style.setProperty("--wt-space-4", "16px");
  await openSection(el, "details");
  const details = folded(el, "details").getBoundingClientRect();
  const price = section(el, "price").getBoundingClientRect();
  expect(price.top - details.bottom).toBe(16);
});

it("separates the price, Variants and Modifiers groups by the gap between groups", async () => {
  const el = await mountPricing({ ...saved, variants: [small] });
  el.style.setProperty("--wt-space-6", "32px");
  el.style.setProperty("--wt-space-2", "8px");
  const price = group(el, "price").getBoundingClientRect();
  const variants = group(el, "variants").getBoundingClientRect();
  const modifiers = group(el, "modifiers").getBoundingClientRect();
  expect(variants.top - price.bottom).toBe(40);
  expect(modifiers.top - variants.bottom).toBe(40);
});

it("puts the identity card's rows the small gap apart", async () => {
  const el = await mountPricing(saved);
  el.style.setProperty("--wt-space-3", "12px");
  const rows = [...section(el, "identity").children].map((row) => row.getBoundingClientRect());
  for (let index = 1; index < rows.length; index++)
    expect(rows[index]!.top - rows[index - 1]!.bottom).toBe(12);
});

it("keeps the variant table inside the price card's padding on a wide card", async () => {
  await atDesktopWidth(async () => {
    const el = await mountPricing({ ...saved, variants: [small] });
    const table = variantTable(el)!.getBoundingClientRect();
    const price = group(el, "price").getBoundingClientRect();
    expect(table.left).toBe(price.left);
    expect(table.right).toBe(price.right);
  });
});

it("puts Details' groups the gap between groups apart", async () => {
  const el = await mountPricing(saved);
  el.style.setProperty("--wt-space-6", "32px");
  el.style.setProperty("--wt-space-2", "8px");
  await openSection(el, "details");
  const groups = [
    ...folded(el, "details").querySelectorAll<HTMLElement>("fieldset[data-group]"),
  ].map((node) => node.getBoundingClientRect());
  expect(groups.length).toBeGreaterThan(1);
  for (let index = 1; index < groups.length; index++)
    expect(groups[index]!.top - groups[index - 1]!.bottom).toBe(40);
});

it("names the offered lists and menus before saving a product unit change", async () => {
  const kg = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "kg",
    name: { en: "Kilogram" },
    abbreviation: { en: "kg" },
  };
  const usage = [
    {
      productId: "coffee",
      productName: "Coffee",
      lists: [{ id: "extras", name: "Toppings", menus: [{ id: "lunch", name: "Lunch" }] }],
    },
  ];
  const api = { getProductExtraUsage: vi.fn().mockResolvedValue(usage) };
  const el = await mountPricing(saved, {
    units: [unit, kg],
    api: api as unknown as ProductEditor["api"],
  });
  await openUnits(el);
  await chooseOption(sharedField(el, "wt-combobox", "unit"), kg.id);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=unit-usage-warning]")?.textContent)
    .toContain("Toppings");
  expect(el.shadowRoot!.querySelector("[data-test=unit-usage-warning]")?.textContent).toContain(
    "Lunch",
  );
  expect(saveButton(el).disabled).toBe(false);
});

it("drops a unit-usage reply after the editor is reseeded for another product", async () => {
  let reply!: (value: unknown[]) => void;
  const api = {
    getProductExtraUsage: vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => (reply = resolve))),
  };
  const kg = {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    id: "kg",
    name: { en: "Kilogram" },
    abbreviation: { en: "kg" },
  };
  const el = await mountPricing(saved, {
    units: [unit, kg],
    api: api as unknown as ProductEditor["api"],
  });
  await openUnits(el);
  await chooseOption(sharedField(el, "wt-combobox", "unit"), kg.id);
  el.value = { ...saved, id: "tea", name: "Tea" };
  await el.updateComplete;
  reply([
    {
      productId: "coffee",
      productName: "Coffee",
      lists: [{ id: "x", name: "Toppings", menus: [] }],
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=unit-usage-warning]")).toBeNull();
});

it("draws the price field with no group label in the price card, VAT in Details", async () => {
  const el = await mountPricing(saved);
  const price = group(el, "price");
  expect(price.closest('[data-section="price"]')!.tagName).toBe("WT-CARD");
  expect(price.querySelector(".group-label, legend")).toBeNull();
  const variants = group(el, "variants").querySelector("legend")!;
  const modifiers = group(el, "modifiers").querySelector("legend")!;
  const kitchen = folded(el, "details").querySelector('[data-group="kitchen"] > legend')!;
  for (const property of ["fontSize", "fontWeight", "textTransform", "color"] as const) {
    expect(getComputedStyle(variants)[property], property).toBe(
      getComputedStyle(modifiers)[property],
    );
    expect(getComputedStyle(variants)[property], property).toBe(
      getComputedStyle(kitchen)[property],
    );
  }
  expect(price.querySelector("[name=unit-price]")).not.toBeNull();
  expect(price.querySelector("[data-test=dine-in-vat]")).toBeNull();
  expect(folded(el, "details").querySelector("[data-test=dine-in-vat]")).not.toBeNull();
});

it("keeps the base price on screen once the product has an active variant", async () => {
  const el = await mountPricing({ ...saved, variants: [small, large] });
  const field = priceField(el);
  expect(onScreen(field)).toBe(true);
  expect(field.getAttribute("label")).toBe(fill("editor.base_price_unit", { unit: "ea" }));
  expect(field.value).toBe("9.00");
  expect(group(el, "price").querySelector("[data-test=dine-in-vat]")).toBeNull();
});

it("adds a takeaway VAT rate of its own to the closed Details line, and leaves an empty one out", async () => {
  inLocale("en-GB");
  const el = await mountPricing(
    { ...saved, variants: [small], takeawayVatRate: "4.00" },
    { takeawayVat: true, vatRates: pickableRates },
  );
  expect(takeawayOnDetails(el)).toEqual([{ label: t("editor.takeaway_vat"), value: "4%" }]);
  el.value = { ...saved, id: "tea", variants: [small], takeawayVatRate: "" };
  await el.updateComplete;
  expect(takeawayOnDetails(el)).toEqual([]);
});

it("leaves a takeaway VAT rate the form does not offer off the closed Details line", async () => {
  inLocale("en-GB");
  const el = await mountPricing(
    { ...saved, variants: [small], takeawayVatRate: "21.00" },
    { takeawayVat: true, vatRates: pickableRates },
  );
  expect(takeawayOnDetails(el)).toEqual([{ label: t("editor.takeaway_vat"), value: "21%" }]);
  el.value = { ...saved, id: "tea", variants: [small], takeawayVatRate: "5.00" };
  await el.updateComplete;
  expect(takeawayOnDetails(el)).toEqual([]);
});

it.each(["en-GB", "es-ES"] as const)(
  "labels the base price in %s, with no unit as each",
  async (locale) => {
    setLocale(locale);
    try {
      const el = await mountPricing({ ...saved, unitId: null, variants: [small] });
      const field = priceField(el);
      expect(onScreen(field)).toBe(true);
      expect(field.getAttribute("label")).toBe(t("editor.base_price"));
      expect(field.getAttribute("unit")).toBe(t("editor.unit_each"));
    } finally {
      setLocale("es-ES");
    }
  },
);

it("keeps a typed price holding a replacement pattern as written", async () => {
  const el = await mountPricing({ ...saved, unitId: null, variants: [small] });
  await input(el, "unit-price", "1$&");
  expect(el.currentValue.unitPrice).toBe("1$&");
  expect(onScreen(priceField(el))).toBe(true);
});

it("shows a blank base price as an empty field on screen", async () => {
  const el = await mountPricing({
    ...saved,
    unitPrice: "",
    variants: [small],
  });
  expect(priceField(el).value).toBe("");
  expect(onScreen(priceField(el))).toBe(true);
});

it("labels the price as the product's own while every variant is Inactive", async () => {
  const el = await mountPricing({ ...saved, variants: [{ ...small, active: false }] });
  expect(onScreen(priceField(el))).toBe(true);
  expect(el.shadowRoot!.querySelector("[name=unit-price]")!.getAttribute("label")).toBe(
    t("editor.price_unit").replace("{unit}", "ea"),
  );
});

it("keeps the price on screen when a variant is added to a saved product, and when it goes", async () => {
  const el = await mountPricing(saved);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-variant]")!.click();
  await el.updateComplete;
  const fresh: EditorVariant = { ...small, name: "Fresh" };
  delete fresh.id;
  variantForm(el).dispatchEvent(
    new CustomEvent("wt-submit", { detail: { value: fresh }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(onScreen(priceField(el))).toBe(true);
  expect(priceField(el).getAttribute("label")).toBe(fill("editor.base_price_unit", { unit: "ea" }));
  await tableEvent(el, "wt-remove", { index: 0 });
  expect(onScreen(priceField(el))).toBe(true);
  expect(priceField(el).getAttribute("label")).toBe(fill("editor.price_unit", { unit: "ea" }));
});

it("shows the price on an unsaved product with variants, and keeps it there through edits", async () => {
  const el = await mountPricing({ ...product, variants: [small] });
  expect(onScreen(priceField(el))).toBe(true);
  await input(el, "name", "Coffee to go");
  expect(onScreen(priceField(el))).toBe(true);
});

it.each(["unit-price", "unit"])(
  "puts focus in the price field when the server refuses %s",
  async (name) => {
    const el = await mountPricing(
      { ...saved, variants: [small] },
      { takeawayVat: true, vatRates: pickableRates },
    );
    el.fieldErrors = { [name]: "Refused" };
    await el.updateComplete;
    expect(priceField(el).error).toContain("Refused");
    await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe(name);
  },
);

it("shows a refused takeaway rate under its field, not again above Save", async () => {
  const el = await mountPricing(saved, { takeawayVat: true, vatRates: pickableRates });
  el.fieldErrors = { "takeaway-tax": "Refused" };
  await el.updateComplete;
  expect(errorOf(el, "takeaway-tax")).toBe("Refused");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
});

it("says a refused takeaway rate above Save where the area charges no takeaway VAT", async () => {
  const el = await mountPricing(saved, { takeawayVat: false });
  el.fieldErrors = { "takeaway-tax": "Refused rate" };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[name="takeaway-tax"]')).toBeNull();
  expect(await bottomOf(el)).toBe("Refused rate");
});

it("shows the base price's error on screen when Save finds it invalid", async () => {
  const el = await mountPricing({ ...saved, variants: [small] });
  await input(el, "unit-price", "abc");
  save(el);
  await el.updateComplete;
  expect(onScreen(priceField(el))).toBe(true);
  expect(errorOf(el, "unit-price")).toBe(t("editor.price_invalid"));
});

it("draws the variants in their own group after the price, ending with Add variant", async () => {
  const el = await mountPricing({ ...saved, variants: [small, large] });
  const variants = group(el, "variants");
  expect(variants.tagName).toBe("FIELDSET");
  expect(ownText(variants.querySelector("legend")!)).toBe(t("editor.variants"));
  expect(variants.querySelector("dashboard-variant-table")).not.toBeNull();
  expect(group(el, "price").querySelector("dashboard-variant-table")).toBeNull();
  expect(followsInDocument(group(el, "price"), variants)).toBe(true);
  const table = variants.querySelector("dashboard-variant-table")!;
  const add = variants.querySelector("[data-test=add-variant]")!;
  expect(followsInDocument(table, add)).toBe(true);
});

it("makes the Variants group its heading and the Add variant button alone while there are no variants", async () => {
  const el = await mountPricing(saved);
  const variants = group(el, "variants");
  expect(variants.querySelectorAll(":scope > :not(legend, .row)")).toHaveLength(0);
  expect(variants.querySelector("dashboard-variant-table")).toBeNull();
  expect(variants.querySelector("[data-test=add-variant]")).not.toBeNull();
  expect(showInactiveLink(el)).toBeNull();
});

it.each(["en-GB", "es-ES"])(
  "keeps archived-before rows hidden without a show/hide toggle in %s",
  async (locale) => {
    setLocale(locale);
    try {
      const el = await mountPricing({ ...saved, variants: [small, { ...large, active: false }] });
      const table = variantTable(el)!;
      await table.updateComplete;
      expect(
        [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
          row.getAttribute("data-test"),
        ),
      ).toEqual(["row-0"]);
      expect(showInactiveLink(el)).toBeNull();
      expect(group(el, "variants").querySelector("[data-test=add-variant]")).not.toBeNull();
      await tableEvent(el, "wt-remove", { index: 0 });
      await table.updateComplete;
      expect(table.shadowRoot!.querySelector("[data-test=inactive-0]")).not.toBeNull();
      expect(showInactiveLink(el)).toBeNull();
    } finally {
      setLocale("es-ES");
    }
  },
);

it("recomputes archived-before rows for each product and never reveals them for errors", async () => {
  const el = await mountPricing({ ...saved, variants: [small, { ...large, active: false }] });
  el.fieldErrors = { "variant-1-name": "Refused" };
  await el.updateComplete;
  await variantTable(el)!.updateComplete;
  expect(variantTable(el)!.shadowRoot!.querySelector("[data-test=row-1]")).toBeNull();
  expect(showInactiveLink(el)).toBeNull();
  el.value = { ...saved, id: "tea", variants: [{ ...small, active: false }, large] };
  await el.updateComplete;
  await variantTable(el)!.updateComplete;
  expect(
    [...variantTable(el)!.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
      row.getAttribute("data-test"),
    ),
  ).toEqual(["row-1"]);
});

it("keeps focus on the only saved row after Archive so Keep remains reachable", async () => {
  const el = await mountPricing({ ...saved, variants: [small] });
  const table = variantTable(el)!;
  await table.updateComplete;
  table
    .shadowRoot!.querySelector<HTMLElement & { show(): void }>('[data-test="actions-0"]')!
    .show();
  const remove = table.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-0"]')!;
  remove.focus();
  remove.click();
  await el.updateComplete;
  expect(el.currentValue.variants[0]!.active).toBe(false);
  await expect
    .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
    .toBe("actions-0");
  expect(table.shadowRoot!.querySelector("[data-test=restore-0]")).not.toBeNull();
});

it("draws a variant's page with the price on screen, VAT in Details, and no Variants group", async () => {
  const el = await mountVariant();
  const price = group(el, "price");
  expect(price.querySelector("[name=unit-price]")).not.toBeNull();
  expect(onScreen(priceField(el))).toBe(true);
  expect(folded(el, "details").querySelector("[data-test=dine-in-vat]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-group="variants"]')).toBeNull();
});

// --- The photo, beside Name ---

async function mountWithPhoto(props: Partial<ProductEditor> = {}) {
  return (
    await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: saved,
      locales: ["en"],
      units: [unit],
      api: { imageLibraryRequest: vi.fn().mockResolvedValue({}) } as never,
      ...props,
    })
  ).el;
}
const photoControl = (el: ProductEditor) =>
  el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "dashboard-image-upload",
  )!;

it("keeps the photo the image control chooses, and saves it", async () => {
  const el = await mountWithPhoto();
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  const changed = new CustomEvent("image-changed", {
    detail: { image: "cecina.png" },
    bubbles: true,
    composed: true,
  });
  const outside = vi.fn();
  el.addEventListener("image-changed", outside);
  photoControl(el).dispatchEvent(changed);
  await el.updateComplete;
  expect(outside).not.toHaveBeenCalled();
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.image).toBe("cecina.png");
});

it("holds Save while the image picker is open", async () => {
  const el = await mountWithPhoto();
  const picker = (open: boolean) =>
    photoControl(el).dispatchEvent(
      new CustomEvent("image-picker-state", { detail: { open }, bubbles: true, composed: true }),
    );
  await edit(el);
  expect(saveButton(el).disabled).toBe(false);
  picker(true);
  await el.updateComplete;
  expect(saveButton(el).disabled).toBe(true);
  picker(false);
  await el.updateComplete;
  expect(saveButton(el).disabled).toBe(false);
});

it("leaves Details closed on a refused photo, says why beside it, and puts focus on the photo", async () => {
  const el = await mountWithPhoto();
  expect(section(el, "details").open).toBe(false);
  el.fieldErrors = { image: "The photo is gone" };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=image-error]")!.textContent!.trim()).toBe(
    "The photo is gone",
  );
  await expect
    .poll(() => photoControl(el).shadowRoot!.activeElement?.getAttribute("data-test"))
    .toBe("choose-image");
  expect(section(el, "details").open).toBe(false);
});

it("refuses a variant with no name on its row, and saves nothing", async () => {
  const el = await mountPricing({ ...saved, variants: [small, { ...large, name: " " }] });
  await edit(el);
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  const table = variantTable(el)!;
  await table.updateComplete;
  expect(table.errors).toEqual({ 1: t("editor.variant_name_required") });
});

const appearance = (el: ProductEditor) =>
  el.shadowRoot!.querySelector("dashboard-product-appearance")!;
const photoButton = (el: ProductEditor) =>
  appearance(el).shadowRoot!.querySelector<HTMLButtonElement>(".thumb")!;
async function openLibrary(el: ProductEditor) {
  appearance(el).openPanel();
  const upload = photoControl(el);
  await upload.updateComplete;
  upload.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")!.click();
  await upload.updateComplete;
}

it("returns from the nested image picker to the appearance panel's image action", async () => {
  const el = await mountWithPhoto();
  await openLibrary(el);
  const upload = photoControl(el);
  const modal = upload.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  modal.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await upload.updateComplete;
  await el.updateComplete;
  await closeReportsDelivered();
  expect(appearance(el).shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
    true,
  );
  expect(upload.shadowRoot!.activeElement?.getAttribute("data-test")).toBe("choose-image");
});

it("keeps a chosen photo's large preview out of the compact image-and-colour panel", async () => {
  const el = await mountWithPhoto({ value: { ...saved, image: mediaTestReference("own.png") } });
  appearance(el).openPanel();
  const upload = photoControl(el);
  await upload.updateComplete;
  const preview = upload.shadowRoot!.querySelector("img.preview")!;
  expect(preview).not.toBeNull();
  expect(getComputedStyle(preview).display).toBe("none");
});
const nameGroup = (el: ProductEditor) =>
  el.shadowRoot!.querySelector<HTMLElement>('[data-section="name"]')!;

it("puts the photo beside Name, which takes the rest of the row, and not in Details", async () => {
  const el = await mountWithPhoto({ value: { ...saved, image: mediaTestReference("own.png") } });
  const upload = photoControl(el) as HTMLElementTagNameMap["dashboard-image-upload"];
  expect(upload.thumbnail).toBe(false);
  expect(nameGroup(el).contains(upload)).toBe(true);
  expect(upload.closest("wt-disclosure")).toBeNull();
  expect(photoButton(el).getAttribute("aria-label")).toBe(
    `${t("image.label")} · ${t("editor.color")}`,
  );
  await vi.waitFor(() =>
    expect(photoButton(el).querySelector("img")!.getAttribute("src")).toBe(
      `/media/renditions/v1/${mediaTestReference("own.png")}/square/7500-2500-200.webp`,
    ),
  );
  const photo = photoButton(el).getBoundingClientRect();
  const name = el.shadowRoot!.querySelector<HTMLElement>('[name="name"]')!.getBoundingClientRect();
  expect(name.left).toBeGreaterThan(photo.right);
  expect(name.right).toBe(nameGroup(el).getBoundingClientRect().right);
  expect(Math.abs(name.top + name.height / 2 - (photo.top + photo.height / 2))).toBeLessThan(1);
});

it("keeps the photo and Name within the width the other fields stop at, on a desktop", async () => {
  await atDesktopWidth(async () => {
    const el = await mountWithPhoto({ value: { ...saved, image: mediaTestReference("own.png") } });
    await photoControl(el).updateComplete;
    const right = (selector: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(selector)!.getBoundingClientRect().right;
    expect(right('[name="primary"]')).toBeLessThan(nameGroup(el).getBoundingClientRect().right);
    expect(right('[name="name"]')).toBe(right('[name="primary"]'));
  });
});

it.each([
  ["its own photo", mediaTestReference("own.png")],
  ["the placeholder", null],
])("opens the image library from %s, and holds Save while it is open", async (_, image) => {
  const el = await mountWithPhoto({ value: { ...saved, image } });
  expect(photoButton(el).getAttribute("aria-label")).toBe(
    `${t("image.label")} · ${t("editor.color")}`,
  );
  await openLibrary(el);
  await photoControl(el).updateComplete;
  await el.updateComplete;
  expect(photoControl(el).shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
  expect(saveButton(el).disabled).toBe(true);
});

it("removes the photo from the appearance panel, and saves none", async () => {
  const el = await mountWithPhoto({ value: { ...saved, image: mediaTestReference("own.png") } });
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  appearance(el).openPanel();
  await photoControl(el).updateComplete;
  photoControl(el).shadowRoot!.querySelector<HTMLElement>("[data-test=remove-image]")!.click();
  await photoControl(el).updateComplete;
  await el.updateComplete;
  expect(photoControl(el).shadowRoot!.querySelector("media-image-picker")).toBeNull();
  expect(photoButton(el).getAttribute("aria-label")).toBe(
    `${t("image.label")} · ${t("editor.color")}`,
  );
  expect(saveButton(el).disabled).toBe(false);
  save(el);
  expect(submit.mock.calls[0]![0].detail.value.image).toBeNull();
});

it("shows a variant's inherited photo beside its Name, described as the main product's for a screen reader only", async () => {
  const el = await mountVariant();
  await vi.waitFor(() =>
    expect(photoButton(el).querySelector("img")!.getAttribute("src")).toBe(
      `/media/renditions/v1/${mediaTestReference("coffee.png")}/square/7500-2500-200.webp`,
    ),
  );
  const caption = appearance(el).shadowRoot!.querySelector("[data-test=inherited-caption]")!;
  expect(caption.textContent!.trim()).toBe(t("editor.inherited_image_alt"));
  expect(photoButton(el).getAttribute("aria-describedby")).toBe(caption.id);
  expect(caption.getBoundingClientRect().width).toBeLessThanOrEqual(1);
});

it("marks the photo invalid on a refused photo, with the reason under it", async () => {
  const el = await mountWithPhoto();
  el.fieldErrors = { image: "The photo is gone" };
  await el.updateComplete;
  await photoControl(el).updateComplete;
  expect(photoButton(el).getAttribute("aria-invalid")).toBe("true");
  await expect
    .element(page.elementLocator(photoButton(el)))
    .toHaveAccessibleDescription("The photo is gone");
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  const choose = upload.shadowRoot!.querySelector("[data-test=choose-image]")!;
  await expect
    .element(page.elementLocator(choose.shadowRoot!.querySelector("button")!))
    .toHaveAccessibleDescription("The photo is gone");
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-test=image-error]")!;
  expect(nameGroup(el).contains(error)).toBe(true);
  const photo = photoButton(el).getBoundingClientRect();
  expect(error.getBoundingClientRect().top).toBeGreaterThanOrEqual(photo.bottom);
  expect(error.getBoundingClientRect().left).toBe(photo.left);
});

it("keeps the thumbnail and colour panel without an image-library api", async () => {
  const el = await mountPricing({ ...saved, image: mediaTestReference("own.png") });
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")).toBeNull();
  const name = el.shadowRoot!.querySelector<HTMLElement>('[name="name"]')!.getBoundingClientRect();
  const group = nameGroup(el).getBoundingClientRect();
  expect(name.left).toBeGreaterThan(group.left);
  expect(name.right).toBe(group.right);
  await vi.waitFor(() =>
    expect(photoButton(el).querySelector("img")!.getAttribute("src")).toBe(
      `/media/renditions/v1/${mediaTestReference("own.png")}/square/7500-2500-200.webp`,
    ),
  );
});

it.each([
  ["the kitchen name alone", { kitchenName: "BAR", courseId: null }, ["kitchen"]],
  ["the course alone", { kitchenName: "  ", courseId: "course-1" }, ["course"]],
])(
  "names %s on the Kitchen line when only it is filled, the other left out",
  async (_, value, shown) => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: { ...product, ...value },
      locales: ["en"],
      units: [unit],
      courses: [{ id: "course-1", name: "Starters" }],
    });
    expect(detailsPart(el, "kitchen")).toEqual([
      ...(shown.includes("kitchen") ? [{ label: t("editor.kitchen_name"), value: "BAR" }] : []),
      ...(shown.includes("course")
        ? [{ label: t("editor.summary_course"), value: "Starters" }]
        : []),
    ]);
  },
);

it.each([
  ["en-GB", "Prep station name: BAR · Course: Starters"],
  ["es-ES", "Nombre de estación de preparación: BAR · Curso: Starters"],
] as const)(
  "starts the Details line with the Kitchen fields, their names marked as names, in %s",
  async (locale, line) => {
    setLocale(locale);
    try {
      const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: { ...product, courseId: "course-1" },
        locales: ["en"],
        units: [unit],
        courses: [{ id: "course-1", name: "Starters" }],
      });
      const details = folded(el, "details");
      details.open = false;
      await details.updateComplete;
      const summary = details.shadowRoot!.querySelector(".summary")!;
      const first = summary.querySelector(".summary-row")!;
      expect(first.textContent!.replace(/\s+/g, " ").trim()).toBe(line);
      expect(summary.querySelectorAll(".summary-label")).toHaveLength(
        summaryOf(el, "details").length,
      );
    } finally {
      setLocale("es-ES");
    }
  },
);

it("rows each language's customer-facing name and description in the languages' order, leaving out a blank one", async () => {
  const mountWith = async (value: Partial<ProductEditorDraft>) =>
    (
      await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: { ...product, ...value },
        locales: ["es", "en"],
        units: [unit],
      })
    ).el;
  let el = await mountWith({
    customerName: { en: "Beef tenderloin", es: "Solomillo de ternera" },
    description: { es: " ", en: "Seared" },
  });
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "ES: Solomillo de ternera · EN: Beef tenderloin" },
    { label: t("editor.description"), value: "EN: Seared" },
  ]);
  el = await mountWith({ customerName: { es: " " }, description: { es: "Sellado" } });
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.description"), value: "ES: Sellado" },
  ]);
  el = await mountWith({ customerName: null, description: null });
  expect(detailsPart(el, "descriptors")).toEqual([]);
});

it("draws the On the menu row as named values, only the field names marked as names", async () => {
  const long = (word: string) => Array.from({ length: 60 }, () => word).join(" ");
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: {
      ...product,
      customerName: { en: long("tenderloin"), es: long("solomillo") },
      description: { en: long("seared"), es: long("sellado") },
    },
    locales: ["en", "es"],
    units: [unit],
  });
  const descriptors = folded(el, "details");
  descriptors.open = false;
  await descriptors.updateComplete;
  const rows = descriptors.shadowRoot!.querySelectorAll<HTMLElement>(".summary-row");
  expect(rows.length).toBeGreaterThan(1);
  const summary = rows[1]!;
  expect([...summary.querySelectorAll(".summary-label")].map((label) => label.textContent)).toEqual(
    [`${t("editor.customer_name")}:`, `${t("editor.description")}:`],
  );
  // The language codes are plain text: only the field names are marked.
  expect(summary.textContent).toContain("EN: ");
});

it("starts another product with the image library closed", async () => {
  const el = await mountWithPhoto();
  await openLibrary(el);
  await photoControl(el).updateComplete;
  expect(photoControl(el).shadowRoot!.querySelector("media-image-picker")).not.toBeNull();
  el.value = { ...saved, id: "tea", name: "Tea" };
  await el.updateComplete;
  await photoControl(el).updateComplete;
  expect(photoControl(el).shadowRoot!.querySelector("media-image-picker")).toBeNull();
  await edit(el);
  expect(saveButton(el).disabled).toBe(false);
});

// --- A folded section shows only what is set ---

const bare: ProductEditorDraft = {
  ...product,
  customerName: null,
  description: null,
  kitchenName: null,
  courseId: null,
  allergens: null,
  dietaryDeclarations: [],
};
/** The folded Details line as a person reads it, with the values drawn as placeholders in
 * brackets. */
async function foldedLine(el: ProductEditor): Promise<string> {
  const fold = folded(el, "details");
  fold.open = false;
  await fold.updateComplete;
  return [...fold.shadowRoot!.querySelectorAll(".summary-row")]
    .map((row) => {
      const copy = row.cloneNode(true) as HTMLElement;
      for (const value of copy.querySelectorAll(".summary-placeholder"))
        value.textContent = `[${value.textContent}]`;
      return copy.textContent!.replace(/\s+/g, " ").trim();
    })
    .join(" · ");
}

it.each([
  { locale: "en-GB", line: "Allergens: Not yet reviewed" },
  { locale: "es-ES", line: "Alérgenos: Sin revisar todavía" },
])(
  "a product with nothing set shows only the allergen warning in Details, in $locale",
  async ({ locale, line }) => {
    setLocale(locale as "en-GB" | "es-ES");
    try {
      const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
        open: true,
        value: bare,
        locales: ["en", "es"],
        units: [unit],
        courses: [{ id: "course-1", name: "Starters" }],
      });
      expect(summaryOf(el, "details")).toEqual([
        { label: t("modifiers.allergens"), value: t("editor.allergens_unreviewed"), warning: true },
      ]);
      expect(await foldedLine(el)).toBe(line);
    } finally {
      setLocale("es-ES");
    }
  },
);

it("Details names only the languages that have text", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...bare, customerName: { en: "Battered hake" } },
    locales: ["en", "es"],
    units: [unit],
  });
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: Battered hake" },
  ]);
});

it("a reviewed product with no allergens says so", async () => {
  const el = await mountPricing({ ...bare, allergens: {} });
  expect(detailsPart(el, "nutrition")).toEqual([
    { label: t("modifiers.allergens"), value: t("editor.nutrition.allergens_none") },
  ]);
});

it("Ordering appears only when it is not Anyone", async () => {
  let el = await mountPricing({ ...saved, ordering: "public" });
  expect(summaryOf(el, "details").map(({ label }) => label)).not.toContain(
    t("editor.ordered_on_own"),
  );
  cleanupWidgets();
  el = await mountPricing({ ...saved, ordering: "staff_only" });
  expect(summaryOf(el, "details")).toContainEqual({
    label: t("editor.ordered_on_own"),
    value: t("product.ordering_staff_only"),
  });
});

it("Variants and Modifiers never fold, so they have no summary line", async () => {
  const el = await mountPricing({ ...saved, variants: [], modifiers: [] });
  for (const name of ["variants", "modifiers"]) {
    expect(group(el, name).tagName, name).toBe("FIELDSET");
    expect(group(el, name).closest("wt-disclosure"), name).toBeNull();
  }
});

it("a variant's Details line shows inherited values in italic", async () => {
  const el = await mountVariant();
  const inherited = summaryOf(el, "details").filter((field) => field.placeholder);
  expect(inherited).toEqual(
    expect.arrayContaining([
      { label: t("editor.summary_course"), value: "Mains", placeholder: true },
      { label: t("editor.description"), value: "EN: Roasted in house", placeholder: true },
      {
        label: t("modifiers.allergens"),
        value: allergenName("milk"),
        placeholder: true,
      },
    ]),
  );
  const details = folded(el, "details");
  details.open = false;
  await details.updateComplete;
  const drawn = [...details.shadowRoot!.querySelectorAll(".summary-placeholder")];
  expect(drawn.map((value) => value.textContent)).toEqual(
    expect.arrayContaining(["Mains", "EN: Roasted in house", allergenName("milk")]),
  );
  for (const value of drawn) expect(getComputedStyle(value).fontStyle).toBe("italic");
});

it("each Details row is cut after two lines at phone width", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  const long = (word: string) => Array.from({ length: 40 }, () => word).join(" ");
  try {
    await page.viewport(400, 844);
    expect(window.innerWidth).toBe(400);
    const { el, host } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: {
        ...saved,
        kitchenName: long("grill"),
        customerName: { en: long("tenderloin"), es: long("solomillo") },
        description: { en: long("seared") },
      },
      locales: ["en", "es"],
      units: [unit],
    });
    host.style.lineHeight = "20px";
    const details = folded(el, "details");
    details.open = false;
    await details.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const rows = [...details.shadowRoot!.querySelectorAll<HTMLElement>(".summary-row")];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(41);
    }
    const dialog = el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  } finally {
    await page.viewport(width, height);
  }
});

it.each<{ label: string; allergens: ProductEditorDraft["allergens"] }>([
  { label: "never reviewed", allergens: null },
  { label: "reviewed and empty", allergens: {} },
])("reads a product's allergens $label distinctly while closed and open", async ({ allergens }) => {
  const el = await mountPricing({ ...saved, allergens });
  const closed = detailsPart(el, "nutrition")[0]!;
  expect(closed).toEqual({
    label: t("modifiers.allergens"),
    value: t(
      allergens === null ? "editor.allergens_unreviewed" : "editor.nutrition.allergens_none",
    ),
    ...(allergens === null ? { warning: true } : {}),
  });
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  expect(
    picker.shadowRoot!.querySelector('[data-choice="none"]')!.getAttribute("aria-pressed"),
  ).toBe(String(allergens !== null));
  expect(picker.shadowRoot!.querySelector('[data-test="allergens-summary"]')).toBeNull();
});
it("lists chosen and implied dietary preferences after allergens on the folded line", async () => {
  const el = await mountPricing({
    ...saved,
    allergens: { milk: {}, eggs: {} },
    dietaryDeclarations: ["vegetarian", "vegan"],
  });
  expect(detailsPart(el, "nutrition")).toEqual([
    { label: t("modifiers.allergens"), value: `${allergenName("milk")}, ${allergenName("eggs")}` },
    {
      label: t("editor.nutrition.dietary"),
      value: `${t("editor.diet.vegan")}, ${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}`,
    },
  ]);
  await openSection(el, "details");
  const picker = el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!;
  await picker.updateComplete;
  for (const choice of [
    "allergen-milk",
    "allergen-eggs",
    "diet-vegetarian",
    "diet-vegan",
    "diet-no_meat",
    "diet-no_fish",
  ])
    expect(
      picker.shadowRoot!.querySelector(`[data-choice="${choice}"]`)!.getAttribute("aria-pressed"),
    ).toBe("true");
});

it("shows a variant's blank fields folded as its parent's values, as placeholders; its names stay its own", async () => {
  const el = await mountVariant({ ...glass, kitchenName: null, customerName: null });
  expect(detailsPart(el, "kitchen")).toEqual([
    { label: t("editor.summary_course"), value: "Mains", placeholder: true },
  ]);
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.description"), value: "EN: Roasted in house", placeholder: true },
  ]);
  expect(detailsPart(el, "nutrition")).toEqual([
    { label: t("modifiers.allergens"), value: allergenName("milk"), placeholder: true },
    {
      label: t("editor.nutrition.dietary"),
      value: `${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}`,
      placeholder: true,
    },
  ]);
  expect(await foldedLine(el)).toBe(
    [
      `${t("editor.summary_course")}: [Mains]`,
      `${t("editor.description")}: [EN: Roasted in house]`,
      `${t("modifiers.allergens")}: [${allergenName("milk")}] · ${t("editor.nutrition.dietary")}: [${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}]`,
    ].join(" · "),
  );
});

it("shows folded what a variant will use where its parent has nothing set either", async () => {
  const mountWith = (inherited: Partial<InheritedValues>) =>
    mountVariant({ ...glass, inherited: { ...parentValues, ...inherited } });
  let el = await mountWith({
    courseId: null,
    description: null,
    allergens: {},
    dietaryDeclarations: [],
  });
  expect(detailsPart(el, "kitchen")).toEqual([{ label: t("editor.kitchen_name"), value: "GLS" }]);
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: A glass" },
  ]);
  expect(detailsPart(el, "nutrition")).toEqual([
    {
      label: t("modifiers.allergens"),
      value: t("editor.nutrition.allergens_none"),
      placeholder: true,
    },
  ]);
  cleanupWidgets();
  el = await mountWith({ allergens: null, courseId: "gone", description: { en: " " } });
  expect(detailsPart(el, "nutrition")[0]).toEqual({
    label: t("modifiers.allergens"),
    value: t("editor.allergens_unreviewed"),
    placeholder: true,
    warning: true,
  });
  expect(detailsPart(el, "kitchen")[1]).toEqual({
    label: t("editor.summary_course"),
    value: t("editor.missing_choice"),
    placeholder: true,
  });
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: A glass" },
  ]);
});

it("shows no parent description folded for a variant described only in a language not shown", async () => {
  const el = await mountVariant({ ...glass, description: { fr: "Glacé" } });
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: A glass" },
  ]);
});

it("shows a variant's own values folded as its own, never as placeholders", async () => {
  const el = await mountVariant({
    ...glass,
    courseId: "desserts",
    description: { en: "Iced" },
    allergens: { eggs: {} },
    dietaryDeclarations: ["vegan"],
  });
  expect(detailsPart(el, "kitchen")).toEqual([
    { label: t("editor.kitchen_name"), value: "GLS" },
    { label: t("editor.summary_course"), value: "Desserts" },
  ]);
  expect(detailsPart(el, "descriptors")).toEqual([
    { label: t("editor.customer_name"), value: "EN: A glass" },
    { label: t("editor.description"), value: "EN: Iced" },
  ]);
  expect(detailsPart(el, "nutrition")).toEqual([
    { label: t("modifiers.allergens"), value: allergenName("eggs") },
    {
      label: t("editor.nutrition.dietary"),
      value: `${t("editor.diet.vegan")}, ${t("editor.diet.vegetarian")}, ${t("editor.diet.no_meat")}, ${t("editor.diet.no_fish")}`,
    },
  ]);
});

it("names a product's course missing from the course list as unavailable on the folded line", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...bare, courseId: "gone" },
    locales: ["en"],
    units: [unit],
    courses: [{ id: "course-1", name: "Starters" }],
  });
  expect(detailsPart(el, "kitchen")).toEqual([
    { label: t("editor.summary_course"), value: t("editor.missing_choice") },
  ]);
});

it("draws a variant's inherited folded values in grey italic, its own upright", async () => {
  const el = await mountVariant();
  el.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const details = folded(el, "details");
  details.open = false;
  await details.updateComplete;
  const inherited = details.shadowRoot!.querySelector(".summary-placeholder")!;
  expect(inherited.textContent).toBe("Mains");
  expect(getComputedStyle(inherited).fontStyle).toBe("italic");
  expect(getComputedStyle(inherited).color).toBe("rgb(7, 8, 9)");
  expect(details.shadowRoot!.querySelectorAll(".summary-placeholder")).toHaveLength(
    summaryOf(el, "details").filter((field) => "placeholder" in field && field.placeholder).length,
  );
});

// --- Window widths (W70) ---

const dialogWidth = (dialog: Element) =>
  dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().width;

// At 1280px wide the modal's side margin is 24px, so no size is capped by the window: standard is
// 42rem (672px), compact 28rem (448px) and wide 64rem (1024px).
it("opens the editor in the standard modal size on a desktop", async () => {
  await atDesktopWidth(async () => {
    const el = await mountPricing({ ...saved, variants: [small, large] });
    expect(dialogWidth(el.shadowRoot!.querySelector("wt-modal")!)).toBeCloseTo(672, 0);
  });
});

it("opens the image chooser at the wide size from inside the standard editor", async () => {
  await atDesktopWidth(async () => {
    const el = await mountWithPhoto();
    await openLibrary(el);
    await photoControl(el).updateComplete;
    const chooser = photoControl(el).shadowRoot!.querySelector("wt-modal")!;
    await chooser.updateComplete;
    expect(chooser.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    expect(dialogWidth(chooser)).toBeCloseTo(1024, 0);
  });
});

it("opens the unit chooser at the compact modal width on a desktop", async () => {
  await atDesktopWidth(async () => {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      value: product,
      locales: ["en"],
      units: [unit],
    });
    await openUnits(el);
    const dialog = unitChooser(el);
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(dialogWidth(dialog)).toBeCloseTo(448, 0);
    const body = dialog.shadowRoot!.querySelector(".body")!;
    const content =
      body.getBoundingClientRect().width - 2 * parseFloat(getComputedStyle(body).paddingLeft);
    expect(dialog.querySelector(".unit-chooser")!.getBoundingClientRect().width).toBeCloseTo(
      content,
      0,
    );
  });
});

it("ignores a previous product's image-picker return after reseeding", async () => {
  const el = await mountWithPhoto();
  const previous = appearance(el);
  photoControl(el).dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: true },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  photoControl(el).dispatchEvent(
    new CustomEvent("image-picker-state", {
      detail: { open: false },
      bubbles: true,
      composed: true,
    }),
  );
  el.value = { ...saved, id: "another-product", name: "Another dish" };
  await el.updateComplete;
  await closeReportsDelivered();
  const next = appearance(el);
  await next.updateComplete;
  expect(next).not.toBe(previous);
  expect(next.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
});

it("focuses a refused variant row's action", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, variants: [small] },
    locales: ["en"],
    units: [unit],
  });
  el.fieldErrors = { [productEditorField("variants.0.unitPrice", "en")!]: "Refused price" };
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("dashboard-variant-table")!;
  await expect
    .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
    .toBe("actions-0");
});

it("focuses the Modifiers control for a refused attachment", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    value: { ...product, modifiers: [{ kind: "extras", id: "sauces" }] },
    locales: ["en"],
    units: [unit],
    extraLists,
    optionLists,
  });
  el.fieldErrors = { modifier: "Refused list" };
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(addModifier(el));
  expect(addModifier(el).error).toBe("Refused list");
});

it.each(["image", "product-color"])(
  "one Escape after a real %s refusal closes only the appearance panel",
  async (field) => {
    const el = await mountWithPhoto();
    await edit(el);
    const submitted = vi.fn();
    el.addEventListener("wt-submit", submitted);
    await userEvent.click(saveButton(el));
    expect(submitted).toHaveBeenCalledOnce();
    el.fieldErrors = { [field]: "Refused appearance" };
    await el.updateComplete;
    const panel = appearance(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await expect.poll(() => panel.matches(":popover-open")).toBe(true);
    await expect
      .poll(() =>
        field === "image"
          ? photoControl(el).shadowRoot!.activeElement?.getAttribute("data-test") === "choose-image"
          : el.shadowRoot!.activeElement?.getAttribute("name") === "product-color",
      )
      .toBe(true);
    const name = el.shadowRoot!.querySelector('wt-input[name="name"]')!;
    for (let i = 0; i < 100 && el.shadowRoot!.activeElement !== name; i++)
      await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(el.shadowRoot!.activeElement).toBe(name);
    expect(panel.matches(":popover-open")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(panel.matches(":popover-open")).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
    expect(el.open).toBe(true);
  },
);

it("shows a refused colour even when another refused field takes focus first", async () => {
  const el = await mountWithPhoto();
  el.fieldErrors = { name: "Refused name", "product-color": "Refused colour" };
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.activeElement?.getAttribute("name")).toBe("name");
  const error = el.shadowRoot!.querySelector<HTMLElement>("#product-color-error")!;
  expect(error.textContent!.trim()).toBe("Refused colour");
  expect(error.checkVisibility()).toBe(true);
});

it("saves selected cereal and nut kinds and preserves them on a later diet edit", async () => {
  const el = await mountPricing({
    ...saved,
    allergens: { gluten: { kinds: ["wheat", "barley"] }, milk: {} },
  });
  const picker = el.shadowRoot!.querySelector<
    HTMLElementTagNameMap["dashboard-product-nutrition-picker"]
  >("dashboard-product-nutrition-picker")!;
  expect(picker.value.allergens).toEqual({ gluten: { kinds: ["wheat", "barley"] }, milk: {} });
  picker.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: {
        field: "allergens",
        value: allergensFromChoices(["gluten:wheat", "gluten:barley", "nuts:walnuts", "milk"]),
      },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(el.currentValue.allergens).toEqual({
    gluten: { kinds: ["wheat", "barley"] },
    nuts: { kinds: ["walnuts"] },
    milk: {},
  });
  picker.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "dietaryDeclarations", value: ["vegetarian"] },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  save(el);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value.allergens).toEqual({
    gluten: { kinds: ["wheat", "barley"] },
    nuts: { kinds: ["walnuts"] },
    milk: {},
  });
});

it("opens Details for a refused allergen kind, marks the picker and allows retry", async () => {
  const el = await mountPricing(saved);
  await edit(el);
  el.fieldErrors = { allergens: "Choose which cereals" };
  await el.updateComplete;
  const fold = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-section="details"]',
  )!;
  await fold.updateComplete;
  expect(fold.open).toBe(true);
  expect(
    el
      .shadowRoot!.querySelector("dashboard-product-nutrition-picker")!
      .shadowRoot!.querySelector("#allergens-error")!.textContent,
  ).toBe("Choose which cereals");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveButton(el).disabled).toBe(false);
  el.shadowRoot!.querySelector("dashboard-product-nutrition-picker")!.dispatchEvent(
    new CustomEvent("wt-nutrition-change", {
      detail: { field: "allergens", value: allergensFromChoices(["gluten:wheat"]) },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(
    el
      .shadowRoot!.querySelector("dashboard-product-nutrition-picker")!
      .shadowRoot!.querySelector("#allergens-error"),
  ).toBeNull();
});

describe("help mode", () => {
  const HELPED = [
    { name: "unit-price", key: "help.products.price" },
    { name: "product-course", key: "help.products.course" },
  ] as const;

  afterEach(() => setHelpMode(false));

  async function badgeOf(host: Element): Promise<WtHelpTooltip> {
    const badge = host.querySelector<WtHelpTooltip>(':scope > wt-help-tooltip[slot="help"]');
    expect(badge, `${host.localName} has a help badge`).not.toBeNull();
    await badge!.updateComplete;
    return badge!;
  }
  function field(el: ProductEditor, name: string) {
    return el.shadowRoot!.querySelector<HTMLElement & { label: string }>(`[name="${name}"]`)!;
  }
  function variantsLegend(el: ProductEditor) {
    return group(el, "variants").querySelector("legend")!;
  }
  async function mountOpen(value: ProductEditorDraft = saved) {
    const el = await mountPricing(value, { courses: [{ id: "course-1", name: "Starters" }] });
    await openSection(el, "details");
    return el;
  }

  it.each([
    { variants: [], label: "Price" },
    { variants: [small], label: "Base price" },
  ])(
    "with help on, the price, VAT, course and Variants show a badge with their help text ($label)",
    async ({ variants, label }) => {
      const before = currentLocale();
      setLocale("en-GB");
      try {
        const el = await mountOpen({ ...saved, variants });
        expect(field(el, "unit-price").label.startsWith(label)).toBe(true);
        const hosts = [
          ...HELPED.map(({ name, key }) => ({ host: field(el, name), key })),
          { host: variantsLegend(el), key: "help.products.variants" as const },
        ];
        for (const { host } of hosts) expect((await badgeOf(host)).checkVisibility()).toBe(false);
        setHelpMode(true);
        for (const { host, key } of hosts) {
          const badge = await badgeOf(host);
          const part =
            host.localName === "legend"
              ? t("editor.variants")
              : (host as HTMLElement & { label: string }).label;
          expect(badge.checkVisibility()).toBe(true);
          await expect
            .element(badge.shadowRoot!.querySelector("button")!)
            .toHaveAccessibleName(`Help: ${part}`);
          expect(badge.textContent!.trim()).toBe(t(key));
        }
      } finally {
        setLocale(before);
      }
    },
  );

  it("in Spanish the badges read the Spanish help", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const el = await mountOpen();
      setHelpMode(true);
      const badge = await badgeOf(field(el, "product-course"));
      await expect
        .element(badge.shadowRoot!.querySelector("button")!)
        .toHaveAccessibleName("Ayuda: Curso");
      expect(badge.textContent!.trim()).toBe(t("help.products.course"));
      expect(badge.textContent!.trim()).toMatch(/^El curso en que sale/);
    } finally {
      setLocale(before);
    }
  });

  it("links the price, course and Variants badges to their guide sections", async () => {
    const before = currentLocale();
    setLocale("en-GB");
    try {
      const el = await mountOpen();
      const linked = [
        { host: field(el, "unit-price"), href: "/help/en/products#selling-unit" },
        { host: field(el, "product-course"), href: "/help/en/products#course" },
        { host: variantsLegend(el), href: "/help/en/products#variants" },
      ];
      for (const { host, href } of linked) {
        const badge = await badgeOf(host);
        expect(badge.getAttribute("guide-href")).toBe(href);
        expect(badge.getAttribute("guide-label")).toBe(t("help.guide_link"));
      }
    } finally {
      setLocale(before);
    }
  });

  it("links to the Spanish guide when the dashboard is in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const el = await mountOpen();
      const badge = await badgeOf(field(el, "product-course"));
      expect(badge.getAttribute("guide-href")).toBe("/help/es/products#course");
      expect(badge.getAttribute("guide-label")).toBe("Más información en la guía");
    } finally {
      setLocale(before);
    }
  });

  it("turning help on moves nothing in the editor", async () => {
    const el = await mountOpen();
    const boxes = () => [
      ...HELPED.map(({ name }) =>
        field(el, name).shadowRoot!.querySelector("[part=field]")!.getBoundingClientRect().toJSON(),
      ),
      variantsLegend(el).getBoundingClientRect().toJSON(),
    ];
    const off = boxes();
    setHelpMode(true);
    for (const { name } of HELPED) await badgeOf(field(el, name));
    await badgeOf(variantsLegend(el));
    await new Promise(requestAnimationFrame);
    expect(boxes()).toEqual(off);
  });
});

it("labels and sorts unit choices by their independent staff fallbacks when customer maps are empty", async () => {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["es", "en"],
    units: [
      { id: "z", staffName: "Zebra crates", staffAbbreviation: "zc", name: {}, abbreviation: {} },
      { id: "a", staffName: "Alpha trays", staffAbbreviation: "at", name: {}, abbreviation: {} },
    ],
  });
  await openUnits(el);
  expect(
    combobox(el, "unit")!.options.filter(({ value }) => value === "a" || value === "z"),
  ).toEqual([
    { value: "a", label: "Alpha trays (at)" },
    { value: "z", label: "Zebra crates (zc)" },
  ]);
});

it("refreshes live unit choice labels after a content default change without resetting the product draft", async () => {
  const before = currentLocale();
  setLocale("fr-FR");
  try {
    const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
      open: true,
      locales: ["en", "es"],
      units: [
        {
          id: "live",
          staffName: "Staff crate",
          staffAbbreviation: "sc",
          name: { en: "English crate", es: "Spanish crate" },
          abbreviation: { en: "ec", es: "se" },
        },
      ],
    });
    await openUnits(el);
    expect(combobox(el, "unit")!.options.find(({ value }) => value === "live")!.label).toBe(
      "English crate (ec)",
    );
    const draft = structuredClone(el.currentValue);
    setContentLanguages({ defaultLanguage: "es", languages: ["en", "es"] });
    await vi.waitFor(() =>
      expect(combobox(el, "unit")!.options.find(({ value }) => value === "live")!.label).toBe(
        "Spanish crate (se)",
      ),
    );
    expect(el.currentValue).toEqual(draft);
  } finally {
    setLocale(before);
  }
});

it.each([
  { kind: "decimal", precision: 1, hardwareUnit: null, measure: false },
  { kind: "scale", precision: 0, hardwareUnit: "g", measure: false },
  { kind: "measure", precision: 0, hardwareUnit: null, measure: true },
])("explains omitted extras for $kind dishes without preventing their save", async (facts) => {
  const before = currentLocale();
  setLocale("en-GB");
  try {
    const el = await mountPricing(
      { ...saved, modifiers: [{ kind: "extras", id: "sauces" }] },
      { units: [{ ...unit, ...facts }], extraLists },
    );
    expect(group(el, "modifiers").textContent).toContain(
      "The till will not offer extras for this dish because of its unit.",
    );
    await edit(el);
    expect(submittedValue(el).modifiers).toEqual([{ kind: "extras", id: "sauces" }]);
  } finally {
    setLocale(before);
  }
});

it("updates the extras notice as units change, including Each and a missing choice", async () => {
  const before = currentLocale();
  setLocale("es-ES");
  try {
    const el = await mountPricing(saved, {
      units: [
        { ...unit, precision: 0, hardwareUnit: null },
        { ...unit, id: "measured", precision: 0, hardwareUnit: null, measure: true },
      ],
      extraLists,
    });
    const note = () =>
      group(el, "modifiers").textContent!.includes(
        "El TPV no ofrecerá extras para este plato por su unidad.",
      );
    expect(note()).toBe(false);
    el.selectRelated("unit", "measured");
    await el.updateComplete;
    expect(note()).toBe(true);
    el.selectRelated("unit", "missing");
    await el.updateComplete;
    expect(note()).toBe(false);
    await openUnits(el);
    await chooseOption(combobox(el, "unit")!, EACH_CHOICE);
    await el.updateComplete;
    expect(note()).toBe(false);
    expect(el.currentValue.unitId).toBeNull();
  } finally {
    setLocale(before);
  }
});

it("submits only entered regional product names and clearing a version restores inheritance", async () => {
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "en-US", "es"] });
  const el = await mountPricing(
    { ...saved, name: "chips", customerName: { en: "chips" } },
    { locales: ["en", "en-US", "es"] },
  );
  await openSection(el, "details");
  const us = control<HTMLInputElement>(el, "customer-name-en-US");
  expect([us.value, us.placeholder]).toEqual(["", "chips"]);
  await input(el, "customer-name-en-US", "fries");
  const submitted = vi.fn();
  el.addEventListener("wt-submit", submitted);
  save(el);
  expect(submitted.mock.calls[0]![0].detail.value.customerName).toEqual({
    en: "chips",
    "en-US": "fries",
  });
  const edited = await mountPricing(
    { ...saved, name: "chips", customerName: { en: "chips", "en-US": "fries" } },
    { locales: ["en", "en-US", "es"] },
  );
  await openSection(edited, "details");
  await input(edited, "customer-name-en-US", "");
  const cleared = vi.fn();
  edited.addEventListener("wt-submit", cleared);
  save(edited);
  expect(cleared.mock.calls[0]![0].detail.value.customerName).toEqual({ en: "chips" });
});

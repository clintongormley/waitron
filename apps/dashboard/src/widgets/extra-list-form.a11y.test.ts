import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ExtraListForm } from "./extra-list-form.js";
import type { ExtraList, Product } from "../api/client.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

/**
 * The form only exposes anything to the accessibility tree once it is OPEN, so every state below is
 * mounted with `open = true`. The list's three names read differently on purpose (CLAUDE.md §3).
 * The `many` state holds an item whose product this form was given no row for, so the fallback cell
 * is scanned too.
 */
function product(id: string, name: string, unitPrice: string): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: "category-1",
    primaryCategoryId: "category-1",
    name,
    customerName: { es: `${name} para el cliente` },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice,
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "not_sold_separately",
    allergens: null,
    dietOverride: null,
    dietDerivation: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
  };
}

const BACON = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const EGG = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CHEESE = "cccccccc-3333-4333-8333-cccccccccccc";
const GONE = "dddddddd-4444-4444-8444-dddddddddddd";

const products: Product[] = [
  product(BACON, "Bacon", "1.50"),
  product(EGG, "Fried egg", "0.80"),
  product(CHEESE, "Manchego", "2.25"),
];

const addons: ExtraList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Add-ons",
  customerName: { en: "Make it yours", es: "Añádele algo" },
  kitchenName: "ADD",
  minPicks: 0,
  maxPicks: 2,
  active: true,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      productId: BACON,
      maxQuantity: 2,
      preselected: true,
      price: "2.00",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      productId: EGG,
      maxQuantity: 1,
      preselected: false,
      price: null,
    },
  ],
};

const many: ExtraList = {
  ...addons,
  items: [
    ...addons.items,
    {
      id: "44444444-4444-4444-8444-444444444444",
      productId: CHEESE,
      maxQuantity: 3,
      preselected: false,
      price: "2.25",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      productId: GONE,
      maxQuantity: 1,
      preselected: false,
      price: null,
    },
  ],
};

const states = [
  "create",
  "edit",
  "invalid",
  "busy",
  "server-error",
  "many-items",
  "names-open",
  "names-error",
] as const;

describe.each(["light", "dark"] as const)("extra list form (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<ExtraListForm>(
      "dashboard-extra-list-form",
      {
        open: true,
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        products,
        value:
          state === "many-items" ? many : state === "create" || state === "invalid" ? null : addons,
        busy: state === "busy",
        fieldErrors:
          state === "server-error"
            ? {
                name: "That name is already used.",
                "items.0.productId": "That product was deleted.",
              }
            : state === "names-error"
              ? { customerName: "Too long for the menu." }
              : {},
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector('[name="kitchen-name"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "XTR" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.error,
      ).not.toBe("");
    }
    const names = el.shadowRoot!.querySelector<
      HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
    >('[data-test="names-section"]')!;
    if (state === "names-open") names.open = true;
    await names.updateComplete;
    // Each named state is scanned in the shape it names: the names section closed unless opened or
    // holding an error.
    expect(names.open).toBe(state === "names-open" || state === "names-error");
    await expectNoA11yViolations(host);
  });

  it("renders a mixed list's fixed 1 and its required, refused Portion field accessibly", async () => {
    const each = {
      id: "00000000-0000-0000-0000-000000000001",
      name: { es: "Unidad" },
      precision: 0,
      abbreviation: { es: "ud" },
    };
    const { el, host } = await mountWidget<ExtraListForm>(
      "dashboard-extra-list-form",
      {
        open: true,
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        products: [
          { ...product(BACON, "Bacon", "1.50"), unitId: each.id, unit: each },
          {
            ...product(EGG, "Fried egg", "0.80"),
            unitId: "unit-ml",
            unit: { id: "unit-ml", name: { es: "Mililitro" }, precision: 0, abbreviation: {} },
          },
        ],
        value: {
          ...addons,
          items: [
            { ...addons.items[0]!, portion: "1.000" },
            { ...addons.items[1]!, portion: "" },
          ],
        },
      },
      theme,
    );
    el.shadowRoot!.querySelector('[name="kitchen-name"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "XTR" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-test="item-0-portion-fixed"]')).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="item-1-portion"]')!
        .error,
    ).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("renders a listed product with an Active variant, marked on its row, and the picker open on a greyed product, accessibly", async () => {
    const wine = {
      ...product(GONE, "Wine", "3.00"),
      variants: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          name: "Glass",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
          active: true,
          effective: { unitPrice: "3.00", vatClass: "general" as const, primaryCategoryId: null },
        },
      ],
    };
    const sparkling = { ...wine, id: "77777777-7777-4777-8777-777777777777", name: "Cava" };
    const { el, host } = await mountWidget<ExtraListForm>(
      "dashboard-extra-list-form",
      {
        open: true,
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        products: [...products, wine, sparkling],
        value: { ...addons, items: [{ ...addons.items[0]!, productId: GONE }] },
      },
      theme,
    );
    expect(el.shadowRoot!.querySelector('[data-test="item-0-product-error"]')).not.toBeNull();
    const picker = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      '[data-test="add-product"]',
    )!;
    picker.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector('[aria-disabled="true"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

async function mountOpen(value: ExtraList | null, theme: "light" | "dark") {
  const { el, host } = await mountWidget<ExtraListForm>(
    "dashboard-extra-list-form",
    { open: true, languages: { defaultLanguage: "en", languages: ["en", "es"] }, products, value },
    theme,
  );
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: ExtraListForm) {
  await el.updateComplete;
  const save = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-modal [data-test="save"]',
  )!;
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
/** Types into a `wt-input`'s own input, the way a person does. */
async function type(el: ExtraListForm, name: string, value: string) {
  const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("extras list Save states (%s)", (theme) => {
  it("is accessible with Save quiet, for a stored list and for a new one", async () => {
    for (const value of [addons, null]) {
      const { el, host } = await mountOpen(value, theme);
      expect(await saveState(el)).toEqual(quiet);
      await expectNoA11yViolations(host);
      cleanupWidgets();
    }
  });

  it("is accessible with Save primary after an edit", async () => {
    const { el, host } = await mountOpen(addons, theme);
    await type(el, "name", "Extras");
    expect(await saveState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});

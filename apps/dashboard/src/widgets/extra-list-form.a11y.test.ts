import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ExtraListForm } from "./extra-list-form.js";
import type { ExtraList, Product } from "../api/client.js";

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
    labelIds: [],
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
    soldAlone: false,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
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

const states = ["create", "edit", "invalid", "busy", "server-error", "many-items"] as const;

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
            : {},
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

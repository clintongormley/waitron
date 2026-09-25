import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-list.js";
import type { ProductList } from "./product-list.js";
import type { Product } from "../api/client.js";

/**
 * The fixture covers all THREE allergen states, both active/inactive badges, the Unavailable badge,
 * a product with and without an image, and variant rows. The Inactive product sits behind the status
 * filter, so one case shows every status.
 */
const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-1",
    labelIds: [],
    primaryCategoryId: "cat-1",
    name: "Croquetas de jamón",
    customerName: { es: "Croquetas caseras de jamón ibérico" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    available: false,
    soldAlone: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: "abc123.webp",
    variants: [],
  },
  {
    id: "p2",
    modifiers: [],
    catalogueId: "c1",
    categoryId: null,
    labelIds: [],
    primaryCategoryId: null,
    name: "Agua mineral",
    customerName: { es: "Agua mineral con gas" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: false,
    available: true,
    soldAlone: true,
    allergens: {},
    dietOverride: null,
    manualAllergens: {},
    image: null,
    variants: [],
  },
  {
    id: "p3",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-2",
    labelIds: [],
    primaryCategoryId: "cat-2",
    name: "Tarta de queso",
    customerName: { es: "Tarta de queso de la abuela" },
    unitId: "u-kg",
    unit: { id: "u-kg", name: { es: "Kilogramo" }, precision: 3, abbreviation: { es: "kg" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "weight",
    unitPrice: "15.00",
    vatClass: "super_reduced",
    active: true,
    available: true,
    soldAlone: true,
    allergens: {
      gluten: { presence: "contains", source: "trigo" },
      milk: { presence: "contains" },
    },
    dietOverride: null,
    manualAllergens: {
      gluten: { presence: "contains", source: "trigo" },
      milk: { presence: "contains" },
    },
    image: null,
    variants: [],
  },
  {
    id: "p4",
    modifiers: [],
    catalogueId: "c1",
    categoryId: "cat-1",
    labelIds: [],
    primaryCategoryId: "cat-1",
    name: "Vino por copa",
    customerName: { es: "Vino de la casa por copa" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "3.00",
    vatClass: "reduced",
    active: true,
    available: true,
    soldAlone: true,
    allergens: {},
    dietOverride: null,
    manualAllergens: {},
    image: null,
    variants: [
      {
        id: "v1",
        name: "Vino 175",
        customerName: { es: "Copa grande" },
        kitchenName: "V175",
        image: null,
        unitPrice: "4.50",
        available: false,
        active: true,
        effective: {
          unitPrice: "4.50",
          vatClass: "general",
          primaryCategoryId: "cat-2",
          labelIds: [],
        },
      },
      {
        id: "v2",
        name: "Vino 250",
        customerName: { es: "Copa doble" },
        kitchenName: "V250",
        image: null,
        unitPrice: null,
        available: true,
        active: false,
        effective: {
          unitPrice: "3.00",
          vatClass: "reduced",
          primaryCategoryId: "cat-1",
          labelIds: [],
        },
      },
    ],
  },
];

afterEach(cleanupWidgets);
// The table remembers its sort and filter choices in sessionStorage under waitron.products.table, so
// a choice one test makes would otherwise be restored into the next one.
beforeEach(() => sessionStorage.clear());

describe.each(["light", "dark"] as const)("product-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<ProductList>("dashboard-product-list", { products }, theme);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with every status shown", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-filter="active"]',
    )!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="p4"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(table.shadowRoot!.querySelectorAll("[data-test=active-badge]")).toHaveLength(6);
    expect(table.shadowRoot!.querySelector("[data-test=vat-note]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a removed variant shown under its Active product", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const select = table.shadowRoot!.querySelector<HTMLSelectElement>(
      'select[data-filter="active"]',
    )!;
    select.value = "inactive";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector('[part~="context"]')).not.toBeNull();
    expect(table.shadowRoot!.querySelector('tr[data-row-key="p4:v2"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the row action menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector("wt-row-actions")!.show();
    await expectNoA11yViolations(host);
  });
});

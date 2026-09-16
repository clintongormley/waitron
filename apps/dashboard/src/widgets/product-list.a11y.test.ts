import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-list.js";
import type { ProductList } from "./product-list.js";
import type { Product } from "../api/client.js";

/**
 * The product list is a PURE DISPLAY widget — no `api`, so no in-flight fetch to settle. It is mounted
 * with `products` assigned as a property, in both themes, and axe is run against the themed host so a
 * color-contrast check means what it means in the app.
 *
 * The fixture covers all THREE allergen states (null=PENDING, {}=none, {…}=declared), both
 * active/inactive badges, and both a product WITH a decorative image and one WITHOUT
 * (the placeholder) — so axe sees the whole rendered surface, every branch of the row template.
 */
const products: Product[] = [
  {
    id: "p1",
    modifierIds: [],
    catalogueId: "c1",
    categoryId: "cat-1",
    categoryIds: ["cat-1"],
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
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: "abc123.webp",
    variants: [],
  },
  {
    id: "p2",
    modifierIds: [],
    catalogueId: "c1",
    categoryId: null,
    categoryIds: [],
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
    allergens: {},
    dietOverride: null,
    manualAllergens: {},
    image: null,
    variants: [],
  },
  {
    id: "p3",
    modifierIds: [],
    catalogueId: "c1",
    categoryId: "cat-2",
    categoryIds: ["cat-2"],
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
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("product-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<ProductList>("dashboard-product-list", { products }, theme);
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

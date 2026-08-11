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
 * active/inactive badges, and both a product WITH an image (the `<img>` + its `alt`) and one WITHOUT
 * (the placeholder) — so axe sees the whole rendered surface, every branch of the row template.
 */
const products: Product[] = [
  {
    id: "p1",
    catalogueId: "c1",
    categoryId: "cat-1",
    descriptions: { es: "Croquetas de jamón" },
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    allergens: null,
    image: "abc123.webp",
  },
  {
    id: "p2",
    catalogueId: "c1",
    categoryId: null,
    descriptions: { es: "Agua mineral" },
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: false,
    allergens: {},
    image: null,
  },
  {
    id: "p3",
    catalogueId: "c1",
    categoryId: "cat-2",
    descriptions: { es: "Tarta de queso" },
    pricingUnit: "weight",
    unitPrice: "15.00",
    vatClass: "super_reduced",
    active: true,
    allergens: {
      gluten: { presence: "contains", source: "trigo" },
      milk: { presence: "contains" },
    },
    image: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("product-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<ProductList>("dashboard-product-list", { products }, theme);
    await expectNoA11yViolations(host);
  });
});

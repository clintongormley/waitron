import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-allergen-screen.js";
import type { TillAllergenScreen } from "./till-allergen-screen.js";
import type { TillProduct } from "../api/client.js";

// One of each declaration state — pending (null), reviewed-with-allergens, reviewed-empty ({}) — so
// every row shape (pending cell, contains/may-contain markers, blank cells) is under axe at once.
const products: TillProduct[] = [
  {
    id: "coffee",
    name: "Café",
    customerName: { es: "Café para el cliente", en: "Coffee for the customer" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  },
  {
    id: "sandwich",
    name: "Bocadillo",
    customerName: { es: "Bocadillo para el cliente", en: "Sandwich for the customer" },
    pricingUnit: "each",
    unitPrice: "4.00",
    vatClass: "reduced",
    category: null,
    allergens: {
      gluten: { presence: "contains", source: "wheat" },
      milk: { presence: "may_contain" },
    },
    // A published diet (dietary-classification, Task 7) so the detail dialog's diet badges — a
    // vegetarian success-toned badge and a contains-meat chip — are under axe in both themes.
    diet: { vegan: "no", vegetarian: "yes", contains: ["meat"] },
  },
  {
    id: "water",
    name: "Agua",
    customerName: { es: "Agua para el cliente", en: "Water for the customer" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: {},
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-allergen-screen a11y (%s theme)", (theme) => {
  it("has no violations rendering the matrix", async () => {
    const { host } = await mountWidget<TillAllergenScreen>(
      "till-allergen-screen",
      { products },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a product's detail dialog open", async () => {
    const { el, host } = await mountWidget<TillAllergenScreen>(
      "till-allergen-screen",
      { products },
      theme,
    );
    const rows = [...el.shadowRoot!.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    const sandwich = rows.find((r) =>
      r.querySelector(".row-open")?.textContent?.includes("Bocadillo"),
    );
    sandwich!.querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

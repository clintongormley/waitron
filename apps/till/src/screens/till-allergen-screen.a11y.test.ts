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
    descriptions: { es: "Café", en: "Coffee" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  },
  {
    id: "sandwich",
    descriptions: { es: "Bocadillo", en: "Sandwich" },
    pricingUnit: "each",
    unitPrice: "4.00",
    vatClass: "reduced",
    category: null,
    allergens: {
      gluten: { presence: "contains", source: "wheat" },
      milk: { presence: "may_contain" },
    },
  },
  {
    id: "water",
    descriptions: { es: "Agua", en: "Water" },
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
      r.querySelector(".row-open")?.textContent?.includes("Sandwich"),
    );
    sandwich!.querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

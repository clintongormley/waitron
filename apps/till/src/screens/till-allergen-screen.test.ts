import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillAllergenScreen, ALLERGEN_DISPLAY_ORDER } from "./till-allergen-screen.js";
import { ALLERGEN_NAMES, allergenName } from "../i18n/allergen-names.js";
import { t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";

// A product whose allergens have NOT been reviewed — `null`. Renders "pending", never all-clear.
const coffee: TillProduct = {
  id: "coffee",
  descriptions: { "es-ES": "Café", en: "Coffee" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

// A reviewed product carrying both strengths: gluten CONTAINS (with a source) and milk MAY CONTAIN
// (no source) — so a test can tell the two cells and the two detail rows apart.
const sandwich: TillProduct = {
  id: "sandwich",
  descriptions: { "es-ES": "Bocadillo", en: "Sandwich" },
  pricingUnit: "each",
  unitPrice: "4.00",
  vatClass: "reduced",
  category: null,
  allergens: {
    gluten: { presence: "contains", source: "wheat" },
    milk: { presence: "may_contain" },
  },
};

// A reviewed product with NO declared allergens — `{}`. Distinct from `null`: reviewed/all-clear.
const water: TillProduct = {
  id: "water",
  descriptions: { "es-ES": "Agua", en: "Water" },
  pricingUnit: "each",
  unitPrice: "1.00",
  vatClass: "general",
  category: null,
  allergens: {},
};

const products: TillProduct[] = [coffee, sandwich, water];

/** The tbody row whose row-header button carries `name`. */
function rowFor(el: TillAllergenScreen, name: string): HTMLTableRowElement {
  const rows = [...el.shadowRoot!.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const row = rows.find((r) => r.querySelector(".row-open")?.textContent?.trim() === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

afterEach(cleanupWidgets);

describe("till-allergen-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-allergen-screen")).toBe(TillAllergenScreen);
  });

  it("carries the ask-staff notice in its header", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", { products });
    expect(el.shadowRoot!.textContent).toContain(t("allergens.notice"));
  });

  it("renders a column header per allergen via allergenName(code, locale)", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const headers = [...el.shadowRoot!.querySelectorAll('th[scope="col"]')].map((h) =>
      h.textContent!.trim(),
    );
    expect(headers).toEqual(ALLERGEN_DISPLAY_ORDER.map((code) => allergenName(code, "en")));
  });

  it("renders one row per product, each showing its name in the operator locale", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(rowFor(el, "Coffee")).toBeDefined();
    expect(rowFor(el, "Sandwich")).toBeDefined();
    expect(rowFor(el, "Water")).toBeDefined();
  });

  it("marks a 'contains' cell distinctly from a 'may contain' cell", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const row = rowFor(el, "Sandwich");
    const gluten = row.querySelector('[data-code="gluten"]')!;
    const milk = row.querySelector('[data-code="milk"]')!;
    expect(gluten.classList.contains("contains")).toBe(true);
    expect(milk.classList.contains("may-contain")).toBe(true);
    // The two are genuinely distinct, not the same treatment reused.
    expect(gluten.className).not.toEqual(milk.className);
    // An undeclared allergen is a blank cell — neither strength.
    const eggs = row.querySelector('[data-code="eggs"]')!;
    expect(eggs.classList.contains("contains")).toBe(false);
    expect(eggs.classList.contains("may-contain")).toBe(false);
  });

  it("shows the per-allergen source in the row detail dialog, e.g. 'gluten (wheat)'", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Sandwich").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    // "Cereals containing gluten (wheat)" — name resolved via allergenName, source in parentheses.
    expect(dialog.textContent).toContain(`${allergenName("gluten", "en")} (wheat)`);
    // milk is may-contain with no source: its name shows, tagged, without a "(…)".
    expect(dialog.textContent).toContain(allergenName("milk", "en"));
    expect(dialog.textContent).toContain(t("allergens.contains", "en"));
    expect(dialog.textContent).toContain(t("allergens.may_contain", "en"));
  });

  it("renders allergens === null as the pending state, NOT an all-clear row", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const row = rowFor(el, "Coffee");
    // Pending: the explicit pending treatment...
    expect(row.querySelector(".pending-cell")).not.toBeNull();
    expect(row.textContent).toContain(t("allergens.pending", "en"));
    // ...and crucially NOT fourteen blank cells, which would read as "reviewed, no allergens".
    expect(row.querySelectorAll("td.cell")).toHaveLength(0);
  });

  it("renders allergens === {} as reviewed/all-clear, distinct from pending", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const row = rowFor(el, "Water");
    expect(row.querySelector(".pending-cell")).toBeNull();
    expect(row.textContent).not.toContain(t("allergens.pending", "en"));
    // A full, reviewed cell row — all fourteen present and all blank (no allergens declared).
    expect(row.querySelectorAll("td.cell")).toHaveLength(14);
    expect(row.querySelectorAll("td.cell.contains, td.cell.may-contain")).toHaveLength(0);
  });

  it("the row detail dialog names the product and lists its declared allergens", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Sandwich").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.heading).toBe("Sandwich");
  });

  it("a null product's detail dialog says pending, not a bare empty list", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Coffee").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(t("allergens.pending", "en"));
  });

  it("a reviewed product with nothing declared shows the ask-staff notice in its detail", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Water").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(t("allergens.notice", "en"));
    expect(dialog.textContent).not.toContain(t("allergens.pending", "en"));
  });

  it("clears the selection when the dialog closes itself (escape/backdrop)", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Sandwich").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    // The native <dialog> closing (escape/backdrop) surfaces as wt-close; the screen must sync its own
    // state, or the .open binding would immediately reopen the dialog.
    dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  });

  it("closing the detail dialog clears the selection", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Sandwich").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLElement>("wt-button.detail-close")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  });

  it("resolves a region locale to its language for allergen names (es-ES → Spanish)", async () => {
    // allergenName does an EXACT key match and only carries en/es, so allergenName("milk","es-ES")
    // would fall back to English — the screen must reduce "es-ES" → "es". Proven here.
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "es-ES",
    });
    const headers = [...el.shadowRoot!.querySelectorAll('th[scope="col"]')].map((h) =>
      h.textContent!.trim(),
    );
    expect(headers).toContain(ALLERGEN_NAMES.milk!.es); // "Leche", not "Milk"
  });

  it("Print re-renders in the invoice locale and hands off to the browser", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
        products,
        locale: "en",
        invoiceLocale: "es-ES",
      });
      // On-screen: the operator locale (English names).
      expect(el.shadowRoot!.textContent).toContain(allergenName("milk", "en")); // "Milk"
      el.shadowRoot!.querySelector<HTMLElement>("wt-button.print")!.click();
      await el.updateComplete;
      // Printed: the invoice locale (Spanish names) — mirrors till-ticket-view's invoiceLocale path.
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.textContent).toContain(ALLERGEN_NAMES.milk!.es); // "Leche"
    } finally {
      printSpy.mockRestore();
    }
  });

  it("Close emits a composed close-allergens event", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", { products });
    let captured: Event | undefined;
    el.addEventListener("close-allergens", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.close")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
  });

  it("keeps its local display order in step with the allergen-name table", () => {
    // The 14-code order is redefined locally (no @waitron/catalogue in the browser bundle); pin it to
    // Task 5's name table so a drift in either is caught without importing the catalogue.
    expect(ALLERGEN_DISPLAY_ORDER).toHaveLength(14);
    expect([...ALLERGEN_DISPLAY_ORDER].sort()).toEqual(Object.keys(ALLERGEN_NAMES).sort());
  });
});

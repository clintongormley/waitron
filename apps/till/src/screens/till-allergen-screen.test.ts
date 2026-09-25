import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillAllergenScreen, ALLERGEN_DISPLAY_ORDER } from "./till-allergen-screen.js";
import { ALLERGEN_NAMES, allergenName } from "../i18n/allergen-names.js";
import { t } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";

// A product whose allergens have NOT been reviewed — `null`. Renders "pending", never all-clear.
const coffee: TillProduct = {
  id: "coffee",
  name: "Café",
  customerName: { es: "Café para el cliente", en: "Coffee for the customer" },
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
};

// A reviewed product with NO declared allergens — `{}`. Distinct from `null`: reviewed/all-clear.
const water: TillProduct = {
  id: "water",
  name: "Agua",
  customerName: { es: "Agua para el cliente", en: "Water for the customer" },
  pricingUnit: "each",
  unitPrice: "1.00",
  vatClass: "general",
  category: null,
  allergens: {},
};

const products: TillProduct[] = [coffee, sandwich, water];

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

  it("renders one row per product, each named by the venue's own STAFF name", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    // `rowFor` matches the row-header text EXACTLY, and every fixture's English customer name
    // ("Coffee for the customer", …) differs from its staff name — so a screen that resolved the
    // customer map under this `locale: "en"` would find no row at all.
    expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(rowFor(el, "Café")).toBeDefined();
    expect(rowFor(el, "Bocadillo")).toBeDefined();
    expect(rowFor(el, "Agua")).toBeDefined();
  });

  it("marks a 'contains' cell distinctly from a 'may contain' cell", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const row = rowFor(el, "Bocadillo");
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
    rowFor(el, "Bocadillo").querySelector<HTMLElement>(".row-open")!.click();
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

  it("lists a product's declarations in ALLERGEN_DISPLAY_ORDER, not server key order", async () => {
    // Keys in REVERSE display order: the dialog must still list gluten first, matching the matrix.
    const wrap: TillProduct = {
      id: "wrap",
      name: "Wrap",
      customerName: { es: "Wrap para el cliente", en: "Wrap for the customer" },
      pricingUnit: "each",
      unitPrice: "3.50",
      vatClass: "reduced",
      category: null,
      allergens: {
        milk: { presence: "contains" },
        gluten: { presence: "may_contain", source: "barley" },
      },
    };
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products: [wrap],
      locale: "en",
    });
    rowFor(el, "Wrap").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const names = [...el.shadowRoot!.querySelectorAll("wt-dialog .detail-item .detail-name")].map(
      (n) => n.textContent!.trim(),
    );
    expect(names).toEqual([`${allergenName("gluten", "en")} (barley)`, allergenName("milk", "en")]);
  });

  it("renders allergens === null as the pending state, NOT an all-clear row", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    const row = rowFor(el, "Café");
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
    const row = rowFor(el, "Agua");
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
    rowFor(el, "Bocadillo").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.heading).toBe("Bocadillo");
  });

  it("a null product's detail dialog says pending, not a bare empty list", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Café").querySelector<HTMLElement>(".row-open")!.click();
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
    rowFor(el, "Agua").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain(t("allergens.notice", "en"));
    expect(dialog.textContent).not.toContain(t("allergens.pending", "en"));
  });

  it("shows vegan/vegetarian diet badges in a product's detail dialog when its diet asserts them", async () => {
    const salad: TillProduct = {
      ...water,
      id: "salad",
      name: "Ensalada",
      customerName: { es: "Ensalada para el cliente", en: "Salad for the customer" },
      diet: { vegan: "yes", vegetarian: "yes", contains: [] },
    };
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products: [salad],
      locale: "en",
    });
    rowFor(el, "Ensalada").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.querySelector("[data-diet='vegan']")).not.toBeNull();
    expect(dialog.querySelector("[data-diet='vegetarian']")).not.toBeNull();
    expect(dialog.textContent).toContain(t("diet.vegan", "en"));
  });

  it("shows the NEUTRAL 'not reviewed' diet state for a pending diet, never a positive claim", async () => {
    const special: TillProduct = {
      ...water,
      id: "special",
      name: "Especial",
      customerName: { es: "Especial para el cliente", en: "Special for the customer" },
      diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
    };
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products: [special],
      locale: "en",
    });
    rowFor(el, "Especial").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.querySelector("[data-diet-pending]")).not.toBeNull();
    expect(dialog.querySelector("[data-diet='vegan']")).toBeNull();
  });

  it("shows NO diet block for a product carrying no published diet (regression-safe)", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products, // coffee/sandwich/water — none carry a `diet`
      locale: "en",
    });
    rowFor(el, "Bocadillo").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.querySelector(".detail-diet")).toBeNull();
  });

  it("clears the selection when the dialog closes itself (escape/backdrop)", async () => {
    const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
      products,
      locale: "en",
    });
    rowFor(el, "Bocadillo").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    // The native <dialog> closing on Escape surfaces as wt-close; the screen must sync its own
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
    rowFor(el, "Bocadillo").querySelector<HTMLElement>(".row-open")!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLElement>("wt-button.detail-close")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  });

  it("resolves a region locale to its language for allergen names (es-ES → Spanish)", async () => {
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
      // Printed: the invoice locale (Spanish names).
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.textContent).toContain(ALLERGEN_NAMES.milk!.es); // "Leche"
    } finally {
      printSpy.mockRestore();
    }
  });

  it("names products by the CUSTOMER name when printing, and by the staff name on screen", async () => {
    // The printed sheet is a customer document (RD 126/2015 Art. 6.5.a.2° reaches consumers, not only
    // staff and inspectors), so a diner must be able to match a dish on the customer menu to a row
    // here. On screen the same matrix is an operator lookup and reads the venue's own name. Every
    // fixture's two names differ, so each half of this fails if the other resolver is used.
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
        products,
        locale: "en",
        invoiceLocale: "es-ES",
      });
      const rowNames = () =>
        [...el.shadowRoot!.querySelectorAll(".row-open")].map((n) => n.textContent!.trim());
      // On screen: the staff names.
      expect(rowNames()).toEqual(["Café", "Bocadillo", "Agua"]);
      el.shadowRoot!.querySelector<HTMLElement>("wt-button.print")!.click();
      await el.updateComplete;
      expect(printSpy).toHaveBeenCalledTimes(1);
      // Printed: the customer text, resolved in the INVOICE locale (es-ES → the `es` entry), not the
      // operator locale the screen was mounted with.
      expect(rowNames()).toEqual([
        "Café para el cliente",
        "Bocadillo para el cliente",
        "Agua para el cliente",
      ]);
    } finally {
      printSpy.mockRestore();
    }
  });

  it("names a printed product with its staff name when it has no customer text", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      const plain: TillProduct = { ...water, id: "plain", name: "Sin carta", customerName: null };
      const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
        products: [plain],
        locale: "en",
        invoiceLocale: "es-ES",
      });
      el.shadowRoot!.querySelector<HTMLElement>("wt-button.print")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".row-open")!.textContent!.trim()).toBe("Sin carta");
    } finally {
      printSpy.mockRestore();
    }
  });

  it("prints again on a second Print tap (the printing latch is reset)", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      const { el } = await mountWidget<TillAllergenScreen>("till-allergen-screen", {
        products,
        locale: "en",
        invoiceLocale: "es-ES",
      });
      el.shadowRoot!.querySelector<HTMLElement>("wt-button.print")!.click();
      await el.updateComplete;
      expect(printSpy).toHaveBeenCalledTimes(1);
      el.shadowRoot!.querySelector<HTMLElement>("wt-button.print")!.click();
      await el.updateComplete;
      expect(printSpy).toHaveBeenCalledTimes(2);
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
    // The list is redefined locally (no @waitron/catalogue in the browser bundle), so pin its code set to
    // the name table.
    expect(ALLERGEN_DISPLAY_ORDER).toHaveLength(14);
    expect([...ALLERGEN_DISPLAY_ORDER].sort()).toEqual(Object.keys(ALLERGEN_NAMES).sort());
  });
});

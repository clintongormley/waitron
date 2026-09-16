import { setContentLanguages } from "@waitron/ui";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillProductGrid } from "./product-grid.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  unit: {
    id: "unit-each",
    name: { es: "unidad" },
    abbreviation: { es: "ud" },
    precision: 0,
    hardwareUnit: null,
  },
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  unit: {
    id: "unit-kg",
    name: { es: "kg" },
    abbreviation: { es: "kg" },
    precision: 3,
    hardwareUnit: "kg",
  },
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe("till-product-grid", () => {
  it("refreshes the unit label when the configured fallback changes, and never the tile NAME", async () => {
    // The unit abbreviation is per-language content and still re-resolves. The tile name is the
    // venue's staff name — plain text — so the same change must leave it exactly where it was, even
    // though this product carries a customer name in BOTH of the languages configured here.
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "fr", languages: ["fr", "en"] });
    try {
      const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
        products: [
          {
            ...cafe,
            name: "Pain",
            customerName: { fr: "Baguette", en: "Bread" },
            unit: {
              id: "unit-each",
              name: { fr: "pièce", en: "each" },
              abbreviation: { fr: "pc", en: "ea" },
              precision: 0,
              hardwareUnit: null,
            },
          },
        ],
        store: new WorkingOrderStore(),
      });
      expect(el.shadowRoot!.querySelector(".name")!.textContent).toBe("Pain");
      expect(el.shadowRoot!.querySelector(".price")!.textContent).toContain("/pc");
      setContentLanguages({ defaultLanguage: "en", languages: ["en", "fr"] });
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".price")!.textContent).toContain("/ea");
      expect(el.shadowRoot!.querySelector(".name")!.textContent).toBe("Pain");
    } finally {
      setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    }
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-product-grid")).toBe(TillProductGrid);
  });

  it("renders one tile per product, each showing its name and price", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe, jamon],
      store,
    });
    const tiles = el.shadowRoot!.querySelectorAll("wt-button");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.textContent).toContain("Café");
    expect(tiles[0]!.textContent).toContain(formatMoney("1.50"));
  });

  it("appends the localized unit to a product's price", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [jamon],
      store,
    });
    const tile = el.shadowRoot!.querySelector("wt-button")!;
    expect(tile.textContent).toContain("Jamón");
    expect(tile.textContent).toContain(formatMoney("10.00"));
    expect(tile.textContent).toContain("/kg");
  });

  it("tapping a product without a hardware mapping rings up one of that product", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe],
      store,
    });
    el.shadowRoot!.querySelector("wt-button")!.click();
    expect(store.lines).toEqual([{ product: cafe, quantity: "1" }]);
  });

  it("tapping a hardware-mapped tile broadcasts product-selected without touching the basket", async () => {
    const store = new WorkingOrderStore();
    const seen: TillProduct[] = [];
    store.on("product-selected", (p) => seen.push(p as TillProduct));
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [jamon],
      store,
    });
    el.shadowRoot!.querySelector("wt-button")!.click();
    expect(seen).toEqual([jamon]);
    expect(store.lines).toHaveLength(0);
  });

  it("opens quantity entry for a fractional custom unit", async () => {
    const portion: TillProduct = {
      ...cafe,
      id: "portion",
      unit: {
        id: "custom-portion",
        name: { en: "portion" },
        abbreviation: { en: "pt" },
        precision: 2,
        hardwareUnit: null,
      },
    };
    const store = new WorkingOrderStore();
    const selected: TillProduct[] = [];
    store.on("product-selected", (product) => selected.push(product as TillProduct));
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [portion],
      store,
    });
    el.shadowRoot!.querySelector("wt-button")!.click();
    expect(selected).toEqual([portion]);
    expect(store.lines).toHaveLength(0);
  });

  it("does not infer scale behavior from an editable unit name", async () => {
    const namedKg: TillProduct = {
      ...cafe,
      id: "named-kg",
      unit: {
        id: "custom-kg",
        name: { es: "kg" },
        abbreviation: { es: "kg" },
        precision: 0,
        hardwareUnit: null,
      },
    };
    const store = new WorkingOrderStore();
    const selected: TillProduct[] = [];
    store.on("product-selected", (product) => selected.push(product as TillProduct));
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [namedKg],
      store,
    });
    el.shadowRoot!.querySelector("wt-button")!.click();
    expect(selected).toEqual([]);
    expect(store.lines).toEqual([{ product: namedKg, quantity: "1" }]);
  });

  it("fixes the grid to N equal columns when `columns` is set (product-grid.columns config)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe, jamon],
      store,
      columns: 4,
    });
    const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
    // An explicit column count overrides the responsive default with a fixed N-column track list.
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, 1fr)");
  });

  it("keeps the responsive auto-fill grid when `columns` is unset (no inline override)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe],
      store,
    });
    const grid = el.shadowRoot!.querySelector<HTMLElement>(".grid")!;
    // No inline grid-template-columns, so the stylesheet's repeat(auto-fill, minmax(9rem, 1fr)) governs.
    expect(grid.style.gridTemplateColumns).toBe("");
  });

  it("gives each tile an accessible name (its content)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe],
      store,
    });
    const tile = el.shadowRoot!.querySelector("wt-button")!;
    // A wt-button with no forwarded aria-label takes its accessible name from slotted text.
    expect(tile.textContent?.trim().length).toBeGreaterThan(0);
  });
});

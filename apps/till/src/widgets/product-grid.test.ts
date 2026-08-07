import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillProductGrid } from "./product-grid.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe("till-product-grid", () => {
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

  it("appends /kg to a weight product's price", async () => {
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

  it("tapping an each tile rings up one of that product", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe],
      store,
    });
    el.shadowRoot!.querySelector("wt-button")!.click();
    expect(store.lines).toEqual([{ product: cafe, quantity: "1" }]);
  });

  it("tapping a weight tile broadcasts product-selected without touching the basket", async () => {
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

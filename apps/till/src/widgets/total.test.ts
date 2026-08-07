import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTotal } from "./total.js";
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

afterEach(cleanupWidgets);

describe("till-total", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-total")).toBe(TillTotal);
  });

  it("shows the total label and the store's formatted total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTotal>("till-total", { store });
    expect(el.shadowRoot!.textContent).toContain(t("label.total"));
    expect(el.shadowRoot!.textContent).toContain(formatMoney("3.00"));
  });

  it("updates when the store changes after mount", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTotal>("till-total", { store });
    expect(el.shadowRoot!.textContent).toContain(formatMoney("0"));
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(formatMoney("3.00"));
  });

  it("unsubscribes on disconnect so a later change does not update it", async () => {
    const store = new WorkingOrderStore();
    const { el, host } = await mountWidget<TillTotal>("till-total", { store });
    expect(el.shadowRoot!.textContent).toContain(formatMoney("0"));
    host.remove(); // disconnectedCallback → unsubscribe
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(formatMoney("0"));
  });
});

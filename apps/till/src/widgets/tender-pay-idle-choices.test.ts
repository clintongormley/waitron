import { afterEach, expect, it, vi } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTenderPay } from "./tender-pay.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  unit: {
    id: "unit-each",
    name: { en: "unit", es: "unidad" },
    abbreviation: { en: "ea", es: "ud" },
    precision: 0,
    hardwareUnit: null,
  },
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const query = (el: TillTenderPay, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillTenderPay, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(cleanupWidgets);

it("sends the captured simulator outcome once the operator switches back from declined", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
    store,
    cardProvider: "simulator",
  });
  const collected = vi.fn();
  el.addEventListener("collect-card", (e) => collected((e as CustomEvent).detail));
  click(el, "[data-test=simulation-declined]");
  await el.updateComplete;
  click(el, "[data-test=simulation-captured]");
  await el.updateComplete;
  expect(query(el, "[data-test=simulation-captured]")!.getAttribute("aria-pressed")).toBe("true");
  expect(query(el, "[data-test=simulation-declined]")!.getAttribute("aria-pressed")).toBe("false");
  click(el, ".pay-card");
  expect(collected).toHaveBeenCalledWith({ simulationOutcome: "captured" });
});

it("Hold at the order stage of a pay-later flow opens the label prompt instead of placing", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
    store,
    mode: "invoice_first",
    stage: "order",
  });
  const placed = vi.fn();
  el.addEventListener("place-order", placed);
  click(el, ".hold");
  await el.updateComplete;
  expect(query(el, ".label-input")).not.toBeNull();
  expect(query(el, ".place")).toBeNull();
  expect(placed).not.toHaveBeenCalled();
});

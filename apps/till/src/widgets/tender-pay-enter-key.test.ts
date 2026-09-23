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

type Updatable = HTMLElement & { updateComplete: Promise<unknown> };

/** Types into a `wt-input`'s inner `<input>` and then presses Enter on that same native field, the
 *  node `submitOnEnter` reads off the composed path. */
async function typeAndPressEnter(el: TillTenderPay, selector: string, text: string) {
  const field = el.shadowRoot!.querySelector(selector) as Updatable;
  await field.updateComplete;
  const inner = field.shadowRoot!.querySelector("input")!;
  inner.value = text;
  inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  inner.dispatchEvent(enter);
  return enter;
}

const click = (el: TillTenderPay, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(cleanupWidgets);

it("Enter in the hold-label field parks the order under that label", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
  const parked = vi.fn();
  el.addEventListener("park-order", (e) => parked((e as CustomEvent).detail));
  click(el, ".hold");
  await el.updateComplete;
  const enter = await typeAndPressEnter(el, ".label-input", "Mesa 7");
  expect(parked).toHaveBeenCalledWith({ label: "Mesa 7" });
  expect(enter.defaultPrevented).toBe(true);
});

it("Enter in the card operation-number field confirms the card tender with that reference", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
  const confirmed = vi.fn();
  el.addEventListener("confirm-payment", (e) => confirmed((e as CustomEvent).detail));
  click(el, ".pay-card");
  await el.updateComplete;
  await typeAndPressEnter(el, ".ref-input", "OP-4471");
  expect(confirmed).toHaveBeenCalledWith({
    method: "card",
    amount: "1.50",
    externalRef: "OP-4471",
  });
});

it("Enter in the tip field starts the integrated card collection with that tip", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1");
  const { el } = await mountWidget<TillTenderPay>("till-tender-pay", {
    store,
    cardProvider: "stripe_terminal",
    tipsEnabled: true,
  });
  const collected = vi.fn();
  el.addEventListener("collect-card", (e) => collected((e as CustomEvent).detail));
  await typeAndPressEnter(el, ".tip-input", "0.75");
  expect(collected).toHaveBeenCalledWith({ tip: "0.75" });
});

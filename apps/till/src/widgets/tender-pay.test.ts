import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTenderPay } from "./tender-pay.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
};

/** Taps one keypad key inside the widget and lets the parent re-render with the new value. */
async function press(el: TillTenderPay, key: string): Promise<void> {
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await el.updateComplete;
}

/** Taps a string of keys in order — each character is a `data-key` on the pad. */
async function type(el: TillTenderPay, keys: string): Promise<void> {
  for (const key of keys) await press(el, key);
}

const query = (el: TillTenderPay, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillTenderPay, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(cleanupWidgets);

describe("till-tender-pay", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-tender-pay")).toBe(TillTenderPay);
  });

  it("disables Pay when the basket is empty", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.textContent).toContain(t("action.pay"));
  });

  it("enables Pay once a line is rung up, reacting to store changes", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(false);
  });

  it("opens the cash screen showing the total when Pay is tapped", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("label.total"));
    expect(el.shadowRoot!.textContent).toContain(formatMoney("3.00"));
    expect(el.shadowRoot!.textContent).toContain(t("tender.cash"));
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("shows the change once the tendered amount reaches the total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // tendered 5 → change 2.00
    expect(el.shadowRoot!.textContent).toContain(t("label.change"));
    expect(query(el, ".change")!.textContent).toContain(formatMoney("2.00"));
  });

  it("hides the change while the tender is short", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2"); // 2 < 3.00
    expect(query(el, ".change")).toBeNull();
  });

  it("disables Confirm while the tender is short and enables it at/above the total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2");
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(true);
    await press(el, "backspace"); // entry back to ""
    await type(el, "3"); // exactly the total
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(false);
  });

  it("emits confirm-payment with the full operator-entered tendered amount", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", (e) => spy((e as CustomEvent).detail));
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // tendered 5, not the 3.00 total
    click(el, ".confirm");
    expect(spy).toHaveBeenCalledWith({ method: "cash", amount: "5" });
  });

  it("does not emit confirm-payment for a short tender even if Confirm is force-clicked", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", () => spy());
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2"); // short
    click(el, ".confirm"); // disabled visually; host.click() bypasses that, the guard must not emit
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns to idle after a confirmed payment", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5");
    click(el, ".confirm");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull();
    expect(query(el, "till-numeric-pad")).toBeNull();
  });

  it("returns to idle from the cash screen when Cancel is tapped, emitting nothing", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", () => spy());
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // a tender is part-entered
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull(); // back to the idle Pay button
    expect(query(el, "till-numeric-pad")).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // Cancel never settles the sale
    expect(store.lines).toHaveLength(1); // basket untouched
  });

  it("returns to idle from the weigh screen when Cancel is tapped, adding no line", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await type(el, "0.320");
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt"));
    expect(store.lines).toHaveLength(0); // the weighed product was not rung up
  });

  it("prompts for kg when a weight product is selected", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("weigh.prompt"));
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("ignores a non-weight product selection", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", cafe); // an `each` product never weighs
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt"));
    expect(query(el, ".pay")).not.toBeNull(); // still idle
  });

  it("adds a weight line via the store and returns to idle", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await type(el, "0.320");
    click(el, ".add");
    await el.updateComplete;
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(jamon);
    expect(store.lines[0]!.quantity).toBe("0.320");
    expect(query(el, ".pay")).not.toBeNull();
  });

  it("disables Add and refuses a zero or empty weight", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(query(el, ".add")!.hasAttribute("disabled")).toBe(true); // empty
    click(el, ".add"); // force-click the disabled Add: the guard must no-op
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    await type(el, "0"); // an explicit zero is still non-positive
    expect(query(el, ".add")!.hasAttribute("disabled")).toBe(true);
    click(el, ".add");
    expect(store.lines).toHaveLength(0);
  });

  it("stops reacting to the store after disconnect", async () => {
    const store = new WorkingOrderStore();
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    host.remove(); // disconnectedCallback → both subscriptions disposed
    store.addProduct(cafe, "1");
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(true); // never heard the add
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt")); // never heard the pick
  });
});

import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillTenderPay } from "./tender-pay.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./tender-pay.js";

const dish: TillProduct = {
  id: "coffee",
  name: "Staff coffee",
  unitPrice: "1.50",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};
afterEach(cleanupWidgets);
async function opening() {
  const store = new WorkingOrderStore();
  store.addProduct(dish, "1");
  return { store, ...(await mountWidget<TillTenderPay>("till-tender-pay", { store })) };
}
it.each(["busy", "empty", "disconnected"] as const)(
  "A738 a late Park entry waits while %s and works after recovery",
  async (kind) => {
    const { el, host, store } = await opening();
    const old = el.shadowRoot!.querySelector<HTMLElement>(".hold")!;
    const parks: unknown[] = [];
    el.addEventListener("park-order", (e) => parks.push((e as CustomEvent).detail));
    if (kind === "busy") el.busy = true;
    else if (kind === "empty") store.removeLine(0);
    else el.remove();
    old.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await el.updateComplete;
    const closed = el.shadowRoot!.querySelector("wt-dialog")!;
    await closed.updateComplete;
    expect(closed.open).toBe(false);
    expect(closed.shadowRoot!.querySelector("dialog")!.open).toBe(false);
    expect(parks).toEqual([]);
    if (kind === "busy") el.busy = false;
    else if (kind === "empty") store.addProduct(dish, "1");
    else host.append(el);
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".hold")!);
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog");
    expect(dialog).not.toBeNull();
    await dialog!.updateComplete;
    expect(dialog!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(parks).toEqual([]);
    expect(store.lines.map((line) => line.quantity)).toEqual(["1"]);
  },
);
it("A738 a retained idle Park control cannot restart an open name draft", async () => {
  const { el } = await opening();
  const old = el.shadowRoot!.querySelector<HTMLElement>(".hold")!;
  await userEvent.click(old);
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, "Guest counter");
  old.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(field.value).toBe("Guest counter");
  expect(field.shadowRoot!.querySelector("input")!.value).toBe("Guest counter");
  expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
});

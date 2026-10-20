import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { CounterWaitingOrder, TillProduct } from "../api/client.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import "./till-counter-screen.js";

const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const dish: TillProduct = {
  id: "croquetas",
  catalogueId: "lunch",
  name: "Croquetas",
  customerName: { es: "Croquetas del cliente" },
  pricingUnit: "each",
  unitPrice: "7.80",
  vatClass: "general",
  category: null,
  allergens: null,
};

const waiting: CounterWaitingOrder = {
  items: [],
  id: "waiting-11",
  orderNumber: 11,
  label: "Ana",
  status: "settled",
  openedAt: "2026-10-16T10:00:00.000Z",
  settledAt: "2026-10-16T10:01:00.000Z",
  collectedAt: null,
  total: "7.80",
  canHandOver: true,
  serviceMode: null,
  movableDishes: [],
};

function mount(over: Partial<TillCounterScreen> = {}) {
  setLocale("es-ES");
  const store = new WorkingOrderStore();
  store.addProduct(dish, "1");
  return mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    embedded: true,
    products: [dish],
    menus: servedMenus([{ id: "lunch", name: "Lunch", isDefault: true, versionId: "v1" }], []),
    ...over,
  });
}

it("renders menu, basket, total and payment without an authored layout", async () => {
  const { el } = await mount();
  expect(el.shadowRoot!.querySelector("till-menu-browser")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-basket")).not.toBeNull();
  const total = el.shadowRoot!.querySelector("till-total");
  expect(total).not.toBeNull();
  await total!.updateComplete;
  expect(total!.shadowRoot!.textContent).toContain("7,80");
  expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
});

it("shows a waiting order when no order is held, and removes the lists when both are empty", async () => {
  const { el } = await mount({ counterWaiting: [waiting], orderList: "waiting" });
  const list = el.shadowRoot!.querySelector("till-counter-waiting");
  expect(list).not.toBeNull();
  await list!.updateComplete;
  expect(
    list!.shadowRoot!.querySelector('[data-waiting-order="waiting-11"]')!.textContent,
  ).toContain("Ana");
  el.counterWaiting = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-counter-waiting")).toBeNull();
  expect(el.shadowRoot!.querySelector("till-held-orders")).toBeNull();
});

it("keeps the take-rest action amount and blocks it while its request is busy", async () => {
  const { el } = await mount({ payRest: "7.80" });
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-pay-rest]");
  expect(button).not.toBeNull();
  const seen = vi.fn();
  el.addEventListener("counter-bill-pay", seen);
  await userEvent.click(page.elementLocator(button!));
  expect(seen).toHaveBeenCalledOnce();
  expect(seen.mock.calls[0]![0].detail).toEqual({ amount: "7.80" });
  expect(seen.mock.calls[0]![0].bubbles).toBe(true);
  expect(seen.mock.calls[0]![0].composed).toBe(true);
  el.busy = true;
  await el.updateComplete;
  await (button as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(button!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});

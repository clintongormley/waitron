import { afterEach, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { CounterWaitingOrder } from "../api/orders-api.js";
import type { TillProduct } from "../api/menu-api.js";
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
  menuId: "lunch",
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
  readyAt: null,
  zoneId: "zone-counter",
  collectedAt: null,
  total: "7.80",
  counts: { ordered: 1, unsent: 0, held: 0, waiting: 0, ready: 0 },
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
  const { el } = await mount({
    store: new WorkingOrderStore(),
    counterWaiting: [waiting],
    selectedServiceZoneId: waiting.zoneId!,
    counterFloor: true,
  });
  const floor = el.shadowRoot!.querySelector("till-counter-floor")!.shadowRoot!;
  const list = floor.querySelector("till-counter-waiting");
  expect(list).not.toBeNull();
  await list!.updateComplete;
  expect(
    list!.shadowRoot!.querySelector('[data-waiting-order="waiting-11"]')!.textContent,
  ).toContain("Ana");
  el.counterWaiting = [];
  await el.updateComplete;
  expect(floor.querySelector("till-counter-waiting")).toBeNull();
  expect(floor.querySelector("till-held-orders")).toBeNull();
});

it("shows the remaining amount and blocks Pay while its request is busy", async () => {
  const { el } = await mount({ payRest: "7.80" });
  const tender = el.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  const button = tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]");
  expect(el.shadowRoot!.querySelector("[data-counter-bill-payments]")!.textContent).toContain(
    "7,80",
  );
  expect(button).not.toBeNull();
  const seen = vi.fn();
  el.addEventListener("counter-bill-pay", seen);
  await userEvent.click(page.elementLocator(button!));
  expect(seen).toHaveBeenCalledOnce();
  expect(seen.mock.calls[0]![0].detail).toEqual({});
  expect(seen.mock.calls[0]![0].bubbles).toBe(true);
  expect(seen.mock.calls[0]![0].composed).toBe(true);
  el.busy = true;
  await el.updateComplete;
  await (button as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(button!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});

it.each([
  ["its bill balance could not be read", null],
  ["its bill balance says it is not", { total: "90.00", overpaid: "0.00" }],
] as const)(
  "an order the held list says is overpaid offers Pay and nothing negative to pay when %s",
  async (_case, overpaidBalance) => {
    const { el } = await mount({ payRest: "-5.00", overpaidBalance });
    const tender = el.shadowRoot!.querySelector("till-tender-pay")!;
    await tender.updateComplete;

    expect(el.shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-counter-bill-payments]")!.textContent!.trim()).toBe(
      `${formatMoney("0.00", currentLocale())} por pagar`,
    );
    expect(tender.shadowRoot!.querySelector("[data-counter-pay]")).not.toBeNull();
  },
);

it("opens one Counter Pay window and keeps Park beside it", async () => {
  const { el } = await mount();
  const tender = el.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  const pay = tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]");
  expect(pay).not.toBeNull();
  expect(tender.shadowRoot!.querySelector(".pay-card")).toBeNull();
  expect(tender.shadowRoot!.querySelector(".pay")).toBeNull();
  expect(tender.shadowRoot!.querySelector(".hold")).not.toBeNull();
  const seen = vi.fn();
  el.addEventListener("counter-bill-pay", seen);
  await userEvent.click(page.elementLocator(pay!));
  expect(seen.mock.calls[0]![0].detail).toEqual({});
});

it("passes the separate-machine capability to a counter collecting with a reader", async () => {
  const { el } = await mount({
    cardProvider: "sumup_cloud",
    takesManualCard: true,
    stage: "collect",
    orderFlow: "ticket_then_pay",
  });
  const tender = el.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  expect(tender.shadowRoot!.querySelector(".pay-manual-card")).not.toBeNull();
  el.takesManualCard = false;
  await el.updateComplete;
  await tender.updateComplete;
  expect(tender.shadowRoot!.querySelector(".pay-manual-card")).toBeNull();
});

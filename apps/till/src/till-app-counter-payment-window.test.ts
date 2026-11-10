import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillApp } from "./till-app.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import {
  balanceOf,
  cash,
  dialog,
  emit,
  flush,
  line,
  lock,
  press,
  resetBillPayDrafts,
  stubApi,
  takenOf,
  invoiceOf,
  inDialog,
  type,
} from "../test/bill-pay-app.js";

const product = {
  id: "meal",
  menuItemId: "offer-meal",
  catalogueId: "cat-default",
  name: "Lunch",
  pricingUnit: "each" as const,
  unitPrice: "30.00",
  vatClass: "general" as const,
  category: null,
  allergens: null,
};

beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);

it("persists the first Counter payment before opening the window, then offers the remaining tender", async () => {
  let finishSave!: () => void;
  const saved = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  let id = "";
  const parkOrder = vi.fn(async (request: { id: string }) => {
    id = request.id;
    await saved;
    return { id, orderNumber: 7 };
  });
  const retrieveWorkingOrder = vi.fn(async () => ({
    id,
    orderNumber: 7,
    revision: 0,
    label: null,
    expectedEdit: null,
    kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
    lines: [{ workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product }],
  }));
  const api = stubApi({
    parkOrder,
    retrieveWorkingOrder,
    getTabLines: vi.fn().mockResolvedValue({
      revision: 0,
      lines: [line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" })],
    }),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, total: "30.00", outstanding: "30.00" }),
    ),
    previewBillPayment: vi.fn().mockResolvedValue(cash("10.00", "10.00")),
    takeBillPayment: vi.fn(async () =>
      takenOf(
        { applied: "10.00", tendered: "20.00", change: "10.00" },
        { workingOrderId: id, total: "30.00", received: "10.00", outstanding: "20.00" },
      ),
    ),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(product, "1");
  await flush(el);
  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await flush(el);
  expect(parkOrder).toHaveBeenCalledTimes(1);
  expect(dialog(el)).toBeNull();
  finishSave();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);
  expect(retrieveWorkingOrder).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(dialog(el)!.way).toBe("whole");
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>('[name="way"][value="contribution"]')!.click();
  await flush(el);
  await type(el, "amount", "10");
  await type(el, "tendered", "20");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  expect(api.takeBillPayment).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      kind: "contribution",
      amount: "10",
      tendered: "20",
      applied: "10.00",
    }),
    expect.anything(),
  );
  expect(dialog(el)!.balance).toMatchObject({ received: "10.00", outstanding: "20.00" });
  expect(dialog(el)!.shadowRoot!.querySelector("[data-pay-taken]")?.textContent).toContain("10.00");
  expect(dialog(el)!.shadowRoot!.querySelector('[name="method"][value="cash"]')).not.toBeNull();
  expect(dialog(el)!.shadowRoot!.querySelector('[name="method"][value="card"]')).not.toBeNull();
  vi.mocked(api.previewBillPayment).mockResolvedValue(cash("20.00", "0.00"));
  vi.mocked(api.takeBillPayment).mockResolvedValue(
    takenOf(
      { applied: "20.00", tendered: "20.00", change: "0.00" },
      {
        workingOrderId: id,
        total: "30.00",
        received: "30.00",
        outstanding: "0.00",
        status: "settled",
      },
      invoiceOf("30.00"),
    ),
  );
  await type(el, "amount", "20");
  await type(el, "tendered", "20");
  await press(el, "[data-pay-continue]");
  const guests = inDialog(el, '[name="guests"]') as NonNullable<ReturnType<typeof inDialog>> & {
    updateComplete: Promise<unknown>;
  };
  await guests.updateComplete;
  const input = guests.shadowRoot!.querySelector("input")!;
  input.value = "2";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await flush(el);
  await press(el, "[data-pay-confirm]");
  expect(vi.mocked(api.takeBillPayment).mock.calls[1]![1]).toMatchObject({
    amount: "20",
    guestCount: 2,
  });
  expect(dialog(el)).toBeNull();
});

it.each([undefined, "F1/7"])(
  "a placed Counter bill offers parts only before invoicing (%s)",
  async (invoiceNumber) => {
    const id = "placed-order";
    const api = stubApi({
      listCounterWaiting: vi.fn().mockResolvedValue([
        {
          id,
          items: [],
          orderNumber: 7,
          label: null,
          status: "placed",
          total: "30.00",
          openedAt: "2026-11-10T10:00:00Z",
          settledAt: null,
          collectedAt: null,
          serviceMode: "ticket_then_pay",
          counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
          canHandOver: false,
          movableDishes: [],
          invoiceNumber,
        },
      ]),
      retrievePlacedOrder: vi.fn().mockResolvedValue({
        id,
        orderNumber: 7,
        revision: 0,
        label: null,
        expectedEdit: null,
        kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
        lines: [
          { workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product },
        ],
      }),
      getTabLines: vi.fn().mockResolvedValue({
        revision: 0,
        lines: [line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" })],
      }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
    await flush(el);
    let counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    emit(counter, "pay-waiting-order", { id });
    await flush(el, 6);
    counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
    await tender.updateComplete;
    expect(tender.shadowRoot!.querySelector("[data-counter-pay]") !== null).toBe(
      invoiceNumber === undefined,
    );
    expect(tender.shadowRoot!.querySelector(".pay-card") !== null).toBe(
      invoiceNumber !== undefined,
    );
  },
);

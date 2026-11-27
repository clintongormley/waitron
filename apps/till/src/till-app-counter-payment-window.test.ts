import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import { deviceZonesFixture } from "../test/device-zones.js";
import { TillApp } from "./till-app.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import type { TillProduct, ZoneOffers } from "./api/menu-api.js";
import { quantityLabel } from "./state/order-line.js";
import { setLocale, t } from "./i18n/t.js";
import {
  answerOwnReceipt,
  balanceOf,
  choosePayWay,
  money,
  text,
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
  offers,
  till,
  type,
} from "../test/bill-pay-app.js";

const product = {
  id: "meal",
  menuItemId: "offer-meal",
  menuId: "cat-default",
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

async function enterCash(el: TillApp, tendered: string): Promise<void> {
  await expect.poll(() => inDialog(el, "[data-quiet-pay-cash]")?.disabled).toBe(false);
  await type(el, "tendered", tendered);
}

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
    zoneId: null,
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
  const pay =
    tender.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-counter-pay]")!;
  expect(pay.loading).toBe(true);
  expect(pay.variant).toBe("primary");
  expect(dialog(el)).toBeNull();
  finishSave();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);
  expect(retrieveWorkingOrder).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(dialog(el)!.way).toBe("whole");
  expect(inDialog(el, "wt-full-screen-panel[data-quiet-pay]")).not.toBeNull();
  expect(inDialog(el, "wt-top-bar")).toHaveProperty("backLabel", "Counter · z1");
  await choosePayWay(el, "contribution");
  await type(el, "amount", "10");
  const receipt = () => inDialog(el, "[data-pay-own-receipt]");
  await expect.poll(() => text(receipt())).toContain("No, include it on the final receipt");
  expect(inDialog(el, "[data-quiet-pay-cash]")?.disabled).toBe(true);
  await answerOwnReceipt(el, "no");
  await enterCash(el, "20");
  await press(el, "[data-pay-continue]");
  expect(text(inDialog(el, "[data-pay-change]"))).toContain(money("10.00"));
  expect(api.takeBillPayment).not.toHaveBeenCalled();
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
  expect(inDialog(el, '[name="guests"]')).toBeNull();
  await press(el, "[data-pay-confirm]");
  const finalPayment = vi.mocked(api.takeBillPayment).mock.calls[1]![1];
  expect(finalPayment).toMatchObject({ amount: "20" });
  expect(finalPayment).not.toHaveProperty("guestCount");
  expect(dialog(el)).toBeNull();
});

it("asks for the full-invoice recipient before saving or quoting a Counter order over the limit", async () => {
  const api = stubApi({
    getTill: vi
      .fn()
      .mockResolvedValue({ ...till, fullInvoices: true, simplifiedInvoiceLimit: "20.00" }),
    parkOrder: vi.fn(),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.loadFrom("large", [{ product, quantity: "1" }]);
  await flush(el);
  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).not.toBeNull();
  expect(dialog(el)).toBeNull();
  expect(api.parkOrder).not.toHaveBeenCalled();
  expect(api.previewBillPayment).not.toHaveBeenCalled();
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
        zoneId: null,
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

it("a sent Counter order whose own mode takes payment first shows Items barred in its Pay window, with the reason", async () => {
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
        serviceMode: "prepay",
        counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
        canHandOver: false,
        movableDishes: [],
      },
    ]),
    retrievePlacedOrder: vi.fn().mockResolvedValue({
      zoneId: null,
      serviceMode: "prepay",
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
    getBillBalance: vi
      .fn()
      .mockResolvedValue(
        balanceOf({ workingOrderId: id, status: "placed", total: "30.00", outstanding: "30.00" }),
      ),
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
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);

  const ways = [
    ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-choice-tile"]>(
      "[data-quiet-pay-way]",
    ),
  ];
  expect(ways.map((tile) => [tile.dataset.quietPayWay, tile.disabled])).toEqual([
    ["whole", false],
    ["share", false],
    ["items", true],
    ["contribution", false],
  ]);
  ways[2]!.click();
  await flush(el);
  expect(ways.map((tile) => tile.selected)).toEqual([true, false, false, false]);
  expect(dialog(el)!.shadowRoot!.querySelector("[data-pay-lines]")).toBeNull();
  expect(
    dialog(el)!.shadowRoot!.querySelector("[data-pay-items-reason]")?.textContent?.trim(),
  ).toBe(
    "A Counter order in a zone paid before preparation is paid with An amount, Split equally or Whole bill.",
  );
  const root = dialog(el)!.shadowRoot!;
  const reason = root.querySelector("[data-pay-items-reason]");
  expect(
    root.getElementById(root.querySelector("[data-pay-way]")!.getAttribute("aria-describedby")!),
  ).toBe(reason);
});

it.each(["en", "es"] as const)(
  "each barred-Items reason in %s names the window's other choices as they are labelled",
  (locale) => {
    setLocale(locale);
    for (const key of [
      "bill_pay.items_barred_moved_to_table",
      "bill_pay.items_barred_counter_receipt",
      "bill_pay.items_barred_counter_prepay",
    ] as const)
      for (const way of ["way_contribution", "way_share", "way_whole"] as const)
        expect(t(key)).toContain(t(`bill_pay.${way}`));
  },
);

it("a Counter order just sent offers Items, and paying them keeps the Counter on the order showing what is left", async () => {
  let id = "";
  let sent = false;
  let paid = false;
  const lunch = line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" });
  const beer = line({ id: "dish-2", lineNo: 2, name: "Beer", unitPriceGross: "5.00" });
  const edit = { editorVersion: 2, draftId: null, draftRevision: null };
  const left = () =>
    balanceOf({ workingOrderId: id, status: "placed", total: "5.00", outstanding: "5.00" });
  const placedOrder = () => ({
    zoneId: null,
    serviceMode: "ticket_then_pay",
    id,
    orderNumber: 7,
    revision: paid ? 1 : 0,
    label: null,
    expectedEdit: null,
    kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
    lines: (paid
      ? []
      : [{ workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product }]
    ).concat([
      { workingOrderLineId: "dish-2", menuItemId: "offer-meal", quantity: "1.000", product },
    ]),
  });
  const payForItems = vi.fn(async () => {
    paid = true;
    return {
      billId: "wo-paid",
      payment: takenOf(
        { applied: "30.00", tendered: "50.00", change: "20.00" },
        {
          workingOrderId: "wo-paid",
          status: "settled",
          total: "30.00",
          received: "30.00",
          outstanding: "0.00",
        },
        invoiceOf("30.00"),
      ),
      sourceBalance: left(),
    };
  });
  const api = stubApi({
    parkOrder: vi.fn(async (request: { id: string }) => {
      id = request.id;
      return { id, orderNumber: 7, serviceMode: "ticket_then_pay" };
    }),
    getKitchenNote: vi.fn(async () => ({
      scope: { workingOrderId: id },
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    // The order is waiting for collection once sent, which is when the counter's Pay opens the window.
    listCounterWaiting: vi.fn(async () =>
      sent
        ? [
            {
              id,
              items: [],
              orderNumber: 7,
              label: null,
              status: "placed",
              total: paid ? "5.00" : "35.00",
              openedAt: "2026-11-10T10:00:00Z",
              settledAt: null,
              collectedAt: null,
              serviceMode: "ticket_then_pay",
              counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
              canHandOver: false,
              movableDishes: [],
            },
          ]
        : [],
    ),
    placeOrder: vi.fn(async () => {
      sent = true;
      return { id, status: "placed" };
    }),
    retrievePlacedOrder: vi.fn(async () => placedOrder()),
    getFindBill: vi.fn(async () => ({
      workingOrderId: id,
      partyId: null,
      edit: { ...edit, billId: id, editorId: null, editorName: null },
    })),
    getTabLines: vi.fn(async () => ({
      revision: paid ? 1 : 0,
      lines: paid ? [beer] : [lunch, beer],
    })),
    getBillBalance: vi.fn(async () =>
      paid
        ? left()
        : balanceOf({
            workingOrderId: id,
            status: sent ? "placed" : "open",
            total: "35.00",
            outstanding: "35.00",
          }),
    ),
    previewItemPayment: vi
      .fn()
      .mockResolvedValue({ total: "30.00", applied: "30.00", tip: "0.00", change: "20.00" }),
    payForItems,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(product, "1");
  await flush(el);
  emit(counter, "place-order");
  await flush(el, 6);
  expect(api.placeOrder).toHaveBeenCalledWith(id, null);
  expect(counter.stage).toBe("collect");
  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);

  const items = dialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-choice-tile"]>(
    '[data-quiet-pay-way="items"]',
  )!;
  expect(items.disabled).toBe(false);
  expect(dialog(el)!.shadowRoot!.querySelector("[data-pay-items-reason]")).toBeNull();
  await choosePayWay(el, "items");
  await press(el, 'input[name="line"][value="1"]');
  await enterCash(el, "50");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await flush(el, 6);

  expect(payForItems).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ picks: [{ lineId: "dish-1" }], method: "cash", applied: "30.00" }),
    expect.anything(),
  );
  expect(api.takeBillPayment).not.toHaveBeenCalled();
  expect(counter.stage).toBe("collect");
  expect(counter.store.id).toBe(id);
  expect(dialog(el)!.balance).toEqual(left());
  expect(dialog(el)!.lines.map((row) => row.lineId)).toEqual(["dish-2"]);
});

it("an unsent Counter order offers Items in its Pay window, with no reason", async () => {
  let id = "";
  const api = stubApi({
    parkOrder: vi.fn(async (request: { id: string }) => {
      id = request.id;
      return { id, orderNumber: 7 };
    }),
    retrieveWorkingOrder: vi.fn(async () => ({
      zoneId: null,
      id,
      orderNumber: 7,
      revision: 0,
      label: null,
      expectedEdit: null,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: [
        { workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product },
      ],
    })),
    getTabLines: vi.fn().mockResolvedValue({
      revision: 0,
      lines: [line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" })],
    }),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, total: "30.00", outstanding: "30.00" }),
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
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);

  const items = dialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-choice-tile"]>(
    '[data-quiet-pay-way="items"]',
  )!;
  expect(items.disabled).toBe(false);
  expect(dialog(el)!.shadowRoot!.querySelector("[data-pay-items-reason]")).toBeNull();
  items.click();
  await flush(el);
  expect(dialog(el)!.shadowRoot!.querySelector("[data-pay-lines]")).not.toBeNull();
});

it("a sent Counter order in a mode that takes payment first shows Items barred in its Pay window before its balance is read", async () => {
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
        serviceMode: "prepay",
        counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
        canHandOver: false,
        movableDishes: [],
      },
    ]),
    retrievePlacedOrder: vi.fn().mockResolvedValue({
      zoneId: null,
      serviceMode: "prepay",
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
    getBillBalance: vi.fn(() => new Promise(() => {})),
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
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);

  expect(dialog(el)!.balance).toBeNull();
  const items = dialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-choice-tile"]>(
    '[data-quiet-pay-way="items"]',
  )!;
  expect(items.disabled).toBe(true);
  expect(
    dialog(el)!.shadowRoot!.querySelector("[data-pay-items-reason]")?.textContent?.trim(),
  ).toBe(t("bill_pay.items_barred_counter_prepay"));
  expect(api.retrievePlacedOrder).toHaveBeenCalledOnce();
  expect(api.getTabLines).toHaveBeenCalledOnce();
});

it.each([
  ["sent to the kitchen", true],
  ["not sent", false],
])(
  "a parked Counter order whose dish quantity changed after its Pay window closed, %s, lists the new quantity in Items",
  async (_, sendFirst) => {
    const id = "wo-1";
    let quantity = "1.000";
    let revision = 0;
    let sent = false;
    const stored = (status: "open" | "placed") => ({
      zoneId: null,
      serviceMode: "ticket_then_pay",
      id,
      orderNumber: 7,
      revision,
      label: null,
      expectedEdit: null,
      status,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: [{ workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity, product }],
    });
    const api = stubApi({
      listWorkingOrders: vi.fn(async () =>
        sent
          ? []
          : [
              {
                zoneId: null,
                items: [],
                id,
                orderNumber: 7,
                label: null,
                counts: { ordered: 1, unsent: 1, held: 0, waiting: 0, ready: 0 },
                total: "30.00",
                outstanding: "30.00",
                hasPayments: false,
                partyId: null,
                billNumber: null,
                billName: null,
                openedAt: "2026-11-10T10:00:00Z",
                signals: [],
                serviceMode: "ticket_then_pay",
              },
            ],
      ),
      listCounterWaiting: vi.fn(async () =>
        sent
          ? [
              {
                id,
                items: [],
                orderNumber: 7,
                label: null,
                status: "placed",
                total: "60.00",
                openedAt: "2026-11-10T10:00:00Z",
                settledAt: null,
                collectedAt: null,
                serviceMode: "ticket_then_pay",
                counts: { ordered: 2, unsent: 0, held: 0, waiting: 2, ready: 0 },
                canHandOver: false,
                movableDishes: [],
              },
            ]
          : [],
      ),
      retrieveWorkingOrder: vi.fn(async () => stored("open")),
      retrievePlacedOrder: vi.fn(async () => stored("placed")),
      getTabLines: vi.fn(async () => ({
        revision,
        lines: [
          line({
            id: "dish-1",
            lineNo: 1,
            name: "Lunch",
            quantity,
            unitPriceGross: "30.00",
            ...(sent ? {} : { sentAt: null, firedAt: null, state: null }),
          }),
        ],
      })),
      updateWorkingOrder: vi.fn(async (_id: string, body: { lines: { quantity: string }[] }) => {
        quantity = Number(body.lines[0]!.quantity).toFixed(3);
        revision += 1;
        return { revision };
      }),
      placeOrder: vi.fn(async () => {
        sent = true;
        return { id, status: "placed" };
      }),
      getBillBalance: vi.fn(async () =>
        balanceOf({
          workingOrderId: id,
          status: sent ? "placed" : "open",
          total: quantity === "1.000" ? "30.00" : "60.00",
          outstanding: quantity === "1.000" ? "30.00" : "60.00",
        }),
      ),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
    await flush(el);
    const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    emit(counter, "retrieve-order", { id });
    await flush(el, 6);
    const pay = async () => {
      const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
      await tender.updateComplete;
      tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      await flush(el);
    };
    await pay();
    expect(dialog(el)!.lines.map((row) => [row.lineId, row.quantity])).toEqual([["dish-1", "1"]]);
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    expect(dialog(el)).toBeNull();

    counter.store.setLineQuantity(0, "2");
    await flush(el);
    if (sendFirst) {
      emit(counter, "place-order");
      await flush(el, 6);
      expect(api.placeOrder).toHaveBeenCalledWith(id, null);
      expect(counter.stage).toBe("collect");
    }
    await pay();

    expect(dialog(el)!.lines.map((row) => [row.lineId, row.quantity])).toEqual([["dish-1", "2"]]);
    expect(api.getTabLines).toHaveBeenCalledTimes(2);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(api.retrievePlacedOrder).not.toHaveBeenCalled();
  },
);

it("a parked Counter order with an invoice choice reads its dishes once across two Pay windows", async () => {
  const id = "wo-1";
  let choiceRevision = 0;
  const api = stubApi({
    getTill: vi
      .fn()
      .mockResolvedValue({ ...till, orderFlow: "ticket_then_pay", fullInvoices: true }),
    getInvoiceDeliveryOptions: vi.fn().mockResolvedValue({ invoicePrinter: null }),
    retrieveWorkingOrder: vi.fn(async () => ({
      zoneId: null,
      serviceMode: "ticket_then_pay",
      id,
      orderNumber: 7,
      revision: 0,
      label: null,
      expectedEdit: null,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: [
        { workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product },
      ],
    })),
    getTabLines: vi.fn().mockResolvedValue({
      revision: 0,
      lines: [
        line({
          id: "dish-1",
          lineNo: 1,
          name: "Lunch",
          unitPriceGross: "30.00",
          sentAt: null,
          firedAt: null,
        }),
      ],
    }),
    setOrderInvoiceChoice: vi.fn(async () => ({ revision: ++choiceRevision })),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, total: "30.00", outstanding: "30.00" }),
    ),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  emit(counter, "retrieve-order", { id });
  await flush(el, 6);
  emit(counter, "choose-invoice");
  await flush(el);
  emit(
    el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
    "invoice-recipient-confirm",
    {
      delivery: { medium: "receipt" },
      recipient: {
        countryCode: "ES",
        address: "1 Main Street",
        legalName: "Example Guest",
        taxId: "12345678Z",
      },
      invoiceType: "F1",
    },
  );
  await flush(el);
  for (let press = 0; press < 2; press++) {
    const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
    await tender.updateComplete;
    tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await flush(el);
    expect(dialog(el)!.lines.map((row) => row.lineId)).toEqual(["dish-1"]);
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
  }

  expect(api.setOrderInvoiceChoice).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.setOrderInvoiceChoice).mock.calls[1]![1]).toMatchObject({ revision: 1 });
  expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
  expect(api.getTabLines).toHaveBeenCalledOnce();
});

it("a Counter order sent after another order was parked lists its own dishes in Items, not the parked one's", async () => {
  let id = "";
  let sent = false;
  const stored = (orderId: string, lineId: string) => ({
    zoneId: null,
    serviceMode: "ticket_then_pay",
    id: orderId,
    orderNumber: orderId === "wo-1" ? 5 : 7,
    revision: 0,
    label: null,
    expectedEdit: null,
    kitchenNote: { scope: { workingOrderId: orderId }, note: null, revision: 0, ownerRevision: 0 },
    lines: [{ workingOrderLineId: lineId, menuItemId: "offer-meal", quantity: "1.000", product }],
  });
  const api = stubApi({
    retrieveWorkingOrder: vi.fn(async () => stored("wo-1", "parked-dish")),
    parkOrder: vi.fn(async (request: { id: string }) => {
      id = request.id;
      return { id, orderNumber: 7, serviceMode: "ticket_then_pay" };
    }),
    getKitchenNote: vi.fn(async () => ({
      scope: { workingOrderId: id },
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    listCounterWaiting: vi.fn(async () =>
      sent
        ? [
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
            },
          ]
        : [],
    ),
    placeOrder: vi.fn(async () => {
      sent = true;
      return { id, status: "placed" };
    }),
    retrievePlacedOrder: vi.fn(async () => stored(id, "sent-dish")),
    getTabLines: vi.fn(async (orderId: string) => ({
      revision: 0,
      lines: [
        line({
          id: orderId === "wo-1" ? "parked-dish" : "sent-dish",
          lineNo: 1,
          name: "Lunch",
          unitPriceGross: "30.00",
        }),
      ],
    })),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, status: "placed", total: "30.00", outstanding: "30.00" }),
    ),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  emit(counter, "retrieve-order", { id: "wo-1" });
  await flush(el, 6);
  expect(counter.store.id).toBe("wo-1");
  emit(counter, "park-order", { label: counter.store.label });
  await flush(el, 6);
  expect(counter.store.lines).toEqual([]);
  counter.store.addProduct(product, "1");
  await flush(el);
  emit(counter, "place-order");
  await flush(el, 6);
  expect(counter.stage).toBe("collect");
  expect(counter.store.id).toBe(id);
  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);

  expect(dialog(el)!.lines.map((row) => row.lineId)).toEqual(["sent-dish"]);
});

/** A Counter order sent to the kitchen in a zone that pays after sending, with no receipt, opened
 * from Waiting with Lunch and Beer on it; Waiting answers what the server lists after `paid`. */
async function sentWaitingOrder(
  paid: () => "no" | "items" | "whole",
  overrides: Record<string, unknown> = {},
) {
  const id = "placed-order";
  const lunch = line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" });
  const beer = line({ id: "dish-2", lineNo: 2, name: "Beer", unitPriceGross: "5.00" });
  const row = (over: Record<string, unknown>) => ({
    id,
    items: [],
    orderNumber: 7,
    label: null,
    status: "placed",
    total: "35.00",
    openedAt: "2026-11-10T10:00:00Z",
    settledAt: null,
    collectedAt: null,
    serviceMode: "ticket_then_pay",
    counts: { ordered: 2, unsent: 0, held: 0, waiting: 2, ready: 0 },
    canHandOver: false,
    movableDishes: [],
    ...over,
  });
  const waiting = () => {
    const now = paid();
    if (now === "whole") return [row({ status: "settled", settledAt: "2026-11-10T10:05:00Z" })];
    if (now === "no") return [row({})];
    return [
      row({ total: "5.00", counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 } }),
      row({
        id: "wo-paid",
        orderNumber: 8,
        formerOrderNumbers: [7],
        status: "settled",
        total: "30.00",
        settledAt: "2026-11-10T10:05:00Z",
        counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
      }),
    ];
  };
  const api = stubApi({
    getFindBill: vi.fn(async () => ({
      workingOrderId: id,
      partyId: null,
      edit: { editorVersion: 2, draftId: null, draftRevision: null, billId: id },
    })),
    listCounterWaiting: vi.fn(async () => waiting()),
    retrievePlacedOrder: vi.fn(async () => ({
      zoneId: null,
      serviceMode: "ticket_then_pay",
      id,
      orderNumber: 7,
      revision: paid() === "items" ? 1 : 0,
      label: null,
      expectedEdit: null,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: (paid() === "items"
        ? []
        : [{ workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product }]
      ).concat([
        { workingOrderLineId: "dish-2", menuItemId: "offer-meal", quantity: "1.000", product },
      ]),
    })),
    getTabLines: vi.fn(async () => ({
      revision: paid() === "items" ? 1 : 0,
      lines: paid() === "items" ? [beer] : [lunch, beer],
    })),
    getBillBalance: vi.fn(async () =>
      paid() === "items"
        ? balanceOf({ workingOrderId: id, status: "placed", total: "5.00", outstanding: "5.00" })
        : balanceOf({ workingOrderId: id, status: "placed", total: "35.00", outstanding: "35.00" }),
    ),
    ...overrides,
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
  tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);
  return { el, api };
}

it("shows the full Counter zone name on the shared Back button at phone width", async () => {
  const { innerWidth, innerHeight } = window;
  onTestFinished(() => page.viewport(innerWidth, innerHeight));
  await page.viewport(390, 844);
  const zones = deviceZonesFixture(["z1"]);
  zones.zones[0]!.name = "Downstairs bar";
  const { el } = await sentWaitingOrder(() => "no", {
    getDeviceZones: vi.fn().mockResolvedValue(zones),
  });
  const label = inDialog(el, "wt-top-bar")!.shadowRoot!.querySelector<HTMLElement>(".back-label")!;
  expect(label.textContent).toBe("Counter · Downstairs bar");
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
});

it("checks Charge again before sending and repeats the exact unanswered payment", async () => {
  const allocation = (amount: string) => ({
    ...cash(amount, "0.00"),
    change: null,
    charged: amount,
  });
  const previewBillPayment = vi
    .fn()
    .mockResolvedValueOnce(allocation("35.00"))
    .mockResolvedValue(allocation("32.00"));
  const takeBillPayment = vi.fn().mockRejectedValue({ code: "network" });
  const { el } = await sentWaitingOrder(() => "no", {
    getTill: vi.fn().mockResolvedValue({
      ...till,
      cardProvider: "simulator",
      capabilities: [...till.capabilities, "integrated-card-payment"],
      activeReaders: [],
    }),
    previewBillPayment,
    takeBillPayment,
  });
  const charge = () => inDialog(el, "[data-quiet-pay-card]");
  await expect.poll(() => text(charge())).toContain(money("35.00"));
  await press(el, "[data-quiet-pay-card]");
  await expect.poll(() => text(charge())).toContain(money("32.00"));
  expect(takeBillPayment).not.toHaveBeenCalled();

  await press(el, "[data-quiet-pay-card]");
  await expect.poll(() => takeBillPayment.mock.calls.length).toBeGreaterThan(0);
  const first = takeBillPayment.mock.calls[0]!;
  expect(first[1]).toMatchObject({ method: "card", entry: "reader", applied: "32.00" });
  await expect.poll(() => inDialog(el, "[data-pay-confirm]")).not.toBeNull();
  await press(el, "[data-pay-confirm]");
  expect(takeBillPayment.mock.calls.at(-1)?.slice(0, 2)).toEqual(first.slice(0, 2));
  expect(takeBillPayment.mock.calls.length).toBeGreaterThan(1);
});

it("keeps the current Counter amount when the previous choice answers late", async () => {
  let answer!: (preview: ReturnType<typeof cash>) => void;
  const held = new Promise<ReturnType<typeof cash>>((resolve) => (answer = resolve));
  const previewBillPayment = vi
    .fn()
    .mockReturnValueOnce(held)
    .mockResolvedValue(cash("12.00", "0.00"));
  const { el, api } = await sentWaitingOrder(() => "no", { previewBillPayment });
  await expect.poll(() => previewBillPayment.mock.calls.length).toBe(1);

  await choosePayWay(el, "contribution");
  await type(el, "amount", "12");
  const amount = () => text(inDialog(el, "[data-quiet-pay-amount]"));
  await expect.poll(() => inDialog(el, "[data-pay-own-receipt]")).not.toBeNull();
  await answerOwnReceipt(el, "no");
  await expect.poll(() => inDialog(el, "[data-quiet-pay-cash]")?.disabled).toBe(false);
  expect(amount()).toBe(money("12.00"));
  answer(cash("35.00", "0.00"));
  await flush(el);
  expect(amount()).toBe(money("12.00"));
  expect(inDialog(el, "[data-quiet-pay-cash]")?.disabled).toBe(false);
  expect(api.takeBillPayment).not.toHaveBeenCalled();
});

const waitingShown = (el: TillApp) =>
  el
    .shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!
    .counterWaiting.map((row) => [row.orderNumber, row.status, row.total]);

it("Items shows no receipt warning on a sent Counter order with no receipt", async () => {
  const { el } = await sentWaitingOrder(() => "no", {
    previewItemPayment: vi
      .fn()
      .mockResolvedValue({ total: "30.00", applied: "30.00", tip: "0.00", change: "20.00" }),
  });
  await choosePayWay(el, "items");
  await press(el, 'input[name="line"][value="1"]');
  await enterCash(el, "50");
  await press(el, "[data-pay-continue]");
  await flush(el);

  expect(inDialog(el, "[data-pay-own-bill]")).toBeNull();
});

it("paying Items on a sent Counter order lists Waiting again, with what is left and the paid part", async () => {
  let paid: "no" | "items" = "no";
  const id = "placed-order";
  const { el, api } = await sentWaitingOrder(() => paid, {
    previewItemPayment: vi
      .fn()
      .mockResolvedValue({ total: "30.00", applied: "30.00", tip: "0.00", change: "20.00" }),
    payForItems: vi.fn(async () => {
      paid = "items";
      return {
        billId: "wo-paid",
        payment: takenOf(
          { applied: "30.00", tendered: "50.00", change: "20.00" },
          {
            workingOrderId: "wo-paid",
            status: "settled",
            total: "30.00",
            received: "30.00",
            outstanding: "0.00",
          },
          invoiceOf("30.00"),
        ),
        sourceBalance: balanceOf({
          workingOrderId: id,
          status: "placed",
          total: "5.00",
          outstanding: "5.00",
        }),
      };
    }),
  });
  expect(waitingShown(el)).toEqual([[7, "placed", "35.00"]]);
  await choosePayWay(el, "items");
  await press(el, 'input[name="line"][value="1"]');
  await enterCash(el, "50");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await flush(el, 8);

  expect(api.payForItems).toHaveBeenCalledOnce();
  expect(waitingShown(el)).toEqual([
    [7, "placed", "5.00"],
    [8, "settled", "30.00"],
  ]);
});

it("paying the whole of a sent Counter order from its Pay window lists Waiting again, settled", async () => {
  let paid: "no" | "whole" = "no";
  const id = "placed-order";
  const { el, api } = await sentWaitingOrder(() => paid, {
    previewBillPayment: vi.fn().mockResolvedValue(cash("35.00", "15.00")),
    takeBillPayment: vi.fn(async () => {
      paid = "whole";
      return takenOf(
        { applied: "35.00", tendered: "50.00", change: "15.00" },
        {
          workingOrderId: id,
          status: "settled",
          total: "35.00",
          received: "35.00",
          outstanding: "0.00",
        },
        invoiceOf("35.00"),
      );
    }),
  });
  expect(waitingShown(el)).toEqual([[7, "placed", "35.00"]]);
  await enterCash(el, "50");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await flush(el, 8);

  expect(api.takeBillPayment).toHaveBeenCalledOnce();
  expect(waitingShown(el)).toEqual([[7, "settled", "35.00"]]);
});

it.each([
  ["sent to the kitchen first", true],
  ["never saved", false],
])(
  "an English till's Counter order %s keeps its dishes' English unit words after Pay reads it again",
  async (_, sendFirst) => {
    const each = {
      id: EACH_UNIT_ID,
      staffName: "Each",
      staffAbbreviation: "ea",
      name: { en: "each", es: "unidad" },
      abbreviation: { en: "ea", es: "ud" },
      precision: 0,
      hardwareUnit: null,
    };
    const live: TillProduct = { ...product, unit: each };
    // The server keeps a line's unit words in the venue's default language only.
    const stored = {
      ...product,
      unit: {
        ...each,
        staffName: "unidad",
        staffAbbreviation: "ud",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
      },
    };
    let id = "";
    let sent = false;
    const storedOrder = () => ({
      zoneId: null,
      serviceMode: "ticket_then_pay",
      id,
      orderNumber: 7,
      revision: 0,
      label: null,
      expectedEdit: null,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: [
        {
          workingOrderLineId: "dish-1",
          menuItemId: "offer-meal",
          quantity: "1.000",
          product: stored,
        },
      ],
    });
    const offer: ZoneOffers["offers"][number] = {
      id: "offer-meal",
      menuId: "cat-default",
      productId: "meal",
      grossPrice: "30.00",
      unitPrice: "30.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Lunch",
      customerName: null,
      kitchenName: null,
      unit: each,
      vatClass: "general",
      takeawayVatClass: "general",
      category: "Other",
      allergens: null,
      diet: null,
      dietOverride: null,
      dietaryDeclarations: [],
      offeredModifiers: [],
      variants: [],
      courseId: null,
    };
    const api = stubApi({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...offers,
        offers: [offer],
        menus: servedMenus(
          [{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }],
          [offer],
        ),
      }),
      parkOrder: vi.fn(async (request: { id: string }) => {
        id = request.id;
        return { id, orderNumber: 7, serviceMode: "ticket_then_pay" };
      }),
      getKitchenNote: vi.fn(async () => ({
        scope: { workingOrderId: id },
        note: null,
        revision: 0,
        ownerRevision: 0,
      })),
      placeOrder: vi.fn(async () => {
        sent = true;
        return { id, status: "placed" };
      }),
      listCounterWaiting: vi.fn(async () =>
        sent
          ? [
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
              },
            ]
          : [],
      ),
      retrieveWorkingOrder: vi.fn(async () => storedOrder()),
      retrievePlacedOrder: vi.fn(async () => storedOrder()),
      getTabLines: vi.fn(async () => ({
        revision: 0,
        lines: [
          line({
            id: "dish-1",
            lineNo: 1,
            name: "Lunch",
            unitPriceGross: "30.00",
            ...(sent ? {} : { sentAt: null, firedAt: null, state: null }),
          }),
        ],
      })),
      getBillBalance: vi.fn(async () =>
        balanceOf({
          workingOrderId: id,
          status: sent ? "placed" : "open",
          total: "30.00",
          outstanding: "30.00",
        }),
      ),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
    await flush(el);
    const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    counter.store.addProduct(live, "1");
    await flush(el);
    if (sendFirst) {
      emit(counter, "place-order");
      await flush(el, 6);
      expect(counter.stage).toBe("collect");
    }
    expect(counter.store.lines.map(quantityLabel)).toEqual(["1 ea"]);
    const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
    await tender.updateComplete;
    tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]")!.click();
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await flush(el);

    expect(sendFirst ? api.retrievePlacedOrder : api.retrieveWorkingOrder).toHaveBeenCalled();
    expect(counter.store.lines.map(quantityLabel)).toEqual(["1 ea"]);
  },
);

it("Items is available as soon as Place succeeds, while Waiting is still being read", async () => {
  let id = "";
  let sent = false;
  let answerWaiting!: () => void;
  const waitingHeld = new Promise<void>((resolve) => {
    answerWaiting = resolve;
  });
  const api = stubApi({
    parkOrder: vi.fn(async (request: { id: string }) => {
      id = request.id;
      return { id, orderNumber: 7, serviceMode: "ticket_then_pay" };
    }),
    getKitchenNote: vi.fn(async () => ({
      scope: { workingOrderId: id },
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    listCounterWaiting: vi.fn(async () => {
      if (!sent) return [];
      await waitingHeld;
      return [
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
        },
      ];
    }),
    placeOrder: vi.fn(async () => {
      sent = true;
      return { id, status: "placed" };
    }),
    retrievePlacedOrder: vi.fn(async () => ({
      zoneId: null,
      serviceMode: "ticket_then_pay",
      id,
      orderNumber: 7,
      revision: 0,
      label: null,
      expectedEdit: null,
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      lines: [
        { workingOrderLineId: "dish-1", menuItemId: "offer-meal", quantity: "1.000", product },
      ],
    })),
    getTabLines: vi.fn(async () => ({
      revision: 0,
      lines: [line({ id: "dish-1", lineNo: 1, name: "Lunch", unitPriceGross: "30.00" })],
    })),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, status: "placed", total: "30.00", outstanding: "30.00" }),
    ),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(product, "1");
  await flush(el);
  emit(counter, "place-order");
  await flush(el, 6);
  expect(counter.stage).toBe("collect");
  expect(counter.counterWaiting).toEqual([]);

  const tender = counter.shadowRoot!.querySelector("till-tender-pay")!;
  await tender.updateComplete;
  const pay = tender.shadowRoot!.querySelector<HTMLElement>("[data-counter-pay]");
  expect(pay).not.toBeNull();
  pay!.click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await flush(el);
  const items = dialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-choice-tile"]>(
    '[data-quiet-pay-way="items"]',
  )!;
  expect(items.disabled).toBe(false);
  answerWaiting();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { liveReadFixture } from "../test/live-connection.js";
import type { TillApi } from "./api/client.js";
import { takenOf } from "../test/bill-pay-app.js";
import {
  balanceOf,
  billOf,
  dialog,
  flush,
  inDialog,
  money,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  stubApi,
  text,
  till,
  type,
  line,
  emit,
  tableOrder,
  heldTable,
  floor,
  shell,
  paymentOf,
  showBillFooter,
  equipmentWith,
  SECOND_READER,
} from "../test/bill-pay-app.js";

const readerTill = {
  ...till,
  cardProvider: "simulator",
  capabilities: ["print-receipt", "take-cash", "integrated-card-payment"],
};

beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setLocale("en");
});

it.each(["30.00", "24.00"])(
  "Whole confirms the current %s instead of its opening 27.00",
  async (amount) => {
    const getBillBalance = vi
      .fn()
      .mockResolvedValue(balanceOf({ total: "27.00", outstanding: "27.00" }));
    const previewBillPayment = vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: amount,
      tip: "0.00",
      charged: amount,
      change: null,
    });
    const takeBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue(readerTill),
      getPartyBills: vi.fn().mockResolvedValue([billOf({ total: "27.00", outstanding: "27.00" })]),
      getBillBalance,
      previewBillPayment,
      takeBillPayment,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await openTable(el);
    await openDialog(el, "rest");
    getBillBalance.mockImplementation(() => new Promise(() => {}));
    await press(el, 'input[name="method"][value="card"]');
    await type(el, "cardTip", "0");
    await press(el, "[data-pay-continue]");
    expect(previewBillPayment.mock.calls[0]?.[1]).toMatchObject({
      kind: "share",
      shareOf: 1,
      addedTip: "0",
    });
    expect(text(inDialog(el, "[data-pay-scope]"))).toBe(
      t("table.bill_to_pay").replace("{amount}", money(amount)),
    );
    expect(text(inDialog(el, "[data-pay-applied] dd"))).toBe(money(amount));
    expect(text(inDialog(el, "[data-pay-charged] dd"))).toBe(money(amount));
    expect(inDialog(el, 'wt-number-stepper[name="guests"]')).not.toBeNull();
    expect(dialog(el)!.balance!.outstanding).toBe("27.00");
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(takeBillPayment).toHaveBeenCalled());
    expect(takeBillPayment.mock.calls[0]?.[1]).toMatchObject({
      kind: "share",
      shareOf: 1,
      applied: amount,
      tip: "0.00",
      entry: "reader",
    });
  },
);

it("keeps an unanswered reader request reachable on its original moved bill without a second charge", async () => {
  const stream = liveReadFixture();
  const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
  const takeBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const getTablesState = vi.fn().mockResolvedValue([heldTable()]);
  const api = stubApi({
    readLiveEvents: stream.read,
    getPartyBills,
    getTablesState,
    takeBillPayment,
    getTill: vi.fn().mockResolvedValue(readerTill),
    previewBillPayment: vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "120.00",
      tip: "0.00",
      charged: "120.00",
      change: null,
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "rest");
  await press(el, 'input[name="method"][value="card"]');
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await vi.waitFor(() => expect(dialog(el)!.confirmationLocked).toBe(true), { timeout: 10_000 });
  const original = takeBillPayment.mock.calls[0];
  const sends = takeBillPayment.mock.calls.length;
  expect(original?.[0]).toBe("wo-4");
  expect(original?.[1].entry).toBe("reader");
  getPartyBills.mockImplementation(async (partyId) =>
    partyId === "v2"
      ? [billOf({ partyId: "v2" })]
      : [billOf({ workingOrderId: "wo-9", billNumber: 2 })],
  );
  getTablesState.mockResolvedValue([
    heldTable({ openingBillId: "wo-9" }),
    { ...heldTable({ id: "v2", tableIds: ["t9"] }), id: "t9", label: "9", shortName: "9" },
  ]);
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 10);
  expect(tableOrder(el).orderId).toBe("wo-9");
  expect(dialog(el)!.confirmationLocked).toBe(true);
  emit(dialog(el)!, "bill-pay-close");
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el), "open-table", { tableId: "t9", seated: true });
  await flush(el);
  await openDialog(el, "rest");
  expect(dialog(el)!.confirmationLocked).toBe(true);
  expect(dialog(el)!.asked?.choice).toEqual({ kind: "whole" });
  expect(takeBillPayment).toHaveBeenCalledTimes(sends);
  expect(takeBillPayment.mock.calls.map((call) => call.slice(0, 2))).toEqual(
    Array.from({ length: sends }, () => original!.slice(0, 2)),
  );
});

it.each(["move", "merge"])("closes idle Pay when another till performs a %s", async (change) => {
  const stream = liveReadFixture();
  const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
  const api = stubApi({ getPartyBills, readLiveEvents: stream.read });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "rest");
  getPartyBills.mockResolvedValue([
    ...(change === "merge" ? [billOf({ status: "abandoned", billNumber: null })] : []),
    billOf({ workingOrderId: "wo-9", billNumber: 2 }),
  ]);
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 10);
  expect(tableOrder(el).billGone).not.toBeNull();
  expect(dialog(el)).toBeNull();
  expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).not.toBe("");
});

it.each(["live", "fallback"])(
  "Pay items follows moved portions through %s without losing the tender",
  async (source) => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const stream = liveReadFixture();
    const portions = Array.from({ length: 12 }, (_, n) =>
      line({ lineNo: n + 1, name: "Dessert", portion: true, unitPriceGross: "3.00" }),
    );
    const getTabLines = vi.fn().mockResolvedValue({ lines: portions, revision: 0 });
    const getBillBalance = vi
      .fn()
      .mockResolvedValue(balanceOf({ total: "36.00", outstanding: "36.00" }));
    const previewBillPayment = vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "3.00",
      tip: "0.00",
      charged: null,
      change: "7.00",
    });
    const api = stubApi({
      getTabLines,
      getBillBalance,
      previewBillPayment,
      readLiveEvents: stream.read,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await openTable(el);
    if (source === "live") {
      stream.event("ready");
      await flush(el);
    }
    await openDialog(el, "items");
    expect(dialog(el)!.shadowRoot!.querySelectorAll('input[name="line"]')).toHaveLength(1);
    await press(el, 'input[name="line"][value="1"]');
    await press(el, '[data-units-more="1"]');
    await type(el, "tendered", "10");
    getTabLines.mockResolvedValue({ lines: portions.slice(1), revision: 1 });
    getBillBalance.mockResolvedValue(balanceOf({ total: "33.00", outstanding: "33.00" }));
    if (source === "live") {
      stream.event("change", '[{"type":"working_orders"}]');
      await flush(el, 8);
    } else {
      const ticks = timers.mock.calls.filter((call) => call[1] === 15_000);
      expect(ticks.length).toBeGreaterThan(0);
      for (const [tick] of ticks) (tick as () => void)();
      await flush(el, 8);
    }
    expect(dialog(el)!.lines.map((row) => row.lineNo)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(dialog(el)!.balance!.outstanding).toBe("33.00");
    expect(text(inDialog(el, '[data-units="2"]'))).toBe("1");
    await press(el, "[data-pay-continue]");
    expect(previewBillPayment.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "items",
      lines: [{ lineNo: 2 }],
      tendered: "10",
    });
  },
);

it.each(["en", "es"])(
  "a departed dish refusal in %s refreshes Pay without erasing its explanation",
  async (locale) => {
    setLocale(locale);
    const getTabLines = vi
      .fn()
      .mockResolvedValue({ lines: [line({ lineNo: 1, name: "Dessert" })], revision: 0 });
    const api = stubApi({
      getTabLines,
      previewBillPayment: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await openTable(el);
    await openDialog(el, "items");
    setLocale(locale);
    await press(el, 'input[name="line"][value="1"]');
    await type(el, "tendered", "10");
    getTabLines.mockResolvedValue({ lines: [], revision: 1 });
    await press(el, "[data-pay-continue]");
    await flush(el, 8);
    expect(dialog(el)!.lines).toEqual([]);
    expect(inDialog(el, "wt-form-actions")!.error).toContain(
      t("move_station.refused.tab.line_not_found"),
    );
  },
);

it("keeps a submitted preview intact, then shows refreshed items when staff go Back", async () => {
  const stream = liveReadFixture();
  const dishes = [line({ lineNo: 1, name: "Dessert" }), line({ lineNo: 2, name: "Coffee" })];
  const getTabLines = vi.fn().mockResolvedValue({ lines: dishes, revision: 0 });
  const api = stubApi({ readLiveEvents: stream.read, getTabLines });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "items");
  await press(el, 'input[name="line"][value="1"]');
  await type(el, "tendered", "50");
  await press(el, "[data-pay-continue]");
  const asked = dialog(el)!.asked;
  const preview = dialog(el)!.preview;
  getTabLines.mockResolvedValue({ lines: dishes.slice(1), revision: 1 });
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 8);
  expect(dialog(el)!.asked).toBe(asked);
  expect(dialog(el)!.preview).toBe(preview);
  expect(text(inDialog(el, "[data-pay-scope]"))).toContain("Dessert");
  await press(el, "[data-pay-back]");
  expect(dialog(el)!.lines.map((row) => row.lineNo)).toEqual([2]);
  expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(true);
});

it("does not resolve an unanswered card from a balance read started before the send ended", async () => {
  const stream = liveReadFixture();
  let endSend!: () => void;
  const sending = new Promise<void>((resolve) => {
    endSend = resolve;
  });
  const takeBillPayment = vi.fn<TillApi["takeBillPayment"]>(async () => {
    await sending;
    throw new TypeError("Failed to fetch");
  });
  const getBillBalance = vi.fn().mockResolvedValue(balanceOf());
  const api = stubApi({
    readLiveEvents: stream.read,
    getBillBalance,
    takeBillPayment,
    getTill: vi.fn().mockResolvedValue(readerTill),
    previewBillPayment: vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "120.00",
      tip: "0.00",
      charged: "120.00",
      change: null,
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "rest");
  await press(el, 'input[name="method"][value="card"]');
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await vi.waitFor(() => expect(takeBillPayment).toHaveBeenCalled());
  const request = takeBillPayment.mock.calls[0]![1];
  let answerOld!: (balance: ReturnType<typeof balanceOf>) => void;
  const oldRead = new Promise<ReturnType<typeof balanceOf>>((resolve) => {
    answerOld = resolve;
  });
  getBillBalance.mockImplementationOnce(() => oldRead);
  const reads = getBillBalance.mock.calls.length;
  stream.event("change", '[{"type":"working_orders"}]');
  await vi.waitFor(() => expect(getBillBalance).toHaveBeenCalledTimes(reads + 1));
  let answerFresh!: (balance: ReturnType<typeof balanceOf>) => void;
  const freshRead = new Promise<ReturnType<typeof balanceOf>>((resolve) => {
    answerFresh = resolve;
  });
  getBillBalance.mockImplementationOnce(() => freshRead);
  endSend();
  await vi.waitFor(() => expect(dialog(el)!.busy).toBe(false), { timeout: 10_000 });
  expect(dialog(el)!.confirmationLocked).toBe(true);
  const pending = balanceOf({
    reserved: "120.00",
    outstanding: "0.00",
    payments: [
      paymentOf({
        method: "card",
        entry: "reader",
        state: "pending",
        submissionId: request.submissionId,
        applied: "120.00",
      }),
    ],
  });
  answerOld(pending);
  await flush(el, 10);
  expect(dialog(el)!.confirmationLocked).toBe(true);
  answerFresh(pending);
  await vi.waitFor(() => expect(dialog(el)!.confirmationLocked).toBe(false));
});

it("reopens a presented bill's unanswered whole-card confirmation at its new table", async () => {
  const getPartyBills = vi
    .fn()
    .mockResolvedValue([billOf({ status: "placed", receiptAvailable: true })]);
  const getTablesState = vi.fn().mockResolvedValue([heldTable()]);
  const collectOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const api = stubApi({
    getPartyBills,
    getTablesState,
    collectOrder,
    getTill: vi.fn().mockResolvedValue({
      ...till,
      formFactor: "phone-portrait",
      capabilities: ["take-cash", "hand-keyed-card-payment"],
    }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "phone", name: "Phone", formFactor: "phone-portrait" }),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(SECOND_READER)),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const presented = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-presented-pay-dialog"]>(
      "till-presented-pay-dialog",
    );
  const order = await openTable(el);
  await showBillFooter(order);
  order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
  await flush(el);
  emit(presented()!, "presented-pay", {
    method: "manual",
    externalRef: "operation-17",
    guestCount: 4,
  });
  await vi.waitFor(() => expect(collectOrder).toHaveBeenCalled());
  await flush(el);
  expect(presented()).toBeNull();
  order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
  await flush(el);
  const original = presented()!.confirmation;
  expect(original!.tender).toEqual({
    method: "card",
    amount: "120.00",
    externalRef: "operation-17",
  });
  const sends = collectOrder.mock.calls.length;
  getPartyBills.mockImplementation(async (partyId) =>
    partyId === "v2"
      ? [billOf({ partyId: "v2", status: "placed", receiptAvailable: true })]
      : [billOf({ workingOrderId: "wo-9", billNumber: 2 })],
  );
  getTablesState.mockResolvedValue([
    heldTable({ openingBillId: "wo-9" }),
    { ...heldTable({ id: "v2", tableIds: ["t9"] }), id: "t9", label: "9", shortName: "9" },
  ]);
  window.dispatchEvent(new Event("focus"));
  await flush(el, 10);
  expect(tableOrder(el).orderId).toBe("wo-9");
  expect(presented()).toBeNull();
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el), "open-table", { tableId: "t9", seated: true });
  await flush(el);
  await showBillFooter(tableOrder(el));
  tableOrder(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
  await flush(el);
  expect(presented()!.confirmation).toBe(original);
  expect(presented()!.shadowRoot!.querySelector("[data-presented-pay-resend]")).not.toBeNull();
  expect(collectOrder).toHaveBeenCalledTimes(sends);
  expect(collectOrder.mock.calls.every((call) => call[0] === "wo-4")).toBe(true);
});

it("keeps a reader's pending outcome visible when its bill moves", async () => {
  const stream = liveReadFixture();
  const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
  const api = stubApi({
    readLiveEvents: stream.read,
    getPartyBills,
    getTill: vi.fn().mockResolvedValue(readerTill),
    previewBillPayment: vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "120.00",
      tip: "0.00",
      charged: "120.00",
      change: null,
    }),
    takeBillPayment: vi.fn().mockResolvedValue({
      ...takenOf(
        {
          method: "card",
          entry: "reader",
          state: "pending",
          applied: "120.00",
          tendered: null,
          change: null,
        },
        { reserved: "120.00", outstanding: "0.00" },
      ),
      outcome: "timeout",
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "rest");
  await press(el, 'input[name="method"][value="card"]');
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  expect(dialog(el)!.taken?.pending).toBe("120.00");
  getPartyBills.mockResolvedValue([billOf({ workingOrderId: "wo-9", billNumber: 2 })]);
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 10);
  expect(tableOrder(el).orderId).toBe("wo-9");
  expect(dialog(el)?.taken?.pending).toBe("120.00");
});

it("keeps a refund being sent and shows its result after the bill moves", async () => {
  const stream = liveReadFixture();
  const payment = paymentOf();
  const getPartyBills = vi
    .fn()
    .mockResolvedValue([billOf({ outstanding: "70.00", hasPayments: true })]);
  const balance = balanceOf({ received: "50.00", outstanding: "70.00", payments: [payment] });
  let answer!: (result: Awaited<ReturnType<TillApi["refundBillPayment"]>>) => void;
  const refundBillPayment = vi.fn<TillApi["refundBillPayment"]>(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const api = stubApi({
    readLiveEvents: stream.read,
    getPartyBills,
    getBillBalance: vi.fn().mockResolvedValue(balance),
    refundBillPayment,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const refund = () => el.shadowRoot!.querySelector("till-bill-refund-dialog");
  await openTable(el);
  stream.event("ready");
  await flush(el);
  await openDialog(el, "rest");
  emit(dialog(el)!, "bill-refund", { paymentId: payment.id });
  await flush(el);
  emit(refund()!, "bill-refund-continue", {
    appliedAmount: "50.00",
    tipAmount: "0.00",
    reason: "Charged twice",
  });
  await vi.waitFor(() => expect(refundBillPayment).toHaveBeenCalled());
  getPartyBills.mockResolvedValue([billOf({ workingOrderId: "wo-9", billNumber: 2 })]);
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 10);
  expect(tableOrder(el).orderId).toBe("wo-9");
  expect(refund() !== null).toBe(true);
  answer({
    refund: {
      id: "refund-1",
      paymentId: payment.id,
      submissionId: "refund-sub-1",
      appliedAmount: "50.00",
      tipAmount: "0.00",
      reason: "Charged twice",
      state: "completed",
      createdAt: "2026-09-30T20:10:00.000Z",
      completedAt: "2026-09-30T20:10:00.000Z",
    },
    balance,
  });
  await vi.waitFor(() =>
    expect(dialog(el)?.refunded).toMatchObject({
      state: "completed",
      amount: "50.00",
      method: "cash",
    }),
  );
});

it("keeps a handheld's earlier card watched after the next guest's preview and a bill move", async () => {
  const getPartyBills = vi.fn().mockResolvedValue([billOf({ hasPayments: true })]);
  const pending = paymentOf({
    method: "card",
    entry: "reader",
    state: "pending",
    applied: "40.00",
    tendered: null,
    change: null,
  });
  const waiting = balanceOf({ reserved: "40.00", outstanding: "80.00", payments: [pending] });
  const getBillBalance = vi.fn().mockResolvedValue(balanceOf());
  const previewBillPayment = vi.fn().mockResolvedValue({
    kind: "allocated",
    choice: null,
    applied: "40.00",
    tip: "0.00",
    charged: "40.00",
    change: null,
  });
  const takeBillPayment = vi.fn().mockImplementation(async () => {
    getBillBalance.mockResolvedValue(waiting);
    return { ...takenOf(pending, waiting), outcome: "timeout" };
  });
  const api = stubApi({
    getPartyBills,
    getBillBalance,
    previewBillPayment,
    takeBillPayment,
    getTill: vi.fn().mockResolvedValue({
      ...readerTill,
      formFactor: "phone-portrait",
      cardProvider: "sumup_cloud",
      activeReaders: [{ id: "r2", name: "Reader", provider: "sumup_cloud" }],
      defaultReaderId: "r2",
    }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "phone", name: "Phone", formFactor: "phone-portrait" }),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(SECOND_READER)),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  await showBillFooter(order);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await openDialog(el, "contribution");
  await type(el, "amount", "40");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  expect(dialog(el)!.taken?.pending).toBe("40.00");
  await press(el, "[data-pay-next]");
  await type(el, "amount", "10");
  previewBillPayment.mockResolvedValue({
    kind: "allocated",
    choice: null,
    applied: "10.00",
    tip: "0.00",
    charged: "10.00",
    change: null,
  });
  emit(dialog(el)!, "bill-pay-preview", {
    choice: { kind: "contribution", amount: "10" },
    pay: { method: "card" },
    card: { entry: "reader", readerId: "r2" },
  });
  await flush(el);
  expect(dialog(el)!.taken).toBeNull();
  getPartyBills.mockResolvedValue([billOf({ workingOrderId: "wo-9", billNumber: 2 })]);
  window.dispatchEvent(new Event("focus"));
  await flush(el, 10);
  expect(tableOrder(el).orderId).toBe("wo-9");
  expect(dialog(el) !== null).toBe(true);
  getBillBalance.mockResolvedValue(
    balanceOf({
      received: "40.00",
      outstanding: "80.00",
      payments: [{ ...pending, state: "received" }],
    }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  await flush(el);
  expect(text(inDialog(el, "[data-pay-notice]"))).toBe(
    t("bill_pay.late_received").replace("{amount}", money("40.00")),
  );
  expect(dialog(el)!.asked?.choice).toEqual({ kind: "contribution", amount: "10" });
  expect(takeBillPayment).toHaveBeenCalledOnce();
});

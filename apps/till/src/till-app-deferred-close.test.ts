import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { billUnsentText } from "./state/bill-unsent.js";
import {
  billOf,
  flush,
  floor,
  invoiceOf,
  money,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  stubApi,
  tableOrder,
  text,
  till,
} from "../test/bill-pay-app.js";
import type { CurrentOrders, PartyBill } from "./api/client.js";
import type { CloseDeferredResult } from "./api/deferred-close-types.js";
import type { CapabilityFlag } from "./layout.js";
import type { TillDeferredCloseDialog } from "./widgets/deferred-close-dialog.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const noOrders: CurrentOrders = {
  revision: 3,
  hasGroups: false,
  nextDisplayNumber: 1,
  retainedCourses: [],
  reminder: null,
  groups: [],
  ungrouped: [],
};

function closedAs(party: CloseDeferredResult["party"]["state"]): CloseDeferredResult {
  return {
    submissionId: "s",
    workingOrderId: "wo-4",
    saleId: "sale-1",
    invoiceNumber: "F-0007",
    classification: "deferred_payment",
    closedAt: "2026-11-12T20:30:00.000Z",
    businessDay: "2026-11-12",
    total: "120.00",
    currency: "EUR",
    party: { state: party, blockers: party === "open" ? ["other_bills"] : [] },
  };
}

function deferredApi(over: Record<string, unknown> = {}) {
  return stubApi({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      receiptLanguages: ["es", "en"],
      capabilities: [...till.capabilities, "close-deferred"] as CapabilityFlag[],
    }),
    readCurrentOrders: vi.fn().mockResolvedValue(noOrders),
    closeDeferred: vi.fn().mockResolvedValue(closedAs("open")),
    getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    ...over,
  });
}

const closing = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillDeferredCloseDialog>("till-deferred-close-dialog");

async function openClosing(el: TillApp): Promise<TillDeferredCloseDialog> {
  await openTable(el);
  await openDialog(el, "rest");
  await press(el, "[data-pay-deferred]");
  const window = closing(el);
  expect(window?.open).toBe(true);
  return window!;
}

async function confirm(el: TillApp): Promise<void> {
  closing(el)!.shadowRoot!.querySelector<HTMLElement>("[data-deferred-close-confirm]")!.click();
  await flush(el, 8);
}

const documents = (el: TillApp) => el.shadowRoot!.querySelector("till-settlement-document-dialog");

const unedited = { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null };

/** Puts one unsent dish on the bill on screen. */
function addWater(el: TillApp): void {
  tableOrder(el).draftStore!.addProduct(
    {
      id: "water",
      catalogueId: "cat-default",
      menuItemId: "menu-item-water",
      name: "Water",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
}

it("closes the bill and opens the documents window for its receipt", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const window = await openClosing(el);
  expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
  expect(window.bill).toEqual({
    label: "4 · Bill 1",
    total: "120.00",
    customer: null,
    issued: false,
  });
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledExactlyOnceWith("wo-4", {
    submissionId: expect.any(String),
    expectedRevision: 0,
    expectedEdit: unedited,
    expectedTotal: "120.00",
    invoiceType: "F2",
    recipient: null,
    receiptLanguage: "es",
    delivery: null,
    partyFinish: {
      partyId: "v1",
      expectedPartyRevision: 3,
      expectedEdits: [unedited],
    },
  });
  expect(api.getFiledTicket).toHaveBeenCalledExactlyOnceWith("wo-4");
  expect(closing(el)).toBeNull();
  expect(documents(el)).not.toBeNull();
});

it("refuses unsent dishes before sending anything", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  addWater(el);
  await flush(el);
  await confirm(el);
  expect(api.closeDeferred).not.toHaveBeenCalled();
  expect(closing(el)!.refusal).toBe(billUnsentText("4 · Bill 1"));
});

it("sends once the unsent dishes are removed, however often the refusal came", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  addWater(el);
  await flush(el);
  await confirm(el);
  await confirm(el);
  expect(api.closeDeferred).not.toHaveBeenCalled();
  tableOrder(el).draftStore!.removeLine(0);
  await flush(el);
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(documents(el)).not.toBeNull();
});

it("after a refusal, the next confirm carries a new id and the re-read revision and total", async () => {
  const api = deferredApi({
    closeDeferred: vi
      .fn()
      .mockRejectedValueOnce({ code: "deferred_close.conflict", status: 409 })
      .mockResolvedValueOnce(closedAs("open")),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  vi.mocked(api.getPartyBills).mockResolvedValue([
    billOf({ revision: 1, total: "130.00", outstanding: "130.00" }),
  ]);
  await confirm(el);
  const window = closing(el)!;
  expect(window.open).toBe(true);
  expect(window.busy).toBe(false);
  expect(window.refusal).toBe(codeMessage("deferred_close.conflict"));
  expect(window.bill?.total).toBe("130.00");
  expect(text(window.shadowRoot!.querySelector("[data-deferred-close-total]"))).toBe(
    money("130.00"),
  );
  await confirm(el);
  const [first, second] = vi.mocked(api.closeDeferred).mock.calls.map(([, body]) => body);
  expect(second!.submissionId).not.toBe(first!.submissionId);
  expect(first).toMatchObject({ expectedRevision: 0, expectedTotal: "120.00" });
  expect(second).toMatchObject({ expectedRevision: 1, expectedTotal: "130.00" });
  expect(documents(el)).not.toBeNull();
});

it("closes the window and shows the refusal when the re-read bill can no longer be closed this way", async () => {
  const api = deferredApi({
    closeDeferred: vi.fn().mockRejectedValue({
      code: "deferred_close.ineligible",
      reason: "prior_payment",
      workingOrderId: "wo-4",
      status: 409,
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  const paid: PartyBill = billOf({ hasPayments: true, outstanding: "0.00", status: "settled" });
  vi.mocked(api.getPartyBills).mockResolvedValue([paid]);
  await confirm(el);
  expect(closing(el)).toBeNull();
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(
    codeMessage("deferred_close.ineligible", "en", { reason: "prior_payment" }),
  );
});

it("a failed receipt read after the close is a load failure; nothing is sent again", async () => {
  const api = deferredApi({
    getFiledTicket: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  await confirm(el);
  await flush(el, 8);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(closing(el)).toBeNull();
  expect(documents(el)).toBeNull();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(t("deferred_close.ticket_unread"));
});

it("a failed receipt read after a close that finished the party still says so on the floor", async () => {
  const api = deferredApi({
    closeDeferred: vi.fn().mockResolvedValue(closedAs("closed")),
    getFiledTicket: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  await confirm(el);
  await flush(el, 8);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(floor(el)).not.toBeNull();
  expect(tableOrder(el)).toBeNull();
  expect(documents(el)).toBeNull();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(t("deferred_close.ticket_unread"));
});

it("returns to the floor when the close finished the party; stays on the table when it did not", async () => {
  const finished = deferredApi({ closeDeferred: vi.fn().mockResolvedValue(closedAs("closed")) });
  const { el } = await mountWidget<TillApp>("till-app", { api: finished });
  await openClosing(el);
  await confirm(el);
  expect(floor(el)).not.toBeNull();
  expect(tableOrder(el)).toBeNull();
  cleanupWidgets();
  resetBillPayDrafts();

  const open = deferredApi({ closeDeferred: vi.fn().mockResolvedValue(closedAs("open")) });
  const { el: other } = await mountWidget<TillApp>("till-app", { api: open });
  await openClosing(other);
  await confirm(other);
  expect(tableOrder(other)).not.toBeNull();
});

/** A close request held open until the test answers it. */
function heldClose() {
  const answer: { ok?: (result: CloseDeferredResult) => void; fail?: (error: unknown) => void } =
    {};
  const closeDeferred = vi.fn(
    () =>
      new Promise<CloseDeferredResult>((ok, fail) => {
        answer.ok = ok;
        answer.fail = fail;
      }),
  );
  return { closeDeferred, answer };
}

const moveTo = (el: TillApp, billId: string) => {
  (el as unknown as { activeTabId: string }).activeTabId = billId;
};

it.each([
  ["no answer", new TypeError("Failed to fetch"), () => t("deferred_close.unanswered")],
  [
    "a refusal",
    { code: "deferred_close.conflict", status: 409 },
    () => codeMessage("deferred_close.conflict"),
  ],
])(
  "%s after the till moved to another bill leaves the window open and not busy, saying so; confirming then closes it, sending nothing",
  async (_case, failure, said) => {
    const { closeDeferred, answer } = heldClose();
    const api = deferredApi({ closeDeferred });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await openClosing(el);
    await confirm(el);
    expect(closing(el)!.busy).toBe(true);
    moveTo(el, "wo-9");
    answer.fail!(failure);
    await flush(el, 8);
    const window = closing(el)!;
    expect(window.open).toBe(true);
    expect(window.busy).toBe(false);
    expect(window.refusal).toBe(said());
    await confirm(el);
    expect(closing(el)).toBeNull();
    expect(api.closeDeferred).toHaveBeenCalledOnce();
  },
);

it("a close answered after the till moved to another bill closes the window and opens the documents window", async () => {
  const { closeDeferred, answer } = heldClose();
  const api = deferredApi({ closeDeferred });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  await confirm(el);
  moveTo(el, "wo-9");
  answer.ok!(closedAs("closed"));
  await flush(el, 8);
  expect(closing(el)).toBeNull();
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(api.getFiledTicket).toHaveBeenCalledExactlyOnceWith("wo-4");
  expect(documents(el)).not.toBeNull();
});

const closedBill = (): PartyBill =>
  billOf({
    deferred: true,
    status: "settled",
    outstanding: "0.00",
    invoiceNumber: "F-0007",
    revision: 1,
  });

/** The window after a send that got no answer, with the bill re-read as `bill` from then on. */
async function afterLostAnswer(over: Record<string, unknown>, bill: PartyBill) {
  const api = deferredApi({
    closeDeferred: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    ...over,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  await confirm(el);
  expect(closing(el)!.refusal).toBe(t("deferred_close.unanswered"));
  vi.mocked(api.getPartyBills).mockResolvedValue([bill]);
  return { api, el };
}

const firstSent = (api: ReturnType<typeof deferredApi>) =>
  vi.mocked(api.closeDeferred).mock.calls[0]![1].submissionId;

it("a lost answer whose close the server made opens the documents window without sending again", async () => {
  const getDeferredClosure = vi.fn();
  const { api, el } = await afterLostAnswer({ getDeferredClosure }, closedBill());
  getDeferredClosure.mockResolvedValue({
    closure: { ...closedAs("open"), submissionId: firstSent(api) },
  });
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(getDeferredClosure).toHaveBeenCalledWith("wo-4");
  expect(api.getFiledTicket).toHaveBeenCalledExactlyOnceWith("wo-4");
  expect(closing(el)).toBeNull();
  expect(documents(el)).not.toBeNull();
});

it.each([
  ["names another close", vi.fn().mockResolvedValue({ closure: closedAs("open") })],
  ["cannot be read", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))],
])(
  "a lost answer on a bill re-read as closed this way, whose closure %s, says the bill is already closed and sends nothing",
  async (_case, getDeferredClosure) => {
    const { api, el } = await afterLostAnswer({ getDeferredClosure }, closedBill());
    await confirm(el);
    expect(api.closeDeferred).toHaveBeenCalledOnce();
    expect(getDeferredClosure).toHaveBeenCalledWith("wo-4");
    expect(closing(el)).toBeNull();
    expect(documents(el)).toBeNull();
    expect(text(el.shadowRoot!.querySelector(".error"))).toContain(
      t("deferred_close.already_closed"),
    );
  },
);

it("a conflict on a bill another device closed this way says the bill is already closed", async () => {
  const getDeferredClosure = vi.fn().mockResolvedValue({ closure: closedAs("open") });
  const api = deferredApi({
    closeDeferred: vi.fn().mockRejectedValue({ code: "deferred_close.conflict", status: 409 }),
    getDeferredClosure,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  vi.mocked(api.getPartyBills).mockResolvedValue([closedBill()]);
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(closing(el)).toBeNull();
  const shown = text(el.shadowRoot!.querySelector(".error"));
  expect(shown).toContain(t("deferred_close.already_closed"));
  expect(shown).not.toContain(codeMessage("deferred_close.conflict"));
});

it("a lost answer on a bill whose total changed shows the new total and the conflict, sending nothing", async () => {
  const { api, el } = await afterLostAnswer(
    {},
    billOf({ revision: 1, total: "130.00", outstanding: "130.00" }),
  );
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  const window = closing(el)!;
  expect(window.busy).toBe(false);
  expect(window.refusal).toBe(codeMessage("deferred_close.conflict"));
  expect(text(window.shadowRoot!.querySelector("[data-deferred-close-total]"))).toBe(
    money("130.00"),
  );
});

it("a lost answer on a bill another payment settled closes the window saying so, sending nothing", async () => {
  const { api, el } = await afterLostAnswer(
    {},
    billOf({ hasPayments: true, status: "settled", outstanding: "0.00" }),
  );
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(closing(el)).toBeNull();
  expect(documents(el)).toBeNull();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(
    codeMessage("deferred_close.ineligible", "en", { reason: "prior_payment" }),
  );
});

const unservedOrders: CurrentOrders = {
  ...noOrders,
  ungrouped: [
    {
      billStatus: "open",
      netAmount: "12.00",
      readyAt: null,
      requestedAt: null,
      firedAt: "2026-11-12T20:00:00.000Z",
      lineId: "line-1",
      workingOrderId: "wo-4",
      lineNo: 1,
      courseId: null,
      name: "Squid",
      quantity: "1.000",
      unitPrecision: 0,
      servedQuantity: "0.000",
      servedAt: null,
      released: true,
      kitchen: null,
      note: null,
      extras: [],
    },
  ],
};

const showOrders = (el: TillApp, orders: CurrentOrders) => {
  (el as unknown as { currentOrders: CurrentOrders }).currentOrders = orders;
};

it("a lost answer on a bill with a dish now unserved keeps the window open saying why; once served, confirming sends", async () => {
  const { api, el } = await afterLostAnswer(
    {
      closeDeferred: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(closedAs("open")),
    },
    billOf(),
  );
  vi.mocked(api.readCurrentOrders).mockResolvedValue(unservedOrders);
  showOrders(el, unservedOrders);
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  const window = closing(el)!;
  expect(window.open).toBe(true);
  expect(window.busy).toBe(false);
  expect(window.refusal).toBe(t("deferred_close.unserved"));
  vi.mocked(api.readCurrentOrders).mockResolvedValue(noOrders);
  showOrders(el, noOrders);
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledTimes(2);
  expect(documents(el)).not.toBeNull();
});

it("a refusal on a bill with a dish now unserved keeps the window open saying why it is blocked, not what the server said; the next confirm reads the bill again", async () => {
  const api = deferredApi({
    closeDeferred: vi.fn().mockRejectedValue({ code: "deferred_close.conflict", status: 409 }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  vi.mocked(api.readCurrentOrders).mockResolvedValue(unservedOrders);
  showOrders(el, unservedOrders);
  await confirm(el);
  const window = closing(el)!;
  expect(window.open).toBe(true);
  expect(window.busy).toBe(false);
  expect(window.refusal).toBe(t("deferred_close.unserved"));
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(closing(el)!.refusal).toBe(t("deferred_close.unserved"));
});

const payDialog = (el: TillApp) => el.shadowRoot!.querySelector("till-bill-pay-dialog");
const deferredReason = (el: TillApp) =>
  text(payDialog(el)?.shadowRoot!.querySelector("[data-pay-deferred-reason]"));

it("Cancel closes the window and returns to Pay", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  closing(el)!.shadowRoot!.querySelector<HTMLElement>("[data-deferred-close-cancel]")!.click();
  await flush(el, 8);
  expect(closing(el)).toBeNull();
  expect(payDialog(el)).not.toBeNull();
  expect(api.closeDeferred).not.toHaveBeenCalled();
});

it("Cancel after a lost answer reads the bill again instead of returning to Pay", async () => {
  const { api, el } = await afterLostAnswer({}, closedBill());
  const reads = vi.mocked(api.getPartyBills).mock.calls.length;
  closing(el)!.shadowRoot!.querySelector<HTMLElement>("[data-deferred-close-cancel]")!.click();
  await flush(el, 8);
  expect(closing(el)).toBeNull();
  expect(payDialog(el)).toBeNull();
  expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads);
});

it("switches the button off while a card payment's outcome is unknown, saying what to do", async () => {
  const api = deferredApi({
    previewBillPayment: vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "120.00",
      tip: "0.00",
      change: null,
      charged: "120.00",
    }),
    takeBillPayment: vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal", status: 502 })
      .mockRejectedValueOnce({ code: "device.profile_changed", status: 409 }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  await openDialog(el, "rest");
  expect(deferredReason(el)).toBe("");
  await press(el, 'input[name="method"][value="card"]');
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await press(el, "[data-pay-confirm]");
  expect(api.takeBillPayment).toHaveBeenCalledTimes(2);
  const button = payDialog(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-pay-deferred]",
  )!;
  expect(button.disabled).toBe(true);
  expect(deferredReason(el)).toBe(t("deferred_close.payment_unconfirmed"));
});

it("switches the button off when Current orders could not be read, saying so", async () => {
  const api = deferredApi({
    readCurrentOrders: vi.fn().mockRejectedValue({ code: "server.internal" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  await openDialog(el, "rest");
  expect(deferredReason(el)).toBe(t("deferred_close.orders_unread"));
});

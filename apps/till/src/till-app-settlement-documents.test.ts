import { receiptLabelsFor } from "@waitron/country-packs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWED_RECEIPT_WAIT_MS, SIGN_OUT_ANSWER_WAIT_MS, TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  balanceOf,
  emit,
  flush,
  invoiceOf,
  openTable,
  resetBillPayDrafts,
  lock,
  stubApi,
  till,
  shell,
} from "../test/bill-pay-app.js";

import { transactionRow } from "../test/find-bill-fixtures.js";
import type {
  DeviceEquipmentRead,
  InvoiceDeliveryStatus,
  TillApi,
  TillProduct,
} from "./api/client.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { SessionActivity } from "./session-activity.js";
import { diag } from "./diagnostics.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem("waitron.lastOperator.till-dev");
  setLocale(originalLocale);
});

it("emails an F2 receipt only after Send and offers paper as a copy afterwards", async () => {
  const status: InvoiceDeliveryStatus = {
    current: null,
    originalCompleted: false,
    originalPrinterId: null,
    history: [],
    actions: {
      print: null,
      retryOriginal: null,
      receiptInstead: null,
      email: { designation: "original" },
    },
  };
  const api = stubApi({
    recordSale: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getReceiptEmailDeliveries: vi.fn().mockResolvedValue(status),
    requestEmailDelivery: vi.fn().mockResolvedValue({}),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  const chooser = el.shadowRoot!.querySelector("till-settlement-document-dialog")!;
  const email = chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=email-invoice]");
  expect(email).not.toBeNull();
  email!.click();
  await flush(el);
  const form = chooser.shadowRoot!.querySelector("till-invoice-email-dialog");
  expect(form).not.toBeNull();
  expect(api.requestEmailDelivery).not.toHaveBeenCalled();
  const input = form!.shadowRoot!.querySelector("wt-input")!;
  emit(input, "wt-change", { value: "guest@example.com" });
  await flush(el);
  vi.mocked(api.getReceiptEmailDeliveries).mockResolvedValue({
    ...status,
    originalCompleted: true,
    actions: { ...status.actions, email: { designation: "duplicate" } },
  });
  form!.shadowRoot!.querySelector<HTMLElement>("wt-form-actions wt-button:not([slot])")!.click();
  await flush(el);
  expect(api.requestEmailDelivery).toHaveBeenCalledExactlyOnceWith(
    "wo-4",
    "guest@example.com",
    expect.any(String),
  );
  expect(chooser.shadowRoot!.querySelector("till-invoice-email-dialog")).toBeNull();
  expect(chooser.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
  expect(chooser.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
});

it("offers documents to the active editor when changing a line settles its bill", async () => {
  const api = stubApi({
    updateOrderLine: vi.fn().mockResolvedValue({
      revision: 1,
      party: { id: "v1", revision: 4 },
      invoice: {
        ...invoiceOf("120.00"),
        tender: { method: "cash", change: "30.00" },
        payments: [
          {
            method: "cash",
            amount: "120.00",
            tip: "0.00",
            tendered: "150.00",
            change: "30.00",
            refunds: [],
          },
        ],
      },
    }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "change-line", {
    lineNo: 1,
    lineName: "Paella",
    patch: { quantity: "1" },
    revision: 0,
  });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
  expect(
    el
      .shadowRoot!.querySelector("till-settlement-document-dialog")!
      .shadowRoot!.querySelector("[data-settlement-change]"),
  ).toBeNull();
});

it("offers documents after the retained whole-payment handler completes", async () => {
  const api = stubApi({
    recordSale: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
});

it("reads an unprinted F2 original when it is opened later from Find bill", async () => {
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ workingOrderId: "wo-4" }),
  });
  await flush(el);
  expect(api.getReceiptPrintStatus).toHaveBeenCalledWith("wo-4");
  const ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  await ticket.updateComplete;
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!.click();
  await flush(el);
  expect(ticket.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
  expect(ticket.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
});

it("opens the receipt email form and retries a failed original from Find bill", async () => {
  const attempt = {
    id: "email-original",
    medium: "email" as const,
    designation: "original" as const,
    status: "failed" as const,
    failureCode: "email.transport_failed",
    requestedAt: "2026-11-11T12:00:00.000Z",
    at: null,
    personId: "p1",
    printerHold: null,
    lateSuccess: false,
  };
  const status: InvoiceDeliveryStatus = {
    current: attempt,
    history: [attempt],
    originalCompleted: false,
    originalPrinterId: null,
    actions: {
      print: null,
      receiptInstead: null,
      retryOriginal: { medium: "email" },
      email: { designation: "original" },
    },
  };
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getReceiptEmailDeliveries: vi.fn().mockResolvedValue(status),
    retryEmailDelivery: vi.fn().mockResolvedValue({}),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ workingOrderId: "wo-4" }),
  });
  await flush(el);
  const ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=email-invoice]")!.click();
  await flush(el);
  expect(ticket.shadowRoot!.querySelector("till-invoice-email-dialog")).not.toBeNull();
  emit(ticket, "invoice-email-cancel");
  await flush(el);
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=email-again]")!.click();
  await flush(el);
  expect(api.retryEmailDelivery).toHaveBeenCalledExactlyOnceWith(
    "wo-4",
    "email-original",
    expect.any(String),
  );
  expect(ticket.shadowRoot!.querySelector("[data-test=print-invoice]")).toBeNull();
  expect(ticket.shadowRoot!.querySelector("[data-test=receipt-instead]")).toBeNull();
});

it("clears another sale's print status before opening an orderless correction", async () => {
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi
      .fn()
      .mockResolvedValue({ status: "failed", jobId: "earlier-original", canRetry: true }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  const find = el.shadowRoot!.querySelector("till-find-bill-screen")!;
  emit(find, "find-transaction-open", { row: transactionRow({ workingOrderId: "wo-4" }) });
  await flush(el);
  let ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  expect(ticket.originalReceiptPrint).toMatchObject({ jobId: "earlier-original" });
  emit(ticket, "back-to-find-bill");
  await flush(el);
  vi.mocked(api.getTransactionReceipt).mockResolvedValue({
    ...invoiceOf("120.00"),
    invoiceType: "F2",
    invoiceNumber: "CORR/1",
  });
  emit(find, "find-transaction-open", {
    row: transactionRow({ saleId: "correction", workingOrderId: null }),
  });
  await flush(el);
  ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  expect(ticket.originalReceiptPrint).toBeUndefined();
  expect(ticket.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
  expect(api.getReceiptPrintStatus).toHaveBeenCalledOnce();
});

it.each([
  ["refused retry", { code: "working_order.not_open", status: 409 }],
  ["lost reply", new TypeError("Failed to fetch")],
])("recovers the settled line edit invoice after a %s", async (_reason, failure) => {
  const api = stubApi({
    updateOrderLine: vi.fn().mockRejectedValue(failure),
    getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  vi.mocked(api.getBillBalance).mockResolvedValue(
    balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
  );
  emit(order, "change-line", {
    lineNo: 1,
    lineName: "Dish",
    patch: { quantity: "1" },
    revision: 0,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull(),
  );
  expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
  expect(
    el.shadowRoot!.querySelector("till-settlement-document-dialog")!.result.invoiceNumber,
  ).toBe("F-0007");
});

it.each(["party.out_of_date", "bill.paid"])(
  "recovers the source invoice after moving dishes is refused with %s",
  async (code) => {
    const api = stubApi({
      moveDishes: vi.fn().mockRejectedValue({ code, status: 409 }),
      getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
      getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    vi.mocked(api.getBillBalance).mockResolvedValue(
      balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
    );
    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull(),
    );
    expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
    expect(
      el.shadowRoot!.querySelector("till-settlement-document-dialog")!.result.invoiceNumber,
    ).toBe("F-0007");
  },
);

it.each(["open", "invoice read fails"])(
  "keeps line-edit refusal recovery when the bill is %s",
  async (state) => {
    const api = stubApi({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "working_order.not_open", status: 409 }),
      getFiledTicket: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    if (state !== "open")
      vi.mocked(api.getBillBalance).mockResolvedValue(
        balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
      );
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Dish",
      patch: { quantity: "1" },
      revision: 0,
    });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".error")).not.toBeNull());
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).toBeNull();
    if (state === "open") expect(api.getFiledTicket).not.toHaveBeenCalled();
    else expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
  },
);

it.each([
  ["prepare", false, true],
  ["prepare", true, true],
  ["demo", true, true],
  ["live", false, false],
] as const)(
  "splits the %s settlement mark for simulator %s",
  async (onboardingIntent, simulatedCardPayment, practice) => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        onboardingIntent,
        cardProvider: simulatedCardPayment ? "simulator" : "none",
      }),
      recordSale: vi
        .fn()
        .mockResolvedValue({ ...invoiceOf("120.00"), simulatedCardPayment: false }),
      pay: vi.fn().mockResolvedValue({
        outcome: "captured",
        ticket: {
          ...invoiceOf("120.00"),
          simulatedCardPayment,
          tender: {
            method: "card",
            charged: "120.00",
            tip: "0.00",
            change: "0.00",
            reference: null,
          },
          payments: [
            {
              method: "card",
              amount: "120.00",
              tip: "0.00",
              tendered: null,
              change: null,
              refunds: [],
            },
          ],
        },
      }),
      getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    if (simulatedCardPayment) {
      emit(order, "pay-presented", { workingOrderId: "wo-4" });
      await flush(el);
      emit(el.shadowRoot!.querySelector("till-presented-pay-dialog")!, "presented-pay", {
        method: "card",
      });
    } else emit(order, "pay-tab", { method: "cash", amount: "120.00" });
    await flush(el);
    const dialog = el.shadowRoot!.querySelector("till-settlement-document-dialog")!;
    const notice = dialog.shadowRoot!.querySelector("[data-test=simulation-notice]");
    expect(notice !== null).toBe(practice);
    if (practice) {
      expect(notice!.textContent).toContain(receiptLabelsFor("es-ES").practice);
      expect(notice!.textContent!.includes(receiptLabelsFor("es-ES").noRealCharge)).toBe(
        simulatedCardPayment,
      );
    }
  },
);

const coffee: TillProduct = {
  id: "cafe",
  name: "Coffee",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  menuId: "cat-default",
  menuName: "Carta",
  menuItemId: "mi-cafe",
  menuVersionId: "v1",
};

const documents = (el: TillApp) => el.shadowRoot!.querySelector("till-settlement-document-dialog");

async function payAtCounter(el: TillApp, api: TillApi): Promise<string> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(coffee, "1");
  await el.updateComplete;
  emit(counter, "confirm-payment", { method: "cash", amount: "5" });
  await flush(el);
  expect(documents(el)).not.toBeNull();
  return vi.mocked(api.recordSale).mock.calls[0]![2] as string;
}

async function payAtTable(el: TillApp): Promise<string> {
  const order = await openTable(el);
  emit(order, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expect(documents(el)).not.toBeNull();
  return "wo-4";
}

const closeBy = {
  Done: (el: TillApp) =>
    documents(el)!.shadowRoot!.querySelector<HTMLElement>("[data-settlement-done]")!.click(),
  "the window's close": (el: TillApp) =>
    documents(el)!
      .shadowRoot!.querySelector("wt-dialog")!
      .dispatchEvent(new CustomEvent("wt-close")),
};

function closingApi(overrides: Record<string, unknown> = {}): TillApi {
  return stubApi({
    recordSale: vi.fn().mockResolvedValue(invoiceOf("1.50")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    printReceipt: vi.fn(() => new Promise<void>(() => {})),
    ...overrides,
  });
}

const surfaces = [
  ["a counter sale", payAtCounter],
  ["a table bill", (el: TillApp) => payAtTable(el)],
] as const;

describe.each(surfaces)("closing the documents window after %s", (_surface, pay) => {
  it.each(Object.keys(closeBy) as (keyof typeof closeBy)[])(
    "%s asks once for the original if it is still owed and closes without waiting",
    async (way) => {
      const api = closingApi();
      const { el } = await mountWidget<TillApp>("till-app", { api });
      const id = await pay(el, api);
      closeBy[way](el);
      await flush(el);
      expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith(id, { ifOwed: true });
      expect(documents(el)).toBeNull();
    },
  );

  it.each([
    ["unreachable", new TypeError("Failed to fetch"), { errorType: "TypeError" }],
    ["refused", { code: "storage.disk_full", status: 507 }, { code: "storage.disk_full" }],
    ["thrown without a name", "boom", { errorType: "Unknown" }],
  ])(
    "closes, and throws nothing, when the request for the original is %s",
    async (_how, failure, fields) => {
      const api = closingApi({ printReceipt: vi.fn().mockRejectedValue(failure) });
      const { el } = await mountWidget<TillApp>("till-app", { api });
      const id = await pay(el, api);
      const record = vi.spyOn(diag, "record");
      closeBy.Done(el);
      await flush(el);
      expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith(id, { ifOwed: true });
      expect(documents(el)).toBeNull();
      expect(record).toHaveBeenCalledWith("warn", "receipt.owed_request_failed", fields);
      record.mockRestore();
    },
  );

  it("asks for nothing on a device that may not print receipts", async () => {
    const api = closingApi({
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: ["take-cash"] }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await pay(el, api);
    closeBy.Done(el);
    await flush(el);
    expect(documents(el)).toBeNull();
    expect(api.printReceipt).not.toHaveBeenCalled();
  });
});

it("sends nothing and keeps the window when staff keep the basket, and sends once they discard it", async () => {
  const api = closingApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const id = await payAtCounter(el, api);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(coffee, "1");
  await el.updateComplete;
  closeBy.Done(el);
  await flush(el);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await flush(el);
  expect(documents(el)).not.toBeNull();
  expect(api.printReceipt).not.toHaveBeenCalled();

  closeBy.Done(el);
  await flush(el);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await flush(el);
  expect(documents(el)).toBeNull();
  expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith(id, { ifOwed: true });
});

const signOutBy = {
  "signing out": async (el: TillApp) => {
    emit(shell(el), "logout");
    await flush(el);
  },
  "the idle time passing": async (el: TillApp) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      emit(el, "pointerdown");
      await vi.advanceTimersByTimeAsync(300_000);
    } finally {
      vi.useRealTimers();
    }
    await flush(el);
  },
};

const signedInName = (el: TillApp) => (el as unknown as { operatorName: string }).operatorName;

it("keeps an office invoice hold visible on the PIN screen after the document window closes", async () => {
  let notices: NonNullable<DeviceEquipmentRead["notices"]> = [
    {
      owner: "office-invoices",
      key: "back-office:held",
      code: "invoice_delivery.office_print",
      severity: "warning",
      params: { printer: "Back office", reason: "held", hold: "paper_out" },
    },
  ];
  const equipment = vi.fn().mockImplementation(async () => ({ roles: [], readers: [], notices }));
  const api = closingApi({
    getTill: vi.fn().mockResolvedValue({ ...till, inactivityTimeoutSeconds: 300 }),
    getDeviceEquipment: equipment,
    printReceipt: vi.fn().mockResolvedValue(undefined),
  });
  const el = await mountForSignOut(api);
  await payAtCounter(el, api);
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  try {
    emit(el, "pointerdown");
    await vi.advanceTimersByTimeAsync(315_000);
    await el.updateComplete;
    expect(documents(el)).toBeNull();
    const notice = () => lock(el).shadowRoot!.querySelector("[data-office-invoice-notice]");
    expect(notice()?.textContent ?? "").toContain("Back office is out of paper.");

    notices = [];
    await vi.advanceTimersByTimeAsync(15_000);
    await el.updateComplete;
    expect(notice()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

function samSigningInApi(overrides: Record<string, unknown>): TillApi {
  // The screen remembers the last person to sign in, and would skip the roster.
  localStorage.clear();
  return closingApi({
    listStaff: vi.fn().mockResolvedValue([
      { personId: "p1", displayName: "Ana" },
      { personId: "p2", displayName: "Sam" },
    ]),
    login: vi.fn((personId: string) =>
      Promise.resolve({ personId, permissions: [], locale: null }),
    ),
    ...overrides,
  });
}

async function keyIn(el: TillApp, personId: string, pin: string): Promise<void> {
  const signingIn = lock(el);
  await signingIn.updateComplete;
  signingIn.shadowRoot!.querySelector<HTMLElement>(`[data-person="${personId}"]`)!.click();
  await signingIn.updateComplete;
  emit(signingIn.shadowRoot!.querySelector("till-numeric-pad")!, "wt-change", { value: pin });
  await signingIn.updateComplete;
  signingIn.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
}

const keyInSam = (el: TillApp) => keyIn(el, "p2", "5555");

async function mountForSignOut(api: TillApi): Promise<TillApp> {
  const { el } = await mountWidget<TillApp>("till-app", {
    api,
    sessionActivity: new SessionActivity(),
  });
  return el;
}

describe.each(Object.keys(signOutBy) as (keyof typeof signOutBy)[])(
  "%s with the documents window",
  (way) => {
    const idle = { ...till, inactivityTimeoutSeconds: 300 };

    it("open asks once for the original if it is still owed, before ending the session", async () => {
      const api = closingApi({
        getTill: vi.fn().mockResolvedValue(idle),
        printReceipt: vi.fn().mockResolvedValue(undefined),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      await signOutBy[way](el);
      expect(lock(el)).not.toBeNull();
      expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-4", { ifOwed: true });
      expect(vi.mocked(api.printReceipt).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(api.logout).mock.invocationCallOrder[0]!,
      );
    });

    it("open ends the session only once the request for the original has its answer", async () => {
      let answer!: () => void;
      const api = closingApi({
        getTill: vi.fn().mockResolvedValue(idle),
        printReceipt: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      await signOutBy[way](el);
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(api.printReceipt).toHaveBeenCalledOnce();
      expect(api.logout).not.toHaveBeenCalled();
      answer();
      await flush(el);
      expect(api.logout).toHaveBeenCalledOnce();
    });

    it("open ends the session after a few seconds when the request for the original has no answer", async () => {
      const api = closingApi({ getTill: vi.fn().mockResolvedValue(idle) });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        if (way === "signing out") emit(shell(el), "logout");
        else {
          emit(el, "pointerdown");
          await vi.advanceTimersByTimeAsync(300_000);
        }
        await vi.advanceTimersByTimeAsync(OWED_RECEIPT_WAIT_MS - 1);
        expect(lock(el)).not.toBeNull();
        expect(api.printReceipt).toHaveBeenCalledOnce();
        expect(api.logout).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
      } finally {
        vi.useRealTimers();
      }
      await flush(el);
      expect(api.logout).toHaveBeenCalledOnce();
    });

    it("open, with the next person signing in during the wait, ends the session before the new one starts", async () => {
      let answerReceipt!: () => void;
      let answerSignOut!: () => void;
      const api = samSigningInApi({
        getTill: vi.fn().mockResolvedValue(idle),
        printReceipt: vi.fn(() => new Promise<void>((resolve) => (answerReceipt = resolve))),
        logout: vi.fn(() => new Promise<void>((resolve) => (answerSignOut = resolve))),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      await signOutBy[way](el);
      await keyInSam(el);
      await flush(el);
      expect(api.login).not.toHaveBeenCalled();
      expect(api.logout).not.toHaveBeenCalled();

      answerReceipt();
      await flush(el);
      expect(api.logout).toHaveBeenCalledOnce();
      expect(api.login).not.toHaveBeenCalled();

      answerSignOut();
      await flush(el);
      expect(api.login).toHaveBeenCalledExactlyOnceWith("p2", "5555");
      expect(api.logout).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(signedInName(el)).toBe("Sam"));
      expect(api.logout).toHaveBeenCalledOnce();
    });

    it("open, with Cancel pressed while the sign-in waits, sends only the next person's sign-in", async () => {
      let answerReceipt!: () => void;
      const api = samSigningInApi({
        getTill: vi.fn().mockResolvedValue(idle),
        printReceipt: vi.fn(() => new Promise<void>((resolve) => (answerReceipt = resolve))),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      await signOutBy[way](el);
      await keyInSam(el);
      await flush(el);
      lock(el).shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
      answerReceipt();
      await flush(el);
      expect(api.logout).toHaveBeenCalledOnce();
      expect(api.login).not.toHaveBeenCalled();

      await keyIn(el, "p1", "1111");
      await vi.waitFor(() => expect(signedInName(el)).toBe("Ana"));
      expect(vi.mocked(api.login).mock.calls).toEqual([["p1", "1111"]]);
    });

    it("open lets the next person sign in a few seconds after a sign-out the server does not answer", async () => {
      const api = samSigningInApi({
        getTill: vi.fn().mockResolvedValue(idle),
        printReceipt: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn(() => new Promise<never>(() => {})),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        if (way === "signing out") emit(shell(el), "logout");
        else {
          emit(el, "pointerdown");
          await vi.advanceTimersByTimeAsync(300_000);
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(api.logout).toHaveBeenCalledOnce();
        await keyInSam(el);
        await vi.advanceTimersByTimeAsync(SIGN_OUT_ANSWER_WAIT_MS - 1);
        expect(api.login).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(api.login).toHaveBeenCalledExactlyOnceWith("p2", "5555");
      } finally {
        vi.useRealTimers();
      }
      await vi.waitFor(() => expect(signedInName(el)).toBe("Sam"));
    });

    it("closed, with a sign-out the server does not answer, lets the next person sign in at once", async () => {
      const api = samSigningInApi({
        getTill: vi.fn().mockResolvedValue(idle),
        logout: vi.fn(() => new Promise<never>(() => {})),
      });
      const el = await mountForSignOut(api);
      await openTable(el);
      await signOutBy[way](el);
      expect(api.logout).toHaveBeenCalledOnce();
      await keyInSam(el);
      await flush(el);
      expect(api.login).toHaveBeenCalledExactlyOnceWith("p2", "5555");
      expect(api.printReceipt).not.toHaveBeenCalled();
    });

    it("closed asks for nothing", async () => {
      const api = closingApi({ getTill: vi.fn().mockResolvedValue(idle) });
      const el = await mountForSignOut(api);
      await openTable(el);
      await signOutBy[way](el);
      expect(lock(el)).not.toBeNull();
      expect(api.logout).toHaveBeenCalled();
      expect(api.printReceipt).not.toHaveBeenCalled();
    });

    it("open asks for nothing on a device that may not print receipts", async () => {
      const api = closingApi({
        getTill: vi.fn().mockResolvedValue({ ...idle, capabilities: ["take-cash"] }),
      });
      const el = await mountForSignOut(api);
      await payAtTable(el);
      await signOutBy[way](el);
      expect(lock(el)).not.toBeNull();
      expect(api.logout).toHaveBeenCalled();
      expect(api.printReceipt).not.toHaveBeenCalled();
    });
  },
);

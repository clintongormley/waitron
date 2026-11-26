import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillApi } from "./api/client.js";
import type {
  InvoiceDeliveryAttempt,
  InvoiceDeliveryStatus,
  OriginalReceiptPrint,
} from "./api/invoice-delivery-api.js";
import type { DeviceEquipment, EquipmentItem } from "./api/device-session-api.js";
import type { TillProduct } from "./api/menu-api.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { billOptions, billRow, listPage, transactionRow } from "../test/find-bill-fixtures.js";
import {
  emit,
  flush,
  invoiceOf,
  lock,
  resetBillPayDrafts,
  shell,
  stubApi,
  till,
} from "../test/bill-pay-app.js";
import { equipmentItem, roleOf } from "../test/pay-equipment-fixtures.js";
import { liveReadFixture } from "../test/live-connection.js";
import { deferred as pending } from "../test/clock-app.js";

const office = equipmentItem("office", "Office", { kind: "a4" });
const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
const equipment = (item: EquipmentItem | null, choices = [office, bar]): DeviceEquipment => ({
  roles: [roleOf("invoice", item, choices)],
});
const delivery = (item: EquipmentItem): InvoiceDeliveryStatus => ({
  current: null,
  originalCompleted: false,
  originalPrinterId: null,
  history: [],
  actions: {
    print: {
      printers: [{ id: item.id, name: item.name, kind: item.kind! }],
      designation: "original",
    },
    retryOriginal: null,
    receiptInstead: null,
    email: null,
  },
});
const product: TillProduct = {
  id: "coffee",
  menuItemId: "coffee",
  name: "Coffee",
  customerName: { en: "Coffee" },
  pricingUnit: "each",
  unitPrice: "12.00",
  vatClass: "general",
  category: null,
  allergens: null,
  menuId: "cat-default",
  menuName: "Menu",
};
const ticket = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTicketView>(
    "till-ticket-view, till-settlement-document-dialog",
  )!;
const part = (el: TillApp, name: string) =>
  ticket(el).shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);
const initialUrl = location.href;

beforeEach(() => {
  resetBillPayDrafts();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", initialUrl);
});

async function sold(overrides: Record<string, unknown> = {}, live = true) {
  const stream = liveReadFixture();
  const api = stubApi({
    readLiveEvents: stream.read,
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      capabilities: ["take-orders", "take-cash", "print-receipt"],
    }),
    recordSale: vi.fn().mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F1" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getInvoiceDeliveries: vi.fn().mockResolvedValue(delivery(office)),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipment(office)),
    requestPrintDelivery: vi.fn().mockResolvedValue({}),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "staff", displayName: "Staff", permissions: [] });
  await flush(el);
  if (live) stream.event("ready");
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  expect(counter).not.toBeNull();
  counter.store.addProduct(product, "1");
  const id = counter.store.id;
  emit(counter, "confirm-payment", { method: "cash", amount: "12.00" });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  await openInvoice(el);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  return {
    el,
    api,
    id,
    deliveryChanged: () => stream.event("change", '[{"type":"invoice_deliveries"}]'),
  };
}

async function openInvoice(el: TillApp) {
  const chooser = el.shadowRoot!.querySelector("till-settlement-document-dialog");
  if (chooser !== null) {
    const invoice = chooser.shadowRoot!.querySelector<HTMLElement>(
      "[data-settlement-choice=invoice]",
    )!;
    if (invoice.getAttribute("aria-pressed") !== "true") {
      await userEvent.click(invoice);
      await flush(el);
    }
    return;
  }
  if (part(el, "invoice-printer-toggle")) return;
  await userEvent.click(part(el, "document-print-toggle")!);
  await userEvent.click(part(el, "document-invoice")!);
  await flush(el);
}

async function choose(el: TillApp, value: string) {
  await openInvoice(el);
  if (!ticket(el).shadowRoot!.querySelector("wt-combobox")) {
    expect(part(el, "invoice-printer-toggle")).not.toBeNull();
    await userEvent.click(part(el, "invoice-printer-toggle")!);
    await flush(el);
  }
  ticket(el)
    .shadowRoot!.querySelector("wt-combobox")!
    .dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  await flush(el);
}

const endedA4: InvoiceDeliveryAttempt = {
  id: "a4-original",
  medium: "a4",
  designation: "original",
  status: "unknown",
  failureCode: "timeout",
  requestedAt: "2026-11-25T18:22:00.000Z",
  at: null,
  personId: null,
  printerHold: null,
  printerName: "Office",
  lateSuccess: false,
};
const printedA4: InvoiceDeliveryAttempt = { ...endedA4, status: "sent", failureCode: null };

function uncertainA4(selected: EquipmentItem | null): InvoiceDeliveryStatus {
  const status = delivery(selected ?? office);
  return {
    ...status,
    current: endedA4,
    history: [endedA4],
    originalPrinterId: "office",
    actions: {
      ...status.actions,
      print: selected === null ? null : status.actions.print,
      retryOriginal: { medium: "a4" },
      retryA4: { id: "office", name: "Office", kind: "a4" },
    },
  };
}

async function findFullInvoice(
  source: "bills" | "transactions",
  overrides: Record<string, unknown>,
) {
  const result = { ...invoiceOf("12.00"), invoiceType: "F1" };
  const bill = billRow({
    orderStatus: "settled",
    state: "paid-not-handed-over",
    paid: "25.10",
    stillOwed: "0.00",
  });
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, deviceId: "dev-1" }),
    readLiveEvents: liveReadFixture().read,
    findBillOptions: vi.fn().mockResolvedValue(billOptions),
    listInvoiceCorrections: vi.fn().mockResolvedValue([]),
    listBills: vi.fn().mockResolvedValue(listPage([bill])),
    listTransactions: vi.fn().mockResolvedValue(listPage([])),
    getFindBill: vi.fn().mockResolvedValue(bill),
    getFiledTicket: vi.fn().mockResolvedValue(result),
    getTransactionReceipt: vi.fn().mockResolvedValue(result),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipment(null)),
    requestPrintDelivery: vi.fn().mockResolvedValue({}),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "staff", displayName: "Staff", permissions: [] });
  await flush(el);
  emit(shell(el), "find-bill");
  await flush(el);
  const view = el.shadowRoot!.querySelector("till-find-bill-screen")!;
  if (source === "bills") emit(view, "find-bill-open", { row: bill });
  else emit(view, "find-transaction-open", { row: transactionRow({ workingOrderId: "bill-1" }) });
  await vi.waitFor(() => expect(ticket(el)).not.toBeNull());
  await flush(el);
  return { el, api };
}

it("retries the bill's office print from Transactions and follows its outcome offline", async () => {
  const before = uncertainA4(null);
  const reads = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(before);
  fastDeliveryRereads();
  const { el, api } = await findFullInvoice("transactions", {
    getInvoiceDeliveries: reads,
    requestPrintDelivery: vi.fn(async () => {
      const current = { ...endedA4, id: "retry", status: "queued", failureCode: null };
      reads.mockResolvedValue({
        ...before,
        current,
        history: [current, endedA4],
        actions: { ...before.actions, retryA4: undefined, retryOriginal: null },
      });
      return {};
    }),
  });
  await vi.waitFor(() =>
    expect(part(el, "delivery-status")?.textContent ?? "").toContain("Office stopped answering"),
  );
  expect(part(el, "invoice-printer-toggle")?.textContent).toContain("Office · A4");
  const statusBox = part(el, "original-delivery")!;
  const warningBorder = getComputedStyle(statusBox).borderTopColor;
  expect(statusBox.getBoundingClientRect().top).toBeGreaterThan(
    part(el, "invoice-printer-toggle")!.getBoundingClientRect().bottom,
  );
  const print = part(el, "print-invoice")!;
  expect(print.textContent?.trim()).toBe("Print it again");
  await userEvent.click(print);
  expect(api.requestPrintDelivery).toHaveBeenCalledExactlyOnceWith(
    "bill-1",
    "office",
    expect.any(String),
  );
  await vi.waitFor(() => {
    expect(part(el, "delivery-status")?.textContent).toBe("Waiting for the office printer.");
    expect(part(el, "invoice-printer-toggle")?.textContent).toContain("Office · A4");
  });
  reads.mockResolvedValue({
    ...before,
    current: printedA4,
    originalCompleted: true,
    history: [printedA4, endedA4],
    actions: { ...before.actions, retryA4: undefined, retryOriginal: null },
  });
  await vi.waitFor(() => {
    expect(part(el, "original-delivery")?.textContent).toContain("Full invoice delivered");
    expect(part(el, "print-invoice")).toBeNull();
  });
  expect(getComputedStyle(part(el, "original-delivery")!).borderTopColor).not.toBe(warningBorder);
  expect(part(el, "refresh-receipt")).toBeNull();
  await userEvent.click(part(el, "document-print-toggle")!);
  await userEvent.click(part(el, "document-invoice")!);
  expect(part(el, "invoice-printer-toggle")?.textContent).toMatch(/Invoice printer:\s*None/);
  expect(part(el, "print-invoice")).toBeNull();
});

it("keeps one invoice print action across the document and printer choices in Bills", async () => {
  let selected: EquipmentItem | null = null;
  const confirmation = pending<InvoiceDeliveryStatus>();
  const reads = vi.fn().mockResolvedValue(uncertainA4(null));
  const { el, api } = await findFullInvoice("bills", {
    getDeviceEquipment: vi.fn(async () => equipment(selected)),
    getInvoiceDeliveries: reads,
    setDeviceEquipment: vi.fn(async () => {
      selected = bar;
      reads
        .mockRejectedValueOnce(new Error("offer read failed"))
        .mockReturnValue(confirmation.promise);
      return equipment(bar);
    }),
  });
  const count = (name: string) =>
    ticket(el).shadowRoot!.querySelectorAll(`[data-test=${name}]`).length;
  expect(part(el, "print-invoice")?.textContent?.trim()).toBe("Print it again");
  await userEvent.click(part(el, "document-print-toggle")!);
  await userEvent.click(part(el, "document-receipt")!);
  expect(part(el, "delivery-status")?.textContent ?? "").toContain("Office stopped answering");
  expect(part(el, "print-invoice")).toBeNull();
  const equipmentReads = vi.mocked(api.getDeviceEquipment).mock.calls.length;
  await userEvent.click(part(el, "document-print-toggle")!);
  expect(api.getDeviceEquipment).toHaveBeenCalledTimes(equipmentReads + 1);
  expect(part(el, "invoice-printer-toggle")?.textContent).toContain("Office · A4");
  expect(part(el, "print-invoice")?.textContent?.trim()).toBe("Print it again");
  await userEvent.click(part(el, "document-print-toggle")!);
  await userEvent.click(part(el, "document-invoice")!);
  expect(count("invoice-printer-toggle")).toBe(1);
  expect(count("print-invoice")).toBe(1);
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")).not.toBeNull();
  await userEvent.click(part(el, "document-back")!);
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")).toBeNull();
  await choose(el, bar.id);
  expect(part(el, "print-invoice")?.hasAttribute("disabled") ?? true).toBe(true);
  await userEvent.click(part(el, "document-receipt")!);
  await userEvent.click(part(el, "document-print-toggle")!);
  expect(part(el, "print-invoice")?.hasAttribute("disabled") ?? true).toBe(true);
  confirmation.resolve(uncertainA4(bar));
  await vi.waitFor(() =>
    expect(part(el, "print-invoice")?.textContent?.trim()).toBe("Print on Bar"),
  );
  await userEvent.click(part(el, "print-invoice")!);
  expect(api.requestPrintDelivery).toHaveBeenCalledExactlyOnceWith(
    "bill-1",
    "bar",
    expect.any(String),
  );
});

it.each([null, bar])("uses the invoice's A4 printer with equipment %j", async (selected) => {
  const before = uncertainA4(selected);
  const reads = vi.fn().mockResolvedValue(before);
  const { el, api, id } = await sold({
    getDeviceEquipment: vi.fn().mockResolvedValue(equipment(selected, [bar])),
    getInvoiceDeliveries: reads,
    requestPrintDelivery: vi.fn(async () => {
      const current = { ...endedA4, id: "retry", status: "queued", failureCode: null };
      reads.mockResolvedValue({
        ...before,
        current,
        history: [current, endedA4],
        actions: { ...before.actions, print: null, retryOriginal: null, retryA4: undefined },
      });
      return {};
    }),
  });
  expect(part(el, "invoice-printer-toggle")!.textContent).toContain("Office · A4");
  expect(part(el, "original-delivery")!.textContent).toContain(
    "Full invoice may not have been delivered",
  );
  expect(part(el, "delivery-status")!.textContent).toBe(
    "Office stopped answering. Check whether it printed.",
  );
  expect(part(el, "refresh-receipt")).toBeNull();
  const print = part(el, "print-invoice")!;
  expect(print.textContent?.trim()).toBe("Print it again");
  await userEvent.click(print);
  expect(api.requestPrintDelivery).toHaveBeenCalledExactlyOnceWith(
    id,
    "office",
    expect.any(String),
  );
  await vi.waitFor(() =>
    expect(part(el, "delivery-status")?.textContent).toBe("Waiting for the office printer."),
  );
  expect(part(el, "print-invoice")).toBeNull();
  expect(part(el, "invoice-printer-toggle")!.textContent).toContain("Office · A4");
});

function fastDeliveryRereads() {
  const setTimeout = globalThis.setTimeout;
  const timers = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((run, delay, ...args) =>
      setTimeout(run, delay === 5_000 ? 100 : delay, ...args),
    );
  onTestFinished(() => void timers.mockRestore());
}

it.each([null, bar])(
  "recovers a failed read and follows A4 and email with equipment %j",
  async (selected) => {
    const a4 = uncertainA4(selected);
    const email: InvoiceDeliveryAttempt = {
      ...endedA4,
      id: "email-copy",
      designation: "duplicate",
      medium: "email",
      printerName: undefined,
      status: "sending",
      failureCode: null,
    };
    fastDeliveryRereads();
    const getInvoiceDeliveries = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue(a4);
    const { el, deliveryChanged } = await sold({
      getInvoiceDeliveries,
      getDeviceEquipment: vi.fn().mockResolvedValue(equipment(selected, [bar])),
    });
    await vi.waitFor(() =>
      expect(part(el, "delivery-status")?.textContent ?? "").toContain("Office stopped answering"),
    );
    expect(part(el, "delivery-read-failed")).toBeNull();
    const ordinary = a4.actions.print;
    const completed = {
      ...a4,
      current: printedA4,
      history: [printedA4],
      originalCompleted: true,
      actions: {
        ...a4.actions,
        retryOriginal: null,
        retryA4: undefined,
        print: ordinary === null ? null : { ...ordinary, designation: "duplicate" },
      },
    };
    getInvoiceDeliveries.mockResolvedValue(completed);
    await vi.waitFor(() => expect(part(el, "delivery-status")?.textContent).toBe("Printed on A4."));
    expect(part(el, "refresh-receipt")).toBeNull();
    expect(part(el, "invoice-printer-toggle")?.textContent).toContain(
      selected === null ? "Office · A4" : "Bar · receipt paper",
    );
    expect(part(el, "print-invoice")?.textContent?.trim()).toBe(
      selected === null ? undefined : "Print a copy on Bar",
    );
    const sending = { ...completed, current: email, history: [email, printedA4] };
    getInvoiceDeliveries.mockResolvedValue(sending);
    deliveryChanged();
    await vi.waitFor(() =>
      expect(part(el, "delivery-status")?.textContent ?? "").toContain("Sending the invoice"),
    );
    getInvoiceDeliveries.mockResolvedValue({
      ...sending,
      current: { ...email, status: "sent" },
    });
    await vi.waitFor(() =>
      expect(part(el, "delivery-status")?.textContent ?? "").toContain("Sent by email"),
    );
    expect(part(el, "refresh-receipt")).toBeNull();
  },
);

it("follows a later delivery after failure without a live connection", async () => {
  const state = uncertainA4(null);
  const first = { ...endedA4, status: "failed", failureCode: "printer_unreachable" };
  const getInvoiceDeliveries = vi
    .fn()
    .mockResolvedValue({ ...state, current: first, history: [first] });
  fastDeliveryRereads();
  const { el } = await sold(
    {
      getInvoiceDeliveries,
      getDeviceEquipment: vi.fn().mockResolvedValue(equipment(null, [bar])),
    },
    false,
  );
  expect(part(el, "delivery-status")?.textContent).toBe("Not delivered.");
  getInvoiceDeliveries.mockResolvedValue({
    ...state,
    current: { ...endedA4, id: "new-attempt" },
  });
  await vi.waitFor(() =>
    expect(part(el, "delivery-status")?.textContent).toContain("Office stopped answering"),
  );
});

it("retries a failed original print read beside a completed email", async () => {
  const original = { ...printedA4, id: "emailed", medium: "email", printerName: undefined };
  const firstRead = pending<OriginalReceiptPrint>();
  const getReceiptPrintStatus = vi
    .fn()
    .mockReturnValueOnce(firstRead.promise)
    .mockResolvedValue({ status: "not_queued" });
  fastDeliveryRereads();
  const { el } = await sold({
    getReceiptPrintStatus,
    getInvoiceDeliveries: vi.fn().mockResolvedValue({
      ...delivery(office),
      current: original,
      history: [original],
      originalCompleted: true,
    }),
  });
  expect(part(el, "delivery-status")?.textContent).toBe("Sent by email.");
  firstRead.reject(new Error("read failed"));
  await vi.waitFor(() =>
    expect(part(el, "original-delivery")?.textContent).toContain("Full invoice delivered"),
  );
  expect(getReceiptPrintStatus).toHaveBeenCalledTimes(2);
});

it("saves a printer selection, waits for its fresh offer, and prints once to that printer", async () => {
  let selected = office;
  let saved!: () => void;
  const setDeviceEquipment = vi.fn<TillApi["setDeviceEquipment"]>(
    () =>
      new Promise<DeviceEquipment>((resolve) => {
        saved = () => {
          selected = bar;
          resolve(equipment(bar));
        };
      }),
  );
  const { deliveryChanged, el, api, id } = await sold({
    setDeviceEquipment,
    getInvoiceDeliveries: vi.fn(async () => uncertainA4(selected)),
  });
  await choose(el, bar.id);
  expect(setDeviceEquipment).toHaveBeenCalledOnce();
  expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
    role: "invoice",
    selection: { id: "bar" },
    via: "list",
  });
  deliveryChanged();
  await flush(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  emit(ticket(el), "print-invoice");
  expect(api.requestPrintDelivery).not.toHaveBeenCalled();
  saved();
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
  expect(api.requestPrintDelivery).not.toHaveBeenCalled();
  await userEvent.click(part(el, "print-invoice")!);
  expect(api.requestPrintDelivery).toHaveBeenCalledOnce();
  expect(vi.mocked(api.requestPrintDelivery).mock.calls[0]).toEqual([
    id,
    "bar",
    expect.any(String),
  ]);
  expect(api.recordSale).toHaveBeenCalledOnce();
});

it("returns to the invoice's printer when the till choice resolves to None", async () => {
  let selected: EquipmentItem | null = office;
  const { el } = await sold({
    getDeviceEquipment: vi.fn(async () => equipment(selected)),
    getInvoiceDeliveries: vi.fn(async () => uncertainA4(selected)),
    setDeviceEquipment: vi.fn(async (change) => {
      selected = change.selection === "default" ? null : bar;
      return equipment(selected);
    }),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.textContent?.trim()).toBe("Print on Bar");
  await choose(el, "");
  expect(part(el, "invoice-printer-toggle")!.textContent).toContain("Office · A4");
  expect(part(el, "print-invoice")!.textContent?.trim()).toBe("Print it again");
});

it("retries a refused preference without printing and then enables the saved destination", async () => {
  let selected = office;
  const setDeviceEquipment = vi
    .fn()
    .mockRejectedValueOnce({ status: 400, code: "printer.not_found" })
    .mockImplementation(async () => {
      selected = bar;
      return equipment(bar);
    });
  const { el, api } = await sold({
    setDeviceEquipment,
    getInvoiceDeliveries: vi.fn(async () => delivery(selected)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  expect(part(el, "invoice-printer-save-retry")).not.toBeNull();
  await userEvent.click(part(el, "invoice-printer-save-retry")!);
  await flush(el);
  expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
  expect(api.requestPrintDelivery).not.toHaveBeenCalled();
});

it("keeps Print held after a successful save whose refresh failed, then recovers", async () => {
  const getInvoiceDeliveries = vi
    .fn()
    .mockResolvedValueOnce(delivery(office))
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValue(delivery(bar));
  const { el, api } = await sold({
    getInvoiceDeliveries,
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  emit(ticket(el), "print-invoice");
  expect(api.requestPrintDelivery).not.toHaveBeenCalled();
  await userEvent.click(part(el, "invoice-printer-save-retry")!);
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it("holds Print until the second of two queued choices has saved", async () => {
  const first = pending<DeviceEquipment>();
  const second = pending<DeviceEquipment>();
  let selected = office;
  const setDeviceEquipment = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { el, api } = await sold({
    setDeviceEquipment,
    getInvoiceDeliveries: vi.fn(async () => delivery(selected)),
  });
  await choose(el, bar.id);
  await choose(el, office.id);
  expect(setDeviceEquipment).toHaveBeenCalledOnce();
  selected = bar;
  first.resolve(equipment(bar));
  await flush(el);
  expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  selected = office;
  second.resolve(equipment(office));
  await flush(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
  expect(api.requestPrintDelivery).not.toHaveBeenCalled();
});

it("keeps the new printer when a delivery read started before the save answers later", async () => {
  const old = pending<InvoiceDeliveryStatus>();
  const getInvoiceDeliveries = vi
    .fn()
    .mockResolvedValueOnce(delivery(office))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(delivery(bar));
  const { deliveryChanged, el } = await sold({
    getInvoiceDeliveries,
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
  });
  deliveryChanged();
  await flush(el);
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  old.resolve(delivery(office));
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it("accepts a saved preference while an existing delivery is busy without a false save refusal", async () => {
  const busy = delivery(bar);
  busy.actions.print = null;
  const getInvoiceDeliveries = vi
    .fn()
    .mockResolvedValueOnce(delivery(office))
    .mockResolvedValueOnce(busy)
    .mockResolvedValue(delivery(bar));
  const { deliveryChanged, el } = await sold({
    getInvoiceDeliveries,
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")).toBeNull();
  expect(part(el, "invoice-printer-save-retry")).toBeNull();
  deliveryChanged();
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it.each(["Done", "logout"])(
  "a pending choice may save after %s without changing the new screen",
  async (leave) => {
    const saving = pending<DeviceEquipment>();
    const { el, api } = await sold({ setDeviceEquipment: vi.fn().mockReturnValue(saving.promise) });
    await choose(el, bar.id);
    if (leave === "logout") emit(shell(el), "logout");
    else emit(ticket(el), "settlement-close");
    await flush(el);
    expect(ticket(el)).toBeNull();
    const reads = vi.mocked(api.getInvoiceDeliveries).mock.calls.length;
    saving.resolve(equipment(bar));
    await flush(el);
    expect(ticket(el)).toBeNull();
    expect(api.getInvoiceDeliveries).toHaveBeenCalledTimes(reads);
    expect(api.requestPrintDelivery).not.toHaveBeenCalled();
  },
);

it.each(["overtaken", "failed"])(
  "a live delivery change recovers a %s post-save read without saving again",
  async (outcome) => {
    const postSave = pending<InvoiceDeliveryStatus>();
    const reads = vi.fn().mockResolvedValueOnce(delivery(office));
    if (outcome === "failed") reads.mockRejectedValueOnce(new Error("read failed"));
    else reads.mockReturnValueOnce(postSave.promise);
    reads.mockResolvedValue(delivery(bar));
    const { deliveryChanged, el, api } = await sold({
      getInvoiceDeliveries: reads,
      setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
    });
    await choose(el, bar.id);
    deliveryChanged();
    await flush(el);
    postSave.resolve(delivery(bar));
    await flush(el);
    expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
    expect(part(el, "invoice-printer-save-retry")).toBeNull();
    expect(api.setDeviceEquipment).toHaveBeenCalledOnce();
  },
);

it("explains a deleted printer even when folded, and refreshes the row's choices", async () => {
  const saving = pending<DeviceEquipment>();
  let deleted = false;
  const { el } = await sold({
    getDeviceEquipment: vi.fn(async () =>
      deleted ? { roles: [roleOf("invoice", office, [office])] } : equipment(office),
    ),
    setDeviceEquipment: vi.fn(async () => {
      await saving.promise;
      deleted = true;
      throw { status: 400, code: "printer.not_found" };
    }),
  });
  await choose(el, bar.id);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  saving.resolve(equipment(bar));
  await flush(el);
  expect(ticket(el).shadowRoot!.textContent).toContain(codeMessage("printer.not_found"));
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  expect(
    ticket(el)
      .shadowRoot!.querySelector("wt-combobox")!
      .options.some((item) => item.value === "bar"),
  ).toBe(false);
});

it("reopening shows the saved choice after Equipment changed elsewhere", async () => {
  let selected = office;
  const { el } = await sold({
    setDeviceEquipment: vi.fn(async () => {
      selected = bar;
      return equipment(bar);
    }),
    getDeviceEquipment: vi.fn(async () => equipment(selected)),
    getInvoiceDeliveries: vi.fn(async () => delivery(selected)),
  });
  await choose(el, bar.id);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  selected = office;
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")!.value).toBe("office");
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
});

it("an Equipment dialog choice updates the invoice row and its Print destination", async () => {
  let selected = office;
  const { el } = await sold({
    getDeviceEquipment: vi.fn(async () => equipment(selected)),
    getInvoiceDeliveries: vi.fn(async () => delivery(selected)),
    setDeviceEquipment: vi.fn(async () => {
      selected = bar;
      return equipment(bar);
    }),
  });
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  emit(shell(el), "open-equipment");
  await flush(el);
  const dialog = el.shadowRoot!.querySelector("till-equipment-dialog")!;
  emit(dialog, "equipment-change", { role: "invoice", selection: { id: "bar" }, via: "list" });
  await flush(el);
  emit(dialog, "close");
  await flush(el);
  expect(part(el, "invoice-printer-toggle")!.textContent).toContain("Bar");
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
});

it("a delivery read failure without a new choice keeps the last Print available", async () => {
  const { deliveryChanged, el } = await sold({
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValueOnce(delivery(office))
      .mockRejectedValue(new Error("read failed")),
  });
  deliveryChanged();
  await flush(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it("holds Print when the offer differs from the saved printer, then recovers on a live delivery change", async () => {
  const { deliveryChanged, el } = await sold({
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValueOnce(delivery(office))
      .mockResolvedValueOnce(delivery(office))
      .mockResolvedValue(delivery(bar)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  deliveryChanged();
  await flush(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it("a new invoice clears the old hold and ignores the old invoice's delayed status", async () => {
  const old = pending<InvoiceDeliveryStatus>();
  const { el } = await sold({
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValueOnce(delivery(office))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(delivery(office)),
  });
  await choose(el, bar.id);
  emit(ticket(el), "settlement-close");
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(product, "1");
  emit(counter, "confirm-payment", { method: "cash", amount: "12.00" });
  await flush(el);
  await openInvoice(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
  old.resolve(delivery(bar));
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Office");
});

it("keeps the latest row read when an older opening answers last", async () => {
  const older = pending<DeviceEquipment>();
  const newer = pending<DeviceEquipment>();
  const { el, api } = await sold();
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  vi.mocked(api.getDeviceEquipment)
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await userEvent.click(part(el, "invoice-printer-toggle")!);
  await flush(el);
  newer.resolve(equipment(bar));
  await flush(el);
  older.resolve(equipment(office));
  await flush(el);
  expect(part(el, "invoice-printer-toggle")!.textContent).toContain("Bar");
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")!.value).toBe("bar");
});

it("Back to Find a bill leaves a pending device save without changing the returned page", async () => {
  const saving = pending<DeviceEquipment>();
  const { el, api } = await sold({
    setDeviceEquipment: vi.fn().mockReturnValue(saving.promise),
    findBillOptions: vi.fn().mockResolvedValue(billOptions),
    listInvoiceCorrections: vi.fn().mockResolvedValue([]),
    listBills: vi.fn().mockResolvedValue(listPage([])),
    listTransactions: vi.fn().mockResolvedValue(listPage([])),
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F1" }),
  });
  emit(ticket(el), "settlement-close");
  await flush(el);
  emit(shell(el), "find-bill");
  await flush(el);
  const view = el.shadowRoot!.querySelector("till-find-bill-screen")!;
  emit(view, "find-transaction-open", { row: transactionRow({ workingOrderId: "wo-history" }) });
  await flush(el);
  await choose(el, bar.id);
  await userEvent.click(
    ticket(el).shadowRoot!.querySelector<HTMLElement>("[data-back-to-find-bill]")!,
  );
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-find-bill-screen")).toBe(view);
  const reads = vi.mocked(api.getInvoiceDeliveries).mock.calls.length;
  saving.resolve(equipment(bar));
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-find-bill-screen")).toBe(view);
  expect(api.getInvoiceDeliveries).toHaveBeenCalledTimes(reads);
});

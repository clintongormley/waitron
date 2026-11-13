import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  DeviceEquipment,
  EquipmentItem,
  InvoiceDeliveryStatus,
  TillApi,
  TillProduct,
} from "./api/client.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { billOptions, listPage, transactionRow } from "../test/find-bill-fixtures.js";
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

const office = equipmentItem("office", "Office", { kind: "a4" });
const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
const equipment = (item: EquipmentItem): DeviceEquipment => ({
  roles: [roleOf("invoice", item, [office, bar])],
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
  catalogueId: "cat-default",
  catalogueName: "Menu",
};
const ticket = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTicketView>(
    "till-ticket-view, till-settlement-document-dialog",
  )!;
const part = (el: TillApp, name: string) =>
  ticket(el).shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);
const initialUrl = location.href;
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetBillPayDrafts();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", initialUrl);
});

async function sold(overrides: Record<string, unknown> = {}) {
  const api = stubApi({
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
  return { el, api, id };
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
  const { el, api, id } = await sold({
    setDeviceEquipment,
    getInvoiceDeliveries: vi.fn(async () => delivery(selected)),
  });
  await choose(el, bar.id);
  expect(setDeviceEquipment).toHaveBeenCalledOnce();
  expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
    role: "invoice",
    selection: { id: "bar" },
    via: "list",
  });
  emit(ticket(el), "refresh-receipt");
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
  const { el } = await sold({
    getInvoiceDeliveries,
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
  });
  emit(ticket(el), "refresh-receipt");
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
  const { el } = await sold({
    getInvoiceDeliveries,
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")).toBeNull();
  expect(part(el, "invoice-printer-save-retry")).toBeNull();
  emit(ticket(el), "refresh-receipt");
  await flush(el);
  expect(part(el, "print-invoice")!.textContent!.trim()).toBe("Print on Bar");
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it.each(["None", "logout"])(
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
  "Check print recovers a %s post-save read without saving again",
  async (outcome) => {
    const postSave = pending<InvoiceDeliveryStatus>();
    const reads = vi.fn().mockResolvedValueOnce(delivery(office));
    if (outcome === "failed") reads.mockRejectedValueOnce(new Error("read failed"));
    else reads.mockReturnValueOnce(postSave.promise);
    reads.mockResolvedValue(delivery(bar));
    const { el, api } = await sold({
      getInvoiceDeliveries: reads,
      setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
    });
    await choose(el, bar.id);
    emit(ticket(el), "refresh-receipt");
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
  const { el } = await sold({
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValueOnce(delivery(office))
      .mockRejectedValue(new Error("read failed")),
  });
  emit(ticket(el), "refresh-receipt");
  await flush(el);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(false);
});

it("holds Print when the offer differs from the saved printer, then recovers on Check print", async () => {
  const { el } = await sold({
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(bar)),
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValueOnce(delivery(office))
      .mockResolvedValueOnce(delivery(office))
      .mockResolvedValue(delivery(bar)),
  });
  await choose(el, bar.id);
  expect(part(el, "print-invoice")!.hasAttribute("disabled")).toBe(true);
  emit(ticket(el), "refresh-receipt");
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

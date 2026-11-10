import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { formatEquipmentCode } from "@waitron/shared";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { CapabilityFlag } from "./layout.js";
import type {
  AllocationPreview,
  BillBalance,
  BillPaymentRequest,
  BillPaymentResult,
  BillPaymentView,
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  PartyBill,
  RoleEquipment,
  TillApi,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import type { TillPayEquipment } from "./widgets/pay-equipment.js";
import type { PresentedPayDetail, TillPresentedPayDialog } from "./widgets/presented-pay-dialog.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import { FakeNdefReader, installNfc, PRINTER_ID, READER_ID } from "../test/equipment-nfc.js";
import { billOptions, billRow, listPage } from "../test/find-bill-fixtures.js";
import { cameraFilming } from "../test/qr-camera.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import type { BillRow } from "./api/find-bill-types.js";
import { SUBMIT_RETRY_PAUSE_MS, TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  balanceOf,
  BAR_PRINTER,
  bill120,
  billOf,
  cash,
  dialog,
  discardUnsavedLeave,
  drafts,
  floor,
  emit,
  equipmentItem,
  equipmentWith,
  SECOND_READER,
  lock,
  mesa,
  money,
  offers,
  paymentOf,
  roleOf,
  shell,
  tableOrder,
  flush,
  inDialog,
  invoiceOf as saleOf,
  line,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  showBillFooter,
  stubApi,
  takenOf,
  text,
  till,
  type,
} from "../test/bill-pay-app.js";
import { openTableMenu } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import { resized } from "./screens/till-table-order-screen.test-helpers.js";

let api: TillApi;

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

const sent = (): BillPaymentRequest[] =>
  vi.mocked(api.takeBillPayment).mock.calls.map(([, request]) => request);

/** The server always names an invoice's type (`readReceiptIssuer`). */
const invoiceOf = (total: string, invoiceType: "F1" | "F2"): TillSaleResult => ({
  ...saleOf(total),
  invoiceType,
});

const wholeCard: AllocationPreview = {
  kind: "allocated",
  choice: null,
  applied: "120.00",
  tip: "0.00",
  change: null,
  charged: "120.00",
};

const phoneCapabilities = [
  "print-receipt",
  "integrated-card-payment",
  "take-cash",
  "hand-keyed-card-payment",
] as CapabilityFlag[];

function onPhone(overrides: Record<string, unknown> = {}, tillOver: Record<string, unknown> = {}) {
  return {
    getTill: vi.fn().mockResolvedValue({
      ...till,
      formFactor: "phone-portrait",
      capabilities: phoneCapabilities,
      cardProvider: "sumup_cloud",
      activeReaders: [{ id: "r2", name: "Lector 2", provider: "sumup_cloud" }],
      defaultReaderId: "r2",
      ...tillOver,
    }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "d1", name: "Móvil", formFactor: "phone-portrait" }),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(SECOND_READER)),
    previewBillPayment: vi.fn().mockResolvedValue(wholeCard),
    takeBillPayment: vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { method: "card", entry: "reader", applied: "120.00", tendered: null, change: null },
          { received: "120.00", outstanding: "0.00", status: "settled" },
        ),
      ),
    ...overrides,
  };
}

async function openPhoneTable(el: TillApp) {
  const order = await openTable(el);
  await showBillFooter(order);
  return order;
}

const inOrder = (order: Element, selector: string) =>
  order.shadowRoot!.querySelector<HTMLElement>(selector);

async function pressPaySheet(el: TillApp, order: Element): Promise<void> {
  inOrder(order, "[data-pay-sheet]")!.click();
  await flush(el);
}

const THIRD_READER = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });
const FOURTH_READER = equipmentItem("c45f83b1-3333-4333-8333-333333333333", "Lector 4", {
  portable: true,
  provider: "sumup",
});
const MARC = { deviceId: "d2", deviceName: "Móvil 2", personName: "Marc" };
const presented = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillPresentedPayDialog>("till-presented-pay-dialog");
const inPresented = (el: TillApp, selector: string) =>
  presented(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
const continueButton = (el: TillApp) => inDialog(el, "[data-pay-continue]")!;
const ticketView = (el: TillApp) => el.shadowRoot!.querySelector("till-ticket-view");
const documentChoice = (el: TillApp) =>
  el.shadowRoot!.querySelector("till-settlement-document-dialog");

async function closeDocuments(el: TillApp): Promise<void> {
  documentChoice(el)!.shadowRoot!.querySelector<HTMLElement>("[data-settlement-none]")!.click();
  await flush(el);
}

async function finishFromTable(el: TillApp): Promise<void> {
  await closeDocuments(el);
  const order = tableOrder(el);
  await openTableMenu(order);
  await userEvent.click(inOrder(order, "[data-table-menu] [data-finish-table]")!);
  await flush(el);
}

async function rowSummary(el: TillApp): Promise<string> {
  const row = inDialog(el, "till-pay-equipment") as
    (HTMLElement & { updateComplete: Promise<unknown> }) | null;
  await row!.updateComplete;
  return text(row!.shadowRoot!.querySelector("[data-pay-equipment-summary]"));
}

beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);

describe("till-app: paying a table from a handheld", () => {
  it("Pay opens the sheet on the whole bill, naming the phone's reader, and reads the equipment again", async () => {
    const overrides = onPhone();
    const { el } = await mountApp(overrides);
    const order = await openPhoneTable(el);
    const readsBefore = overrides.getDeviceEquipment.mock.calls.length;

    await pressPaySheet(el, order);

    expect(dialog(el)).not.toBeNull();
    expect(dialog(el)!.handheld).toBe(true);
    expect(dialog(el)!.tableName).toBe(t("floor.table_title").replace("{table}", "4"));
    expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", "whole");
    expect(await rowSummary(el)).toContain("Lector 2");
    expect(overrides.getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
  });

  it("a whole-bill card payment, from the dialog's own Take payment, charges the row's reader", async () => {
    const { el } = await mountApp(onPhone());
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ method: "card", entry: "reader", readerId: "r2" });
  });

  it("Whole bill on a partly paid bill sends what the bill still owes", async () => {
    const owed: AllocationPreview = { ...wholeCard, applied: "70.00", charged: "70.00" };
    const { el } = await mountApp(
      onPhone({
        getPartyBills: vi
          .fn()
          .mockResolvedValue([billOf({ outstanding: "70.00", hasPayments: true })]),
        getBillBalance: vi
          .fn()
          .mockResolvedValue(balanceOf({ received: "50.00", outstanding: "70.00" })),
        previewBillPayment: vi.fn().mockResolvedValue(owed),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", "whole");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ kind: "contribution", amount: "70.00" });
  });

  it("a practice phone pays through the instant simulator without seeded hardware", async () => {
    const { el } = await mountApp(
      onPhone(
        {
          getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(null)),
          previewBillPayment: vi
            .fn()
            .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" }),
          takeBillPayment: vi
            .fn()
            .mockResolvedValue(
              takenOf(
                { method: "card", entry: "reader", applied: "40.00", tip: "0.00", change: null },
                { received: "40.00", outstanding: "80.00" },
              ),
            ),
        },
        {
          cardProvider: "simulator",
          activeReaders: [],
        },
      ),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    expect(dialog(el)!.fixedReader).toEqual({ name: t("card.instant_simulator") });
    await press(el, 'input[name="way"][value="contribution"]');
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      method: "card",
      entry: "reader",
      simulationOutcome: "captured",
    });
    expect(sent()[0]).not.toHaveProperty("readerId");
    expect(text(inDialog(el, "[data-pay-taken-reader]"))).toBe(
      t("bill_pay.taken_on_reader")
        .replace("{amount}", money("40.00"))
        .replace("{reader}", t("card.instant_simulator")),
    );
  });

  it("a partly paid bill keeps its amount lines and bill choices beside one Pay button", async () => {
    const partly = billOf({ outstanding: "70.00", hasPayments: true });
    const { el } = await mountApp(
      onPhone(
        {
          getPartyBills: vi.fn().mockResolvedValue([partly]),
          getBillBalance: vi
            .fn()
            .mockResolvedValue(balanceOf({ received: "50.00", outstanding: "70.00" })),
        },
        { fullInvoices: true },
      ),
    );
    const order = await openPhoneTable(el);

    expect(inOrder(order, "[data-bill-payments] .amount")).not.toBeNull();
    expect(inOrder(order, "[data-choose-bill-invoice]:not([data-table-menu] *)")).not.toBeNull();
    expect(order.shadowRoot!.querySelectorAll("[data-pay-sheet]")).toHaveLength(1);
    expect(inOrder(order, "[data-pay-rest]")).toBeNull();
    expect(inOrder(order, "[data-open-bill-pay]")).toBeNull();
  });

  it("a presented bill draws one Pay button in place of today's pay card", async () => {
    const { el } = await mountApp(
      onPhone({ getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]) }),
    );
    const order = await openPhoneTable(el);

    expect(inOrder(order, "till-tender-pay")).toBeNull();
    expect(order.shadowRoot!.querySelectorAll("[data-pay-sheet]")).toHaveLength(1);
  });
});

describe("a presented bill on a handheld", () => {
  const placedBill = billOf({ status: "placed", receiptAvailable: true });
  const ticket = () => invoiceOf("120.00", "F2");
  const editOfBill = expect.objectContaining({ billId: "wo-4" });

  async function openPresented(overrides: Record<string, unknown> = {}) {
    const stubs = onPhone({
      getPartyBills: vi.fn().mockResolvedValue([placedBill]),
      pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: ticket() }),
      collectOrder: vi.fn().mockResolvedValue(ticket()),
      ...overrides,
    });
    const { el } = await mountApp(stubs);
    const order = await openPhoneTable(el);
    const readsBefore = stubs.getDeviceEquipment.mock.calls.length;
    await pressPaySheet(el, order);
    await presented(el)?.updateComplete;
    return { el, order, stubs, readsBefore };
  }

  async function sheetMessage(el: TillApp): Promise<string> {
    await presented(el)!.updateComplete;
    return presented(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      "wt-form-actions",
    )!.error;
  }

  async function takeOnReader(el: TillApp): Promise<void> {
    inPresented(el, "[data-presented-pay-take]")!.click();
    await flush(el);
  }

  async function payFromSheet(el: TillApp, detail: PresentedPayDetail): Promise<void> {
    emit(presented(el)!, "presented-pay", detail);
    await flush(el);
  }

  it("a sheet opened before another person's dish was read collects nothing", async () => {
    const { el } = await openPresented();
    drafts.drafts.push({
      id: "draft-luis",
      partyId: "v1",
      billId: "wo-4",
      ownerId: "p2",
      ownerName: "Luis",
      revision: 3,
      takenOverFrom: null,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          id: "draft-line-1",
          sourceLineId: null,
          source: null,
          menuItemId: "menu-item-cafe-0",
          variantId: null,
          menuVersionId: null,
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          makeAt: "switched-off",
          noMerge: false,
          unavailable: false,
        },
      ],
    });
    window.dispatchEvent(new Event("focus"));
    await expect
      .poll(() => tableOrder(el).shadowRoot!.querySelector('[data-take-over="draft-luis"]'), {
        timeout: 10_000,
      })
      .not.toBeNull();
    expect(presented(el)).not.toBeNull();

    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 3 });

    expect(vi.mocked(api.collectOrder)).not.toHaveBeenCalled();
    expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toContain(
      "Luis has taken over this order.",
    );
  });

  it("Pay opens the presented bill's sheet on its whole amount and reads the equipment again", async () => {
    const { el, stubs, readsBefore } = await openPresented();

    const sheet = presented(el);
    expect(sheet).not.toBeNull();
    expect(sheet!.open).toBe(true);
    expect(sheet!.amount).toBe("120.00");
    expect(sheet!.tableName).toBe(t("floor.table_title").replace("{table}", "4"));
    expect(sheet!.asksGuests).toBe(true);
    expect(sheet!.receiptGuests).toBe(4);
    expect(sheet!.takesReaderCard).toBe(true);
    expect(sheet!.takesCash).toBe(true);
    expect(sheet!.takesManualCard).toBe(true);
    expect(dialog(el)).toBeNull();
    expect(stubs.getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
  });

  it("forwards the presented slip choice and warns after successful money", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockResolvedValue({
        outcome: "captured",
        ticket: saleOf("120.00"),
        slipPrintFailed: true,
      }),
    });
    await payFromSheet(el, { method: "card", readerId: "r2", printCardSlip: true });
    expect(vi.mocked(api.pay).mock.calls[0]![0]).toHaveProperty("printCardSlip", true);
    expect(text(el.shadowRoot!.querySelector('.error[role="alert"]'))).toContain(
      t("payment_slip.capture_failed"),
    );
    expect(vi.mocked(api.pay)).toHaveBeenCalledOnce();
  });

  it("a full invoice's presented bill asks for no guests", async () => {
    const { el } = await openPresented({
      getPartyBills: vi.fn().mockResolvedValue([{ ...placedBill, invoiceType: "F1" }]),
    });
    expect(presented(el)!.asksGuests).toBe(false);
    await takeOnReader(el);
    expect(vi.mocked(api.pay).mock.calls[0]![0]).not.toHaveProperty("guestCount");
  });

  it("another card machine with no operation number sends none", async () => {
    const { el } = await openPresented();
    await payFromSheet(el, { method: "manual" });

    expect(vi.mocked(api.collectOrder).mock.calls[0]).toEqual([
      "wo-4",
      { method: "card", amount: "120.00" },
      undefined,
      undefined,
      editOfBill,
    ]);
  });

  it("a practice phone pays a presented bill without seeded hardware", async () => {
    const practice = onPhone(
      { getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(null)) },
      { cardProvider: "simulator", activeReaders: [] },
    );
    const { el } = await openPresented({
      getTill: practice.getTill,
      getDeviceEquipment: practice.getDeviceEquipment,
    });
    expect(inPresented(el, "[data-presented-pay-take]")).toHaveProperty("disabled", false);
    await takeOnReader(el);
    expect(vi.mocked(api.pay)).toHaveBeenCalledOnce();
    expect(vi.mocked(api.pay).mock.calls[0]![0]).toEqual({
      expectedEdit: editOfBill,
      id: "wo-4",
      lines: [],
      guestCount: 4,
    });
    expect(presented(el)).toBeNull();
    expect(documentChoice(el)).not.toBeNull();
  });

  it("a card is charged on the row's reader through the integrated payment, then the document choice shows", async () => {
    const { el } = await openPresented();
    await takeOnReader(el);

    expect(vi.mocked(api.pay)).toHaveBeenCalledOnce();
    expect(vi.mocked(api.pay).mock.calls[0]![0]).toEqual({
      expectedEdit: editOfBill,
      id: "wo-4",
      lines: [],
      readerId: "r2",
      guestCount: 4,
    });
    expect(vi.mocked(api.takeBillPayment)).not.toHaveBeenCalled();
    expect(vi.mocked(api.collectOrder)).not.toHaveBeenCalled();
    expect(presented(el)).toBeNull();
    expect(documentChoice(el)).not.toBeNull();
  });

  it("cash is collected with what was handed over and the guests, then the document choice shows", async () => {
    const { el } = await openPresented();
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 3 });

    expect(vi.mocked(api.collectOrder)).toHaveBeenCalledOnce();
    expect(vi.mocked(api.collectOrder).mock.calls[0]).toEqual([
      "wo-4",
      { method: "cash", amount: "150.00" },
      undefined,
      3,
      editOfBill,
    ]);
    expect(vi.mocked(api.pay)).not.toHaveBeenCalled();
    expect(presented(el)).toBeNull();
    expect(documentChoice(el)).not.toBeNull();
  });

  it("cash handed over beyond the bill shows the change to give back on the document choice", async () => {
    const { el } = await openPresented({
      collectOrder: vi
        .fn()
        .mockResolvedValue({ ...ticket(), tender: { method: "cash", change: "30.00" } }),
    });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 3 });

    const paid = documentChoice(el)!;
    await paid.updateComplete;
    expect(text(paid.shadowRoot!.querySelector("[data-settlement-change]"))).toBe(
      `${t("label.change")} ${money("30.00")}`,
    );
  });

  it("a card on another machine shows no change on the document choice", async () => {
    const { el } = await openPresented({
      collectOrder: vi.fn().mockResolvedValue({
        ...ticket(),
        tender: { method: "card", charged: "120.00", tip: "0.00", reference: "op-1" },
      }),
    });
    await payFromSheet(el, { method: "manual", externalRef: "op-1", guestCount: 3 });

    const paid = documentChoice(el)!;
    await paid.updateComplete;
    expect(paid.shadowRoot!.querySelector("[data-settlement-change]")).toBeNull();
  });

  it("another card machine is collected as a card of the whole amount with its operation number", async () => {
    const { el } = await openPresented();
    await payFromSheet(el, { method: "manual", externalRef: "OP-7", guestCount: null });

    expect(vi.mocked(api.collectOrder).mock.calls[0]).toEqual([
      "wo-4",
      { method: "card", amount: "120.00", externalRef: "OP-7" },
      undefined,
      null,
      editOfBill,
    ]);
    expect(vi.mocked(api.pay)).not.toHaveBeenCalled();
  });

  it.each(["card", "cash"] as const)(
    "the party's kitchen note is saved before a %s payment is sent",
    async (method) => {
      let saved!: (value: unknown) => void;
      const { el, order } = await openPresented({
        setKitchenNote: vi.fn(() => new Promise((resolve) => (saved = resolve))),
      });
      emit(presented(el)!, "presented-pay-close");
      await flush(el);
      const note = order.shadowRoot!.querySelector<HTMLElement>("till-order-kitchen-note")!;
      emit(note, "save-kitchen-note", {
        ...(note as unknown as { opening: object }).opening,
        scopeKey: (note as unknown as { scopeKey: string }).scopeKey,
        visit: (note as unknown as { visit: number }).visit,
        revision: 0,
        note: "Together",
      });
      await flush(el);
      expect(vi.mocked(api.setKitchenNote)).toHaveBeenCalledOnce();
      await pressPaySheet(el, order);
      if (method === "card") await takeOnReader(el);
      else await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });
      expect(vi.mocked(api.pay)).not.toHaveBeenCalled();
      expect(vi.mocked(api.collectOrder)).not.toHaveBeenCalled();

      saved({
        scope: { partyId: "v1" },
        note: "Together",
        revision: 1,
        ownerRevision: 4,
      });
      await flush(el);
      expect(
        method === "card" ? vi.mocked(api.pay) : vi.mocked(api.collectOrder),
      ).toHaveBeenCalledOnce();
    },
  );

  it("a declined card keeps the sheet open, saying so in today's words", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockResolvedValue({ outcome: "declined", failureReason: "generic_decline" }),
    });
    await takeOnReader(el);

    expect(presented(el)!.open).toBe(true);
    expect(presented(el)!.busy).toBe(false);
    expect(presented(el)!.refusal).toEqual({ code: "declined" });
    expect(
      presented(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
        .error,
    ).toBe(t("bill_pay.card_declined"));
    expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
  });

  it.each([
    ["network_unavailable", "card_network"],
    ["timeout", "card_timeout"],
  ] as const)("a card the reader answered %s keeps the sheet open as %s", async (outcome, code) => {
    const { el } = await openPresented({ pay: vi.fn().mockResolvedValue({ outcome }) });
    await takeOnReader(el);

    expect(presented(el)!.refusal).toEqual({ code });
  });

  it("a card the reader did not answer for says so in the pay card's words", async () => {
    const { el } = await openPresented({ pay: vi.fn().mockResolvedValue({ outcome: "timeout" }) });
    await takeOnReader(el);

    expect(await sheetMessage(el)).toBe(`${t("card.no_answer")}. ${t("card.pending_check")}`);
  });

  it("a card refused for good says the sale was refused, on the sheet", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockRejectedValue({ code: "fiscal.record_invalid" }),
    });
    await takeOnReader(el);

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t("sale.refused"));
    expect(el.shadowRoot!.textContent).not.toContain(t("sale.refused"));
  });

  it("a card with no answer from the server says to check the sale, on the sheet", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await takeOnReader(el);

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t("sale.unconfirmed"));
  });

  it("a card refused while a payment is in flight says so as the pay card does", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockRejectedValue({ code: "order.payment_in_flight" }),
    });
    await takeOnReader(el);

    expect(await sheetMessage(el)).toBe(t("sale.payment_in_flight"));
  });

  it("a card refused because this device may not take card payments says so", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockRejectedValue({ code: "device.forbidden_action", action: "pay" }),
    });
    await takeOnReader(el);

    expect(await sheetMessage(el)).toBe(t("card_reader.not_set_up"));
  });

  it.each([
    [{ code: "order.payment_in_flight" }, "sale.payment_in_flight"],
    [
      { code: "authorization.not_permitted", permission: "payment.take" },
      "take_payment.not_permitted",
    ],
    [{ code: "fiscal.record_invalid" }, "sale.refused"],
    [{ code: "something.else" }, "sale.error"],
    [{ code: "storage.disk_full", status: 507 }, "sale.disk_full"],
  ] as const)("a cash send refused as %o says %s, as the pay card does", async (error, key) => {
    const { el } = await openPresented({ collectOrder: vi.fn().mockRejectedValue(error) });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t(key));
    expect(el.shadowRoot!.textContent).not.toContain(t(key));
  });

  it("a cash send refused for a wrong clock shows the date the box's clock reads, on the sheet", async () => {
    const { el } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue({
        code: "clock.unusable",
        clockAt: "2001-01-01T11:00:00.000Z",
        offsetMinutes: 60,
        status: 409,
      }),
    });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });

    expect(await sheetMessage(el)).toBe(t("sale.clock_unusable").replace("{date}", "01/01/2001"));
  });

  it("a cash send refused for a wrong clock points at Check the time while the box offers it", async () => {
    const marker = {
      owner: "box-clock",
      key: "clock.check_time",
      code: "clock.check_time",
      severity: "error",
      params: {},
    };
    const { el } = await openPresented({
      getDeviceEquipment: vi
        .fn()
        .mockResolvedValue({ ...equipmentWith(SECOND_READER), notices: [marker] }),
      collectOrder: vi.fn().mockRejectedValue({
        code: "clock.unusable",
        clockAt: "2001-01-01T11:00:00.000Z",
        offsetMinutes: 60,
        status: 409,
      }),
    });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });

    expect(await sheetMessage(el)).toBe(
      t("sale.clock_unusable_check").replace("{date}", "01/01/2001"),
    );
  });

  it("a sheet send on a terminal the box does not talk to, refused for a full disk, adds the card advice", async () => {
    const { el } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue({ code: "storage.disk_full", status: 507 }),
    });
    await payFromSheet(el, { method: "manual", externalRef: "OP-4417" });

    expect(await sheetMessage(el)).toBe(t("sale.disk_full_manual_card"));
  });

  it.each([
    [{ code: "storage.disk_full", status: 507 }, "sale.disk_full"],
    [
      {
        code: "sale.charged_not_recorded",
        workingOrderId: "wo-1",
        reason: "disk_full",
        status: 507,
      },
      "sale.charged_disk_full",
    ],
  ] as const)("a reader card refused as %o says %s on the sheet", async (error, key) => {
    const { el } = await openPresented({ pay: vi.fn().mockRejectedValue(error) });
    await takeOnReader(el);

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t(key));
  });

  it("a reader card refused for a wrong clock shows the date the box's clock reads", async () => {
    const { el } = await openPresented({
      pay: vi.fn().mockRejectedValue({
        code: "clock.unusable",
        clockAt: "2001-01-01T11:00:00.000Z",
        offsetMinutes: 60,
        status: 409,
      }),
    });
    await takeOnReader(el);

    expect(await sheetMessage(el)).toBe(t("sale.clock_unusable").replace("{date}", "01/01/2001"));
  });

  it("a cash send refused as paid meanwhile says so on the sheet and reads the bills again", async () => {
    const { el } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    });
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t("bill.pay_with_bill_payments"));
    expect(el.shadowRoot!.textContent).not.toContain(t("bill.pay_with_bill_payments"));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads);
  });

  it("a cash send with no answer closes the sheet, leaving the bill's one Pay", async () => {
    const { el, order } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guestCount: 4 });

    expect(presented(el)).toBeNull();
    expect(order.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")).toBeNull();
    expect(inOrder(order, "[data-pay-sheet]")).not.toBeNull();
  });

  const lookBackgrounds = new Map<string, string>();
  it.each([
    ["light", 390],
    ["light", 1280],
    ["dark", 390],
    ["dark", 1280],
  ] as const)("looks right opened from the bill, %s at %i px", async (theme, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      setLocale("es-ES");
      api = stubApi(onPhone({ getPartyBills: vi.fn().mockResolvedValue([placedBill]) }));
      const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await presented(el)!.updateComplete;
      const panel = presented(el)!
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      lookBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") expect(background).not.toBe(lookBackgrounds.get(`light-${width}`));
      const shot = `__screenshots__/look/a796-presented-from-bill-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-presented-from-bill-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const take = inPresented(el, "[data-presented-pay-take]")!.getBoundingClientRect();
      await commands.writeFile(
        `src/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          takeInside: take.right <= box.right && take.left >= box.left,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it("Close shuts the sheet without a payment", async () => {
    const { el } = await openPresented();
    emit(presented(el)!, "presented-pay-close");
    await flush(el);

    expect(presented(el)).toBeNull();
    expect(vi.mocked(api.pay)).not.toHaveBeenCalled();
    expect(vi.mocked(api.collectOrder)).not.toHaveBeenCalled();
  });
});

describe("an unanswered presented payment on a handheld", () => {
  const placedBill = billOf({ status: "placed", receiptAvailable: true });
  const noAnswer = () => new TypeError("Failed to fetch");
  const asked = {
    cash: { method: "cash", tendered: "150.00", guestCount: 4 },
    manual: { method: "manual", externalRef: "operation-17", guestCount: 4 },
  } as const satisfies Record<string, PresentedPayDetail>;
  const tenderOf = {
    cash: { method: "cash", amount: "150.00" },
    manual: { method: "card", amount: "120.00", externalRef: "operation-17" },
  } as const;

  /** The bill's sheet opened, `method` sent from it, and the sheet opened again after no answer. */
  async function sentWithNoAnswer(
    method: "cash" | "manual",
    collectOrder: ReturnType<typeof vi.fn>,
  ) {
    const { el } = await mountApp(
      onPhone({ getPartyBills: vi.fn().mockResolvedValue([placedBill]), collectOrder }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    emit(presented(el)!, "presented-pay", asked[method]);
    await flush(el);
    expect(presented(el)).toBeNull();
    await pressPaySheet(el, order);
    await presented(el)!.updateComplete;
    return { el, order };
  }

  async function expectLockedOn(el: TillApp, method: "cash" | "manual"): Promise<void> {
    const sheet = presented(el)!;
    await sheet.updateComplete;
    expect(sheet.open).toBe(true);
    expect(sheet.confirmation?.tender).toEqual(tenderOf[method]);
    expect(sheet.confirmation?.guestCount).toBe(4);
    expect(inPresented(el, "[data-presented-pay-resend]")).not.toBeNull();
    expect(inPresented(el, "till-pay-equipment")).toBeNull();
    expect(text(inPresented(el, '[role="status"]'))).toBe(t("sale.unconfirmed"));
    if (method === "cash")
      expect(text(inPresented(el, "[data-presented-pay-tendered]"))).toBe(money("150.00"));
    else {
      const ref = inPresented(el, 'wt-input[name="externalRef"]') as HTMLElement & {
        value: string;
        disabled: boolean;
      };
      expect(ref.value).toBe("operation-17");
      expect(ref.disabled).toBe(true);
    }
  }

  /** A share taken from the open bill's sheet gets no answer — or, with `out`, is still waiting for
   * one — the sheet is closed, and the bill is then presented: the table is opened again on it. */
  async function partUnconfirmedThenPresented(
    out = false,
    takeBillPayment: Mock = out
      ? vi.fn(() => new Promise<BillPaymentResult>(() => {}))
      : vi.fn().mockRejectedValue(noAnswer()),
  ) {
    const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
    const { el } = await mountApp(
      onPhone({
        getPartyBills,
        takeBillPayment,
        previewBillPayment: vi.fn().mockResolvedValue({
          ...wholeCard,
          applied: "40.00",
          charged: "40.00",
        }),
      }),
    );
    await pressPaySheet(el, await openPhoneTable(el));
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    if (out) expect(takeBillPayment).toHaveBeenCalledOnce();
    else
      await expect
        .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
        .toBe(t("bill_pay.unconfirmed"));
    const original = structuredClone(
      (takeBillPayment.mock.calls.at(-1) as unknown as [string, BillPaymentRequest])[1],
    );
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    getPartyBills.mockResolvedValue([placedBill]);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const order = tableOrder(el);
    await showBillFooter(order);
    return { el, order, takeBillPayment, original };
  }

  it("Pay on a bill presented after a share got no answer opens that share, locked on Check again", async () => {
    const { el, order, takeBillPayment, original } = await partUnconfirmedThenPresented();

    await pressPaySheet(el, order);

    expect(presented(el)).toBeNull();
    await expect.poll(() => dialog(el)?.confirmationLocked, { timeout: 10_000 }).toBe(true);
    expect(text(inDialog(el, "[data-pay-confirm]"))).toBe(t("bill_pay.recheck"));
    takeBillPayment.mockResolvedValueOnce(
      takenOf(
        { method: "card", entry: "reader", applied: "40.00", tendered: null, change: null },
        { received: "40.00", outstanding: "80.00" },
      ),
    );
    await press(el, "[data-pay-confirm]");
    expect(takeBillPayment.mock.calls.at(-1)![1]).toEqual(original);
    expect(api.collectOrder).not.toHaveBeenCalled();
  });

  it("Pay on a bill presented while a share is still waiting for its answer opens that share, held, and sends nothing", async () => {
    const { el, order, takeBillPayment } = await partUnconfirmedThenPresented(true);
    const sends = takeBillPayment.mock.calls.length;

    await pressPaySheet(el, order);

    expect(presented(el)).toBeNull();
    await vi.waitFor(() => expect(dialog(el)?.confirmationLocked).toBe(true));
    expect(dialog(el)!.busy).toBe(true);
    expect(inDialog(el, "[data-pay-continue]")).toBeNull();
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.sending"));
    await press(el, "[data-pay-confirm]");
    expect(takeBillPayment).toHaveBeenCalledTimes(sends);
    expect(api.collectOrder).not.toHaveBeenCalled();
    expect(api.pay).not.toHaveBeenCalled();
  });

  it("a share answered while Pay's held sheet is open leaves the form whose Pay items lists the bill's items", async () => {
    let answer: (value: BillPaymentResult) => void = () => {};
    const takeBillPayment = vi.fn(
      () => new Promise<BillPaymentResult>((resolve) => (answer = resolve)),
    );
    const { el, order } = await partUnconfirmedThenPresented(true, takeBillPayment);
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(dialog(el)?.confirmationLocked).toBe(true));

    answer(
      takenOf(
        { method: "card", entry: "reader", applied: "40.00", tendered: null, change: null },
        { received: "40.00", outstanding: "80.00" },
      ),
    );
    await flush(el);
    await vi.waitFor(() => expect(dialog(el)!.confirmationLocked).toBe(false));
    await press(el, 'input[name="way"][value="items"]');

    expect(inDialog(el, "[data-items-none]")).toBeNull();
    expect(dialog(el)!.shadowRoot!.querySelectorAll('input[name="line"]').length).toBeGreaterThan(
      0,
    );
  });

  it.each([
    ["cash", asked.cash],
    ["another card machine", asked.manual],
    ["a card on the reader", { method: "card", readerId: "r2", guestCount: 4 }],
  ] as const)(
    "%s sent from a presented sheet still open when a bill payment began holding the bill is refused on the sheet",
    async (_name, detail: PresentedPayDetail) => {
      const takeBillPayment = vi.fn(() => new Promise<BillPaymentResult>(() => {}));
      const { el } = await mountApp(
        onPhone({
          getPartyBills: vi.fn().mockResolvedValue([placedBill]),
          takeBillPayment,
          previewBillPayment: vi
            .fn()
            .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" }),
        }),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      emit(order, "bill-pay", { way: "share", lines: [] });
      await flush(el);
      await press(el, 'input[name="way"][value="share"]');
      await type(el, "people", "3");
      await press(el, 'input[name="method"][value="card"]');
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      expect(takeBillPayment).toHaveBeenCalledOnce();

      emit(presented(el)!, "presented-pay", detail);
      await flush(el);
      await presented(el)!.updateComplete;

      expect(
        presented(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          "wt-form-actions",
        )!.error,
      ).toBe(t("bill_pay.sending"));
      expect(api.collectOrder).not.toHaveBeenCalled();
      expect(api.pay).not.toHaveBeenCalled();
    },
  );

  it("a whole payment from find-bill refused for a share that got no answer names the handheld's Pay, which reopens the share on Check again", async () => {
    const takeBillPayment = vi.fn().mockRejectedValue(noAnswer());
    const { el } = await mountApp(
      onPhone({
        takeBillPayment,
        previewBillPayment: vi
          .fn()
          .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" }),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);

    emit(order, "find-bill-pay", {
      workingOrderId: "wo-4",
      tender: { method: "cash", amount: "120.00" },
      invoiced: true,
    });
    await flush(el);

    expect((el as unknown as { findBillError?: unknown }).findBillError).toBe(
      "bill_pay.unconfirmed_elsewhere_handheld",
    );
    expect(api.collectOrder).not.toHaveBeenCalled();
    expect(api.recordSale).not.toHaveBeenCalled();
    await showBillFooter(order);
    await pressPaySheet(el, order);
    await expect.poll(() => dialog(el)?.confirmationLocked, { timeout: 10_000 }).toBe(true);
    expect(text(inDialog(el, "[data-pay-confirm]"))).toBe(t("bill_pay.recheck"));
  });

  /** Signs out, signs in as Luis, opens the table again and presses the bill's Pay. */
  async function signInAgainAndReopen(el: TillApp): Promise<void> {
    emit(shell(el), "logout");
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes");
    if (question?.open) await discardUnsavedLeave(el);
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const order = tableOrder(el);
    await showBillFooter(order);
    await pressPaySheet(el, order);
  }

  async function resend(el: TillApp): Promise<void> {
    inPresented(el, "[data-presented-pay-resend]")!.click();
    await flush(el);
  }

  it.each(["cash", "manual"] as const)(
    "a %s payment with no answer reopens the sheet locked on it, and its action sends it again; answered, the document choice shows",
    async (method) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(noAnswer())
        .mockResolvedValueOnce(invoiceOf("120.00", "F2"));
      const { el, order } = await sentWithNoAnswer(method, send);

      expect(order.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
      await expectLockedOn(el, method);
      await resend(el);

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]).toEqual([
        "wo-4",
        tenderOf[method],
        undefined,
        4,
        expect.objectContaining({ billId: "wo-4" }),
      ]);
      expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
      expect(vi.mocked(api.pay)).not.toHaveBeenCalled();
      expect(presented(el)).toBeNull();
      expect(documentChoice(el)).not.toBeNull();
    },
  );

  it("a resend with no answer keeps the sheet open and locked on the same payment", async () => {
    const send = vi.fn().mockRejectedValue(noAnswer());
    const { el } = await sentWithNoAnswer("cash", send);
    await resend(el);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    await expectLockedOn(el, "cash");
    expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
  });

  it("a resend refused as not recorded frees the bill: the sheet then opens unlocked", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockRejectedValueOnce({ code: "draft.out_of_date" });
    const { el, order } = await sentWithNoAnswer("cash", send);
    await resend(el);
    emit(presented(el)!, "presented-pay-close");
    await flush(el);
    await pressPaySheet(el, order);
    await presented(el)!.updateComplete;

    expect(presented(el)!.confirmation).toBeUndefined();
    expect(inPresented(el, "[data-presented-pay-resend]")).toBeNull();
    expect(inPresented(el, "[data-presented-pay-take]")).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["cash", "sale.disk_full"],
    ["manual", "sale.disk_full_manual_card"],
  ] as const)(
    "a %s resend refused for a full disk says so on the sheet in that tender's words",
    async (method, key) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(noAnswer())
        .mockRejectedValueOnce({ code: "storage.disk_full", status: 507 });
      const { el } = await sentWithNoAnswer(method, send);
      await resend(el);
      await presented(el)!.updateComplete;

      expect(send).toHaveBeenCalledTimes(2);
      expect(
        presented(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          "wt-form-actions",
        )!.error,
      ).toBe(t(key));
    },
  );

  it("a part payment of the bill is refused as unconfirmed", async () => {
    const send = vi.fn().mockRejectedValue(noAnswer());
    const { el, order } = await sentWithNoAnswer("cash", send);
    emit(presented(el)!, "presented-pay-close");
    await flush(el);
    emit(order, "bill-pay", { way: "contribution", lines: [], amount: "30.00" });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.previewBillPayment).not.toHaveBeenCalled();
    expect(api.takeBillPayment).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.textContent).toContain(t("sale.unconfirmed"));
  });

  it.each(["cash", "manual"] as const)(
    "a %s payment with no answer stays locked after signing out and in as another person",
    async (method) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(noAnswer())
        .mockResolvedValueOnce(invoiceOf("120.00", "F2"));
      const { el } = await sentWithNoAnswer(method, send);
      emit(presented(el)!, "presented-pay-close");
      await flush(el);

      await signInAgainAndReopen(el);

      await expectLockedOn(el, method);
      await resend(el);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
      expect(documentChoice(el)).not.toBeNull();
    },
  );
  it("a resend carries the original request after another person's draft has changed the bill", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockResolvedValueOnce(invoiceOf("120.00", "F2"));
    const { el } = await sentWithNoAnswer("cash", send);
    const original = structuredClone(send.mock.calls[0]);
    expect(original[4]).toEqual({
      billId: "wo-4",
      editorVersion: 0,
      draftId: null,
      draftRevision: null,
    });
    emit(presented(el)!, "presented-pay-close");
    await flush(el);
    drafts.drafts.push({
      id: "draft-luis",
      partyId: "v1",
      billId: "wo-4",
      ownerId: "p2",
      ownerName: "Luis",
      revision: 3,
      takenOverFrom: null,
      lines: [
        {
          slot: 0,
          joinGroupId: null,
          afterGroupId: null,
          id: "draft-line-1",
          sourceLineId: null,
          source: null,
          menuItemId: "menu-item-cafe-0",
          variantId: null,
          menuVersionId: null,
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: null,
          makeAt: "switched-off",
          noMerge: false,
          unavailable: false,
        },
      ],
    });

    await signInAgainAndReopen(el);
    await expectLockedOn(el, "cash");
    await resend(el);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(original);
    expect(documentChoice(el)).not.toBeNull();
  });
});

describe("till-app: a counter till's simulated card outcome", () => {
  it("sends the chosen declined outcome to the bill payment", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment", "take-cash"] as CapabilityFlag[],
        activeReaders: [],
      }),
      previewBillPayment: vi
        .fn()
        .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" }),
      takeBillPayment: vi.fn().mockRejectedValue({ code: "card.declined" }),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, 'input[name="simulation"][value="declined"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ entry: "reader", simulationOutcome: "declined" });
  });
});

describe("till-app: a pick from the sheet", () => {
  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
        roleOf("card_terminal", chosen, [SECOND_READER, THIRD_READER, FOURTH_READER]),
      ],
    };
  }

  /** Each request waits until its own `answer` is called. */
  function heldPicks() {
    const answers: Array<() => void> = [];
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise<DeviceEquipment>((resolve) => {
          const id = typeof change.selection === "object" ? change.selection.id : "";
          const chosen = [SECOND_READER, THIRD_READER, FOURTH_READER].find(
            (each) => each.id === id,
          )!;
          answers.push(() => resolve(readers(chosen)));
        }),
    );
    return { setDeviceEquipment, answers };
  }

  const row = (el: TillApp) =>
    inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment | null;
  async function savingNote(el: TillApp): Promise<string> {
    await dialog(el)!.updateComplete;
    await row(el)!.updateComplete;
    return text(row(el)!.shadowRoot!.querySelector('[data-pay-note="card_terminal"]'));
  }

  async function openRow(el: TillApp): Promise<void> {
    await row(el)!.updateComplete;
    const change = row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-equipment-change]");
    if (change !== null) await userEvent.click(change);
    await flush(el);
  }

  async function pickReader(el: TillApp, label: string): Promise<void> {
    await openRow(el);
    const combobox = row(el)!.shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combobox.updateComplete;
    const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
      (each) => each.textContent!.trim().startsWith(label),
    );
    if (!option) throw new Error(`no option ${label}`);
    await userEvent.click(option);
    await flush(el);
  }

  async function phoneSheet(overrides: Record<string, unknown>) {
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(SECOND_READER)),
        ...overrides,
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    expect(continueButton(el).disabled).toBe(false);
    return el;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a reader pick saves through Equipment and holds Continue until it is answered", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });

    await pickReader(el, "Lector 3");

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
      role: "card_terminal",
      selection: { id: READER_ID },
      via: "list",
      takeOver: false,
    });
    expect(continueButton(el).disabled).toBe(true);
    await row(el)!.updateComplete;
    expect(text(row(el)!.shadowRoot!.querySelector('[data-pay-note="card_terminal"]'))).toBe(
      t("pay_equipment.saving"),
    );

    answers[0]!();
    await flush(el);

    expect(continueButton(el).disabled).toBe(false);
    await row(el)!.updateComplete;
    const combobox = row(el)!.shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    expect(combobox.value).toBe(READER_ID);
    expect(row(el)!.shadowRoot!.querySelector('[data-pay-note="card_terminal"]')).toBeNull();
  });

  it("two picks out at once hold Continue until the second is answered", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });

    await pickReader(el, "Lector 3");
    await pickReader(el, "Lector 4");
    answers[0]!();
    await flush(el);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));

    expect(continueButton(el).disabled).toBe(true);
    answers[1]!();
    await flush(el);
    expect(continueButton(el).disabled).toBe(false);
  });

  it("an NFC tap still out holds Continue too", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);
    expect(continueButton(el).disabled).toBe(true);

    answers[0]!();
    await flush(el);
    expect(continueButton(el).disabled).toBe(false);
  });

  it("a tap queued, then a logout and a sign-in again, leaves Continue enabled", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });
    await pickReader(el, "Lector 3");
    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await flush(el);

    emit(shell(el), "logout");
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    answers[0]!();
    await flush(el);

    // The tap's session has ended, so it is dropped unsent and stops counting.
    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(continueButton(el).disabled).toBe(false);
  });

  it("a locked confirmation's Check again is not held while an NFC tap is out", async () => {
    installNfc();
    const takeBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { setDeviceEquipment } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment, takeBillPayment });
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    await pressPaySheet(el, tableOrder(el));
    await expect.poll(() => dialog(el)!.busy, { timeout: 10_000 }).toBe(false);
    expect(dialog(el)!.confirmationLocked).toBe(true);

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);

    expect(dialog(el)!.equipmentBusy).toBe(true);
    const confirm = inDialog(el, "[data-pay-confirm]")!;
    expect(text(confirm)).toBe(t("bill_pay.recheck"));
    expect(confirm.disabled).toBe(false);
  });

  it("a pick answered after a read overtook it holds charging until the read after it lands", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const reads: Array<(equipment: DeviceEquipment) => void> = [];
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(SECOND_READER));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    await pickReader(el, "Lector 3");
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => reads.push(resolve)),
    );
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    await pressPaySheet(el, tableOrder(el));
    await openRow(el);
    expect(reads).toHaveLength(1);

    reads[0]!(readers(SECOND_READER));
    await flush(el);
    answers[0]!();
    await flush(el);

    expect(reads).toHaveLength(2);
    expect(continueButton(el).disabled).toBe(true);
    expect(await savingNote(el)).toBe(t("pay_equipment.saving"));
    reads[1]!(readers(THIRD_READER));
    await flush(el);

    expect(continueButton(el).disabled).toBe(false);
    expect(await savingNote(el)).toBe("");
    const combobox = row(el)!.shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    expect(combobox.value).toBe(READER_ID);
  });

  it("the saving hint clears once every change and read has ended, whichever ends last", async () => {
    installNfc();
    const changes: Array<{ fail: (error: unknown) => void }> = [];
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>((_resolve, reject) => {
          changes.push({ fail: reject });
        }),
    );
    const reads: Array<(equipment: DeviceEquipment) => void> = [];
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(SECOND_READER));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => reads.push(resolve)),
    );

    await pickReader(el, "Lector 3");
    changes[0]!.fail({ status: 409, code: "device.equipment_held" });
    await flush(el);
    expect(reads).toHaveLength(1);
    (await nfcReader()).read(`waitron-equipment:reader:${FOURTH_READER.id}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    reads[0]!(readers(SECOND_READER));
    await flush(el);
    expect(continueButton(el).disabled).toBe(true);
    changes[1]!.fail({ status: 403, code: "permission.denied" });
    await flush(el);

    expect(continueButton(el).disabled).toBe(false);
    expect(await savingNote(el)).toBe("");
    const combobox = row(el)!.shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    expect(combobox.value).toBe("r2");
  });

  it("a read after an overtaken pick that never answers is cut off, and lifts the hold", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const reads: Array<(equipment: DeviceEquipment) => void> = [];
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(SECOND_READER));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    await pickReader(el, "Lector 3");
    getDeviceEquipment.mockImplementation(
      (options?: { signal?: AbortSignal }) =>
        new Promise<DeviceEquipment>((resolve, reject) => {
          reads.push(resolve);
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    await pressPaySheet(el, tableOrder(el));
    await openRow(el);
    reads[0]!(readers(SECOND_READER));
    await flush(el);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      answers[0]!();
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(reads).toHaveLength(2);
      expect(continueButton(el).disabled).toBe(true);
      expect(await savingNote(el)).toBe(t("pay_equipment.saving"));

      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
      await el.updateComplete;
      await dialog(el)!.updateComplete;
      expect(continueButton(el).disabled).toBe(false);
      expect(await savingNote(el)).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("picking the stored reader again while another pick is saving sends it and ends on it", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });

    await pickReader(el, "Lector 3");
    await pickReader(el, "Lector 2");
    answers[0]!();
    await flush(el);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    answers[1]!();
    await flush(el);

    expect(setDeviceEquipment.mock.calls[1]![0]).toMatchObject({ selection: { id: "r2" } });
    await row(el)!.updateComplete;
    const combobox = row(el)!.shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    expect(combobox.value).toBe("r2");
  });

  it("a card's Take payment is held while an equipment change is out, and enabled after", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    const take = () => inDialog(el, "[data-pay-confirm]")!;
    expect(take().disabled).toBe(false);

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);
    expect(take().disabled).toBe(true);

    answers[0]!();
    await flush(el);
    expect(take().disabled).toBe(false);
  });
});

describe("till-app: a pick from the sheet that fails", () => {
  const KITCHEN_PRINTER = equipmentItem("p2", "Cocina");

  function equipmentOf(reader: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER, KITCHEN_PRINTER]),
        roleOf("card_terminal", reader, [SECOND_READER, THIRD_READER, FOURTH_READER]),
      ],
    };
  }

  const row = (el: TillApp) =>
    inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment | null;
  async function field(el: TillApp, name: string): Promise<WtCombobox> {
    await dialog(el)!.updateComplete;
    await row(el)!.updateComplete;
    return row(el)!.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name="${name}"]`)!;
  }

  async function openRow(el: TillApp): Promise<void> {
    await row(el)!.updateComplete;
    const change = row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-equipment-change]");
    if (change !== null) await userEvent.click(change);
    await flush(el);
  }

  async function pick(el: TillApp, name: string, label: string): Promise<void> {
    await openRow(el);
    const combobox = await field(el, name);
    await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combobox.updateComplete;
    const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
      (each) => each.textContent!.trim().startsWith(label),
    );
    if (!option) throw new Error(`no option ${label}`);
    await userEvent.click(option);
    await flush(el);
  }

  async function phoneSheet(overrides: Record<string, unknown>) {
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(SECOND_READER)),
        ...overrides,
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    return el;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a refused reader pick leaves the field on the stored reader and says why under it", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValue({ code: "reader.payment_in_progress", status: 409 });
    const el = await phoneSheet({ setDeviceEquipment });

    await pick(el, "cardReaderId", "Lector 3");
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    const reader = await field(el, "cardReaderId");
    expect(reader.value).toBe("r2");
    expect(reader.error).toBe(codeMessage("reader.payment_in_progress"));
    expect((await field(el, "receiptPrinterId")).error).toBe("");
    expect(continueButton(el).disabled).toBe(false);
  });

  it("a refused printer pick says why under the printer field", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValue({ code: "device.binding_invalid", status: 400 });
    const el = await phoneSheet({ setDeviceEquipment });

    await pick(el, "receiptPrinterId", "Cocina");

    const printer = await field(el, "receiptPrinterId");
    expect(printer.value).toBe("p1");
    expect(printer.error).toBe(codeMessage("device.binding_invalid"));
    expect((await field(el, "cardReaderId")).error).toBe("");
    expect(continueButton(el).disabled).toBe(false);
  });

  it("a scanned sticker for the reader replaces an earlier pick's refusal under the field", async () => {
    const camera = cameraFilming(formatEquipmentCode("reader", READER_ID));
    try {
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
      const setDeviceEquipment = vi
        .fn()
        .mockRejectedValueOnce({ code: "reader.payment_in_progress", status: 409 })
        .mockResolvedValueOnce(equipmentOf(THIRD_READER));
      const el = await phoneSheet({ setDeviceEquipment });
      await pick(el, "cardReaderId", "Lector 4");
      expect((await field(el, "cardReaderId")).error).toBe(
        codeMessage("reader.payment_in_progress"),
      );

      row(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2), {
        timeout: 10_000,
      });
      await flush(el);

      const reader = await field(el, "cardReaderId");
      expect(reader.value).toBe(READER_ID);
      expect(reader.error).toBe("");
    } finally {
      camera.stop();
    }
  });

  it("a pick refused only after an NFC tap for the reader was made shows no refusal", async () => {
    installNfc();
    let refuse!: () => void;
    const setDeviceEquipment = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          refuse = () => reject({ code: "reader.payment_in_progress", status: 409 });
        }),
      )
      .mockResolvedValueOnce(equipmentOf(THIRD_READER));
    const el = await phoneSheet({ setDeviceEquipment });
    await pick(el, "cardReaderId", "Lector 4");
    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await flush(el);

    refuse();
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    await flush(el);

    const reader = await field(el, "cardReaderId");
    expect(reader.value).toBe(READER_ID);
    expect(reader.error).toBe("");
  });

  it("a pick with no answer reads the equipment again, shows what it says, and says it was not saved", async () => {
    const setDeviceEquipment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const getDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(SECOND_READER));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    const readsBefore = getDeviceEquipment.mock.calls.length;
    getDeviceEquipment.mockResolvedValue(equipmentOf(FOURTH_READER));

    await pick(el, "cardReaderId", "Lector 3");
    await flush(el);

    expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
    const reader = await field(el, "cardReaderId");
    expect(reader.value).toBe(FOURTH_READER.id);
    expect(reader.error).toBe(t("pay_equipment.not_saved"));
    expect(continueButton(el).disabled).toBe(false);
  });

  it("an earlier pick's refusal is not shown once a later pick of that field has saved", async () => {
    const answers: Array<{ ok: (equipment: DeviceEquipment) => void; fail: (e: unknown) => void }> =
      [];
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>((resolve, reject) => {
          answers.push({ ok: resolve, fail: reject });
        }),
    );
    const el = await phoneSheet({ setDeviceEquipment });

    await pick(el, "receiptPrinterId", "Cocina");
    await pick(el, "receiptPrinterId", "Barra");
    answers[0]!.fail({ code: "device.binding_invalid", status: 400 });
    await flush(el);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    answers[1]!.ok(equipmentOf(SECOND_READER));
    await flush(el);

    const printer = await field(el, "receiptPrinterId");
    expect(printer.value).toBe("p1");
    expect(printer.error).toBe("");
  });

  it("the next pick of that field clears its message", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValueOnce({ code: "reader.payment_in_progress", status: 409 })
      .mockImplementation(() => new Promise<DeviceEquipment>(() => {}));
    const el = await phoneSheet({ setDeviceEquipment });

    await pick(el, "cardReaderId", "Lector 3");
    await flush(el);
    expect((await field(el, "cardReaderId")).error).not.toBe("");
    await pick(el, "cardReaderId", "Lector 3");
    expect((await field(el, "cardReaderId")).error).toBe("");
  });

  it("closing the sheet clears a field's message", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValue({ code: "device.binding_invalid", status: 400 });
    const el = await phoneSheet({ setDeviceEquipment });
    await pick(el, "receiptPrinterId", "Cocina");
    expect((await field(el, "receiptPrinterId")).error).not.toBe("");

    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    await pressPaySheet(el, tableOrder(el));
    await openRow(el);

    expect((await field(el, "receiptPrinterId")).error).toBe("");
  });

  it("a refusal that answers after the sheet closed is not shown when it opens again", async () => {
    let refuse: (error: unknown) => void = () => {};
    const setDeviceEquipment = vi.fn(
      () => new Promise<DeviceEquipment>((_resolve, reject) => (refuse = reject)),
    );
    const el = await phoneSheet({ setDeviceEquipment });
    await pick(el, "receiptPrinterId", "Cocina");
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    await pressPaySheet(el, tableOrder(el));

    refuse({ code: "device.binding_invalid", status: 400 });
    await flush(el);
    await openRow(el);

    expect((await field(el, "receiptPrinterId")).error).toBe("");
  });

  it("a pick, an NFC tap, a logout, the pick answered and a sign-in leave no saving hint", async () => {
    installNfc();
    let answer: () => void = () => {};
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>(
          (resolve) => (answer = () => resolve(equipmentOf(THIRD_READER))),
        ),
    );
    const el = await phoneSheet({ setDeviceEquipment });
    await pick(el, "cardReaderId", "Lector 3");
    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await flush(el);

    emit(shell(el), "logout");
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    answer();
    await flush(el);
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await openRow(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect((await field(el, "cardReaderId")).hint).toBe("");
    expect(row(el)!.shadowRoot!.querySelector('[data-pay-note="card_terminal"]')).toBeNull();
  });
});

async function nfcReader(): Promise<FakeNdefReader> {
  await vi.waitFor(() => expect(FakeNdefReader.instances.at(-1)?.signal).toBeDefined());
  return FakeNdefReader.instances.at(-1)!;
}

describe("till-app: a pick from the presented bill's sheet", () => {
  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
        roleOf("card_terminal", chosen, [SECOND_READER, THIRD_READER]),
      ],
    };
  }

  const row = (el: TillApp) =>
    presented(el)!.shadowRoot!.querySelector<TillPayEquipment>("till-pay-equipment")!;
  const take = (el: TillApp) =>
    presented(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-presented-pay-take]",
    )!;

  async function note(el: TillApp): Promise<Element | null> {
    await presented(el)!.updateComplete;
    await row(el).updateComplete;
    return row(el).shadowRoot!.querySelector('[data-pay-note="card_terminal"]');
  }

  async function openRow(el: TillApp): Promise<void> {
    await presented(el)!.updateComplete;
    await row(el).updateComplete;
    const change = row(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-equipment-change]");
    if (change !== null) await userEvent.click(change);
    await flush(el);
  }

  async function pickReader(el: TillApp, label: string): Promise<void> {
    await openRow(el);
    const combobox = row(el).shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combobox.updateComplete;
    const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
      (each) => each.textContent!.trim().startsWith(label),
    );
    if (!option) throw new Error(`no option ${label}`);
    await userEvent.click(option);
    await flush(el);
  }

  async function presentedSheet(setDeviceEquipment: unknown) {
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(SECOND_READER)),
        getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
        setDeviceEquipment,
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    return { el, order };
  }

  async function closeSheet(el: TillApp): Promise<void> {
    emit(presented(el)!, "presented-pay-close");
    await flush(el);
  }

  it("a reader pick is saved once, holds Take until answered, and Take then names it", async () => {
    let answer!: () => void;
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>((resolve) => (answer = () => resolve(readers(THIRD_READER)))),
    );
    const { el, order } = await presentedSheet(setDeviceEquipment);

    await pickReader(el, "Lector 3");
    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(setDeviceEquipment.mock.calls[0]).toEqual([
      { role: "card_terminal", selection: { id: READER_ID }, via: "list", takeOver: false },
      expect.anything(),
    ]);
    expect(text(await note(el))).toBe(t("pay_equipment.saving"));
    expect(take(el).disabled).toBe(true);

    vi.mocked(api.getDeviceEquipment).mockResolvedValue(readers(THIRD_READER));
    answer();
    await flush(el);
    expect(await note(el)).toBeNull();
    expect(take(el).disabled).toBe(false);
    expect(
      row(el).shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="cardReaderId"]')!.value,
    ).toBe(READER_ID);
    expect(text(take(el))).toContain("Lector 3");

    await closeSheet(el);
    await pressPaySheet(el, order);
    expect(await note(el)).toBeNull();
    expect(text(take(el))).toContain("Lector 3");
  });

  it("a refused pick says why under its field, and the reopened sheet does not", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValue({ code: "reader.payment_in_progress", status: 409 });
    const { el, order } = await presentedSheet(setDeviceEquipment);

    await pickReader(el, "Lector 3");
    await row(el).updateComplete;
    const field = () =>
      row(el).shadowRoot!.querySelector<WtCombobox & { error: string }>(
        'wt-combobox[name="cardReaderId"]',
      )!;
    expect(field().error).toBe(codeMessage("reader.payment_in_progress"));

    await closeSheet(el);
    await pressPaySheet(el, order);
    await openRow(el);
    expect(field().error).toBe("");
  });

  it("an open bill's sheet opened after a pick from the presented sheet is not held", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(THIRD_READER));
    const { el, order } = await presentedSheet(setDeviceEquipment);
    await pickReader(el, "Lector 3");
    await closeSheet(el);

    emit(order, "bill-pay", { way: "whole", lines: [] });
    await flush(el);

    expect(dialog(el)).not.toBeNull();
    expect(dialog(el)!.equipmentSaving).toBeNull();
    expect(dialog(el)!.equipmentBusy).toBe(false);
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(false);
  });
});

describe("till-app: a sticker scanned from the sheet", () => {
  const PORTABLE = equipmentItem(PRINTER_ID, "Portable printer", { portable: true });

  function equipmentOf(reader: EquipmentItem, printer: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", printer, [BAR_PRINTER, PORTABLE]),
        roleOf("card_terminal", reader, [SECOND_READER, THIRD_READER]),
      ],
    };
  }

  let filming: { stop: () => void } | undefined;
  afterEach(() => {
    filming?.stop();
    filming = undefined;
    vi.restoreAllMocks();
  });

  function film(text: string): void {
    const camera = cameraFilming(text);
    filming = camera;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(camera.stream);
  }

  async function scanFromSheet(
    setDeviceEquipment: unknown,
  ): Promise<{ el: TillApp; before: string }> {
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(SECOND_READER, BAR_PRINTER)),
        setDeviceEquipment,
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    const before = await rowSummary(el);
    const row = inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment;
    row.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();
    await flush(el);
    return { el, before };
  }

  it("a reader's sticker is sent as a scan, and the row then names the reader", async () => {
    film(formatEquipmentCode("reader", READER_ID));
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(THIRD_READER, BAR_PRINTER));
    const { el } = await scanFromSheet(setDeviceEquipment);

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
      kind: "reader",
      selection: { id: READER_ID },
      via: "scan",
    });
    await flush(el);
    expect(inDialog(el, "till-equipment-scanner")).toBeNull();
    expect(await rowSummary(el)).toContain("Lector 3");
  });

  it("a reader's sticker's notice shows inside the sheet, not in the toast beneath it", async () => {
    film(formatEquipmentCode("reader", READER_ID));
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(THIRD_READER, BAR_PRINTER));
    const { el } = await scanFromSheet(setDeviceEquipment);

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    await flush(el);
    expect(text(inDialog(el, "[data-pay-notice]"))).toBe(
      t("equipment.picked_up").replace("{item}", "Lector 3"),
    );
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-nfc-notice]")!.open,
    ).toBe(false);
  });

  it("a reader's sticker still out holds Continue", async () => {
    film(formatEquipmentCode("reader", READER_ID));
    let answer!: () => void;
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>(
          (resolve) => (answer = () => resolve(equipmentOf(THIRD_READER, BAR_PRINTER))),
        ),
    );
    const { el } = await scanFromSheet(setDeviceEquipment);

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    await flush(el);
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(true);

    answer();
    await flush(el);
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(false);
  });

  it("a printer's sticker is sent as a printer scan", async () => {
    film(formatEquipmentCode("printer", PRINTER_ID));
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(SECOND_READER, PORTABLE));
    const { el } = await scanFromSheet(setDeviceEquipment);

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
      kind: "printer",
      selection: { id: PRINTER_ID },
      via: "scan",
    });
    await flush(el);
    expect(await rowSummary(el)).toContain("Portable printer");
  });

  it("a reader's sticker scanned from the presented bill's sheet is sent the same way", async () => {
    film(formatEquipmentCode("reader", READER_ID));
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(THIRD_READER, BAR_PRINTER));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(SECOND_READER, BAR_PRINTER)),
        getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
        setDeviceEquipment,
      }),
    );
    await pressPaySheet(el, await openPhoneTable(el));
    const sheet = el.shadowRoot!.querySelector<TillPresentedPayDialog>(
      "till-presented-pay-dialog",
    )!;
    await sheet.updateComplete;
    const row = sheet.shadowRoot!.querySelector<TillPayEquipment>("till-pay-equipment")!;
    await row.updateComplete;
    row.shadowRoot!.querySelector<HTMLElement>("[data-pay-qr]")!.click();

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
      kind: "reader",
      selection: { id: READER_ID },
      via: "scan",
    });
    await flush(el);
    expect(sheet.shadowRoot!.querySelector("till-equipment-scanner")).toBeNull();
    expect(text(sheet.shadowRoot!.querySelector("[data-presented-pay-take]"))).toContain(
      "Lector 3",
    );
  });

  it("a printer's sticker refused changes nothing in the row", async () => {
    film(formatEquipmentCode("printer", PRINTER_ID));
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValue({ code: "device.binding_invalid", status: 400 });
    const { el, before } = await scanFromSheet(setDeviceEquipment);

    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce(), { timeout: 10_000 });
    await flush(el);
    expect(before).toContain("Barra");
    expect(await rowSummary(el)).toBe(before);
  });
});

describe("till-app: a sticker's notice inside the sheet", () => {
  const pickedUp = (name: string) => t("equipment.picked_up").replace("{item}", name);

  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
        roleOf("card_terminal", chosen, [SECOND_READER, THIRD_READER]),
      ],
    };
  }

  const toast = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-nfc-notice]")!;
  const row = (el: TillApp) => inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment;

  beforeEach(() => {
    installNfc();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function phoneSheet(overrides: Record<string, unknown> = {}) {
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(THIRD_READER));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(SECOND_READER)),
        setDeviceEquipment,
        ...overrides,
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    return { el, order, setDeviceEquipment };
  }

  async function tap(el: TillApp, id = READER_ID): Promise<FakeNdefReader> {
    const nfc = await nfcReader();
    nfc.read(`waitron-equipment:reader:${id}`);
    await flush(el);
    return nfc;
  }

  it("a tap with the pay sheet open changes its row, its drop-downs and its charge button, and leaves the listener running", async () => {
    const { el, setDeviceEquipment } = await phoneSheet();
    const nfc = await tap(el);

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(pickedUp("Lector 3")),
    );
    expect(inDialog(el, "[data-pay-notice]")!.getAttribute("role")).toBe("status");
    expect(toast(el).open).toBe(false);
    expect(await rowSummary(el)).toContain("Lector 3");
    await row(el).updateComplete;
    const change = row(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-equipment-change]");
    if (change !== null) await userEvent.click(change);
    await flush(el);
    await row(el).updateComplete;
    const combobox = row(el).shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    expect(combobox.value).toBe(READER_ID);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    expect(text(inDialog(el, "[data-pay-confirm]"))).toContain("Lector 3");

    expect(nfc.signal!.aborted).toBe(false);
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
  });

  it("a tap on the confirmation step makes Take payment send the tapped reader", async () => {
    const { el } = await phoneSheet();
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    expect(text(inDialog(el, "[data-pay-confirm]"))).toContain("Lector 2");

    await tap(el);

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(pickedUp("Lector 3")),
    );
    expect(text(inDialog(el, "[data-pay-confirm]"))).toContain("Lector 3");
    expect(toast(el).open).toBe(false);
    await press(el, "[data-pay-confirm]");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ method: "card", entry: "reader", readerId: READER_ID });
  });

  it("the payment taken names the reader it was sent to, not one tapped while it was out", async () => {
    let answer!: (value: unknown) => void;
    const held = new Promise((resolve) => (answer = resolve));
    const { el } = await phoneSheet({ takeBillPayment: vi.fn(() => held) });
    await press(el, 'input[name="way"][value="contribution"]');
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(sent()[0]).toMatchObject({ readerId: "r2" });

    await tap(el);
    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(pickedUp("Lector 3")),
    );
    answer(
      takenOf(
        { method: "card", entry: "reader", applied: "40.00", tip: "0.00", change: null },
        { received: "40.00", outstanding: "80.00" },
      ),
    );

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-taken-reader]"))).toBe(
        t("bill_pay.taken_on_reader")
          .replace("{amount}", money("40.00"))
          .replace("{reader}", "Lector 2"),
      ),
    );
  });

  it("a refused tap says why in the sheet, as an alert", async () => {
    const { el } = await phoneSheet({
      setDeviceEquipment: vi.fn().mockRejectedValue({ code: "device.equipment_held", status: 409 }),
    });
    await tap(el);

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(codeMessage("device.equipment_held")),
    );
    expect(inDialog(el, "[data-pay-notice]")!.getAttribute("role")).toBe("alert");
    expect(toast(el).open).toBe(false);
  });

  it("closing the sheet clears its notice, so the toast does not show it afterwards", async () => {
    const { el } = await phoneSheet();
    await tap(el);
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-notice]")).not.toBeNull());

    emit(dialog(el)!, "bill-pay-close");
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(toast(el).open).toBe(false);
  });

  it("a printer picked up for payment slips only says so in the sheet", async () => {
    const PORTABLE = equipmentItem(PRINTER_ID, "Portable printer", { portable: true });
    const slips = (chosen: EquipmentItem | null): DeviceEquipment => ({
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
        roleOf("payment_slip", chosen, [BAR_PRINTER, PORTABLE]),
        roleOf("card_terminal", SECOND_READER, [SECOND_READER, THIRD_READER]),
      ],
    });
    const { el } = await phoneSheet({
      getDeviceEquipment: vi.fn().mockResolvedValue(slips(null)),
      setDeviceEquipment: vi.fn().mockResolvedValue(slips(PORTABLE)),
    });
    (await nfcReader()).read(`waitron-equipment:printer:${PRINTER_ID}`);
    await flush(el);

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(
        t("equipment.picked_up_slip_only").replace("{item}", "Portable printer"),
      ),
    );
    expect(toast(el).open).toBe(false);
  });

  it("a notice from before the sheet opened is not shown in it, and the next tap is", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(THIRD_READER));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(SECOND_READER)),
        setDeviceEquipment,
      }),
    );
    const order = await openPhoneTable(el);
    await tap(el);
    await vi.waitFor(() => expect(toast(el).open).toBe(true));

    await pressPaySheet(el, order);

    expect(dialog(el)).not.toBeNull();
    expect(inDialog(el, "[data-pay-notice]")).toBeNull();
    expect(toast(el).open).toBe(false);
    await tap(el);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(pickedUp("Lector 3")),
    );
  });

  it("a tap on a presented bill's locked sheet shows above its buttons", async () => {
    const { el, order } = await phoneSheet({
      getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
      collectOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    emit(presented(el)!, "presented-pay", { method: "cash", tendered: "150.00", guestCount: 4 });
    await flush(el);
    await pressPaySheet(el, order);
    await presented(el)!.updateComplete;
    expect(presented(el)!.confirmation).toBeDefined();

    await tap(el);

    const line = () => presented(el)!.shadowRoot!.querySelector("[data-pay-notice]");
    await vi.waitFor(() => expect(text(line())).toBe(pickedUp("Lector 3")));
    const actions = presented(el)!.shadowRoot!.querySelector("wt-form-actions")!;
    expect(
      line()!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toast(el).open).toBe(false);
  });
});

describe("till-app: the next guest on a handheld", () => {
  const share: AllocationPreview = { ...wholeCard, applied: "40.00", charged: "40.00" };

  it("after the first of three shares, the sheet offers the second, which previews a share among two", async () => {
    const { el } = await mountApp(
      onPhone({
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi
          .fn()
          .mockResolvedValue(
            takenOf(
              { method: "card", entry: "reader", applied: "40.00", tip: "0.00", change: null },
              { received: "40.00", outstanding: "80.00" },
            ),
          ),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-next]"))).toBe(
        t("bill_pay.next_share").replace("{n}", "2").replace("{m}", "3"),
      ),
    );
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(text(inDialog(el, "[data-pay-taken-reader]"))).toBe(
      t("bill_pay.taken_on_reader")
        .replace("{amount}", money("40.00"))
        .replace("{reader}", "Lector 2"),
    );
    expect(inDialog(el, "till-pay-equipment")).toBeNull();

    await press(el, "[data-pay-next]");
    expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", "share");
    expect(await rowSummary(el)).toContain("Lector 2");
    await press(el, "[data-pay-continue]");
    expect(vi.mocked(api.previewBillPayment).mock.calls.at(-1)![1]).toMatchObject({
      kind: "share",
      shareOf: 2,
    });
  });

  it("a card still at the reader warns, and offers the next guest with no count", async () => {
    const { el } = await mountApp(
      onPhone({
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi.fn().mockResolvedValue({
          ...takenOf(
            { method: "card", entry: "reader", applied: "40.00", state: "pending", change: null },
            { reserved: "40.00", outstanding: "80.00" },
          ),
          outcome: "timeout",
        }),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
        t("bill_pay.uncertain").replace("{amount}", money("40.00")),
      ),
    );
    expect(text(inDialog(el, "[data-pay-next]"))).toBe(t("bill_pay.next"));
    expect(inDialog(el, "[data-pay-taken-reader]")).toBeNull();
    expect(inDialog(el, "[data-pay-continue]")).toBeNull();
  });

  it("three equal shares paid in turn offer the second, then the third, of three", async () => {
    const shareOf = (applied: string, outstanding: string) =>
      takenOf(
        { method: "card", entry: "reader", applied, tip: "0.00", change: null },
        { total: "120.00", received: (120 - Number(outstanding)).toFixed(2), outstanding },
      );
    const { el } = await mountApp(
      onPhone({
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi
          .fn()
          .mockResolvedValueOnce(shareOf("40.00", "80.00"))
          .mockResolvedValueOnce(shareOf("40.00", "40.00"))
          .mockResolvedValueOnce(shareOf("40.00", "0.00")),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-next]"))).toBe(
        t("bill_pay.next_share").replace("{n}", "2").replace("{m}", "3"),
      ),
    );

    await press(el, "[data-pay-next]");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() =>
      expect(text(inDialog(el, "[data-pay-next]"))).toBe(
        t("bill_pay.next_share").replace("{n}", "3").replace("{m}", "3"),
      ),
    );

    await press(el, "[data-pay-next]");
    await press(el, "[data-pay-continue]");
    expect(vi.mocked(api.previewBillPayment).mock.calls.at(-1)![1]).toMatchObject({
      kind: "share",
      shareOf: 1,
    });
  });
});

describe("till-app: a card the reader has not answered, on a handheld", () => {
  const share: AllocationPreview = { ...wholeCard, applied: "40.00", charged: "40.00" };
  const own = {
    id: "pay-own",
    submissionId: "sub-own",
    method: "card" as const,
    entry: "reader" as const,
    applied: "40.00",
    change: null,
    tendered: null,
  };
  const ownIs = (state: "pending" | "received" | "declined" | "failed") =>
    balanceOf({
      ...(state === "pending"
        ? { reserved: "40.00", outstanding: "80.00" }
        : state === "received"
          ? { received: "40.00", outstanding: "80.00" }
          : {}),
      payments: [paymentOf({ ...own, state })],
    });
  const PENDING_REREAD_MS = 5_000;
  const late = (key: "bill_pay.late_received" | "bill_pay.late_not_charged") =>
    t(key).replace("{amount}", money("40.00"));

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A share of three sent from the phone and answered that the card is still at the reader, with
   * the interval clock faked from just before the send — and the timeout clock too, with
   * `timeouts`. */
  async function pendingShare(
    getBillBalance = vi.fn(async () => ownIs("pending")),
    timeouts = false,
  ) {
    getBillBalance.mockImplementation(async () => balanceOf());
    const { el } = await mountApp(
      onPhone({
        getBillBalance,
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi.fn().mockResolvedValue({
          ...takenOf({ ...own, state: "pending" }, { reserved: "40.00", outstanding: "80.00" }),
          outcome: "timeout",
        }),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    if (timeouts) {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      inDialog(el, "[data-pay-confirm]")!.click();
      await settleFaked(el);
    } else {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await press(el, "[data-pay-confirm]");
      await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
      await flush(el);
    }
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
    getBillBalance.mockImplementation(async () => ownIs("pending"));
    const before = getBillBalance.mock.calls.length;
    return { el, order, reads: () => getBillBalance.mock.calls.length - before };
  }

  /** Lets the app's work run while the timeout clock is faked, where `flush` would wait forever. */
  async function settleFaked(el: TillApp): Promise<void> {
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
    }
  }

  async function tick(el: TillApp, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(PENDING_REREAD_MS);
      await flush(el);
    }
  }

  it("warns, names the manager, and reads the bill again every 5 seconds", async () => {
    const { el, reads } = await pendingShare();

    expect(text(inDialog(el, "[data-pay-uncertain-title]"))).toBe(t("bill_pay.uncertain_title"));
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.uncertain").replace("{amount}", money("40.00")),
    );
    expect(text(inDialog(el, "[data-pay-pending-manager]"))).toBe(t("bill_pay.pending_where"));
    expect(reads()).toBe(0);
    await tick(el);
    expect(reads()).toBe(1);
    await tick(el);
    expect(reads()).toBe(2);
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
  });

  it("sends no second read while the one before is still out", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance);
    getBillBalance.mockImplementation(() => new Promise<BillBalance>(() => {}));

    await tick(el, 3);

    expect(reads()).toBe(1);
  });

  it("a read that never answers is given up at the request limit, keeping the warning, and a later tick reads again", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance, true);
    vi.mocked(api.getBillBalance).mockImplementationOnce(
      (_id, options) =>
        new Promise<BillBalance>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new TypeError("Timed out")));
        }),
    );
    const at = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await settleFaked(el);
    };

    await at(PENDING_REREAD_MS);
    expect(reads()).toBe(1);
    await at(TABLE_REQUEST_LIMIT_MS - 1);
    expect(reads()).toBe(1);
    await at(1);
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
    expect(dialog(el)!.refusal).toBeNull();
    getBillBalance.mockResolvedValue(ownIs("received"));
    await at(PENDING_REREAD_MS);

    expect(reads()).toBe(2);
    expect(dialog(el)!.balance!.payments[0]!.state).toBe("received");
    expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
  });

  it("a failed read changes nothing shown, and the next tick reads again", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance);
    getBillBalance.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await tick(el);

    expect(reads()).toBe(1);
    expect(dialog(el)!.refusal).toBeNull();
    expect(el.shadowRoot!.textContent + dialog(el)!.shadowRoot!.textContent).not.toContain(
      t("bill_pay.read_failed"),
    );
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
    await tick(el);
    expect(reads()).toBe(2);
  });

  it("a received card shows as taken, offers the second of three, and stops the reads", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance);
    getBillBalance.mockResolvedValue(ownIs("received"));

    await tick(el);

    expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(text(inDialog(el, "[data-pay-next]"))).toBe(
      t("bill_pay.next_share").replace("{n}", "2").replace("{m}", "3"),
    );
    await tick(el, 3);
    expect(reads()).toBe(1);
  });

  it.each(["declined", "failed"] as const)(
    "a %s card says so on the form, ends the run of shares, and stops the reads",
    async (state) => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el, reads } = await pendingShare(getBillBalance);
      getBillBalance.mockResolvedValue(ownIs(state));

      await tick(el);

      expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
      expect(inDialog(el, "[data-pay-next]")).toBeNull();
      expect(inDialog(el, "wt-form-actions")!.error).toBe(
        t(state === "declined" ? "bill_pay.card_declined" : "bill_pay.payment_failed"),
      );
      expect(inDialog(el, 'wt-input[name="people"]')).toHaveProperty("value", "");
      await tick(el, 3);
      expect(reads()).toBe(1);
    },
  );

  it("a payment the bill no longer lists stops the reads and leaves the sheet as it was", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance);
    getBillBalance.mockResolvedValue(balanceOf({ outstanding: "120.00" }));

    await tick(el, 4);

    expect(reads()).toBe(1);
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
    expect(dialog(el)!.refusal).toBeNull();
  });

  it("a received card read while the next guest's payment is out says so in the notice and leaves the payment out", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el, reads } = await pendingShare(getBillBalance);
    vi.mocked(api.takeBillPayment).mockImplementation(() => new Promise(() => {}));
    await press(el, "[data-pay-next]");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(dialog(el)!.busy).toBe(true);
    getBillBalance.mockResolvedValue(ownIs("received"));

    await tick(el);

    expect(dialog(el)!.busy).toBe(true);
    expect(dialog(el)!.taken).toBeNull();
    expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_received"));
    await tick(el, 3);
    expect(reads()).toBe(1);
  });

  describe("once the sheet has moved on from that card", () => {
    const second = {
      id: "pay-2",
      submissionId: "sub-2",
      method: "card" as const,
      entry: "reader" as const,
      applied: "40.00",
      change: null,
      tendered: null,
    };
    const bothAt = (first: BillPaymentView["state"], next: Partial<BillPaymentView>) =>
      balanceOf({
        received: "40.00",
        reserved: "40.00",
        outstanding: "40.00",
        payments: [paymentOf({ ...own, state: first }), paymentOf(next)],
      });

    /** The next guest's share sent from the sheet, answered `answer`. */
    async function nextGuest(el: TillApp, answer: BillPaymentResult): Promise<void> {
      vi.mocked(api.takeBillPayment).mockResolvedValueOnce(answer);
      await press(el, "[data-pay-next]");
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      await vi.waitFor(() => expect(dialog(el)!.busy).toBe(false));
      await flush(el);
    }

    it("a read sent before the next guest's payment was answered never puts back the older balance", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      let answerOld: () => void = () => {};
      getBillBalance.mockImplementationOnce(
        () => new Promise<BillBalance>((resolve) => (answerOld = () => resolve(ownIs("pending")))),
      );
      await tick(el);
      const after = bothAt("pending", { ...second, state: "received" });
      getBillBalance.mockResolvedValue(after);

      await nextGuest(el, { ...takenOf({ ...second, state: "received" }, {}), balance: after });
      expect(dialog(el)!.balance!.outstanding).toBe("40.00");
      answerOld();
      await flush(el);

      expect(dialog(el)!.balance!.outstanding).toBe("40.00");
      expect(dialog(el)!.balance!.payments).toHaveLength(2);
    });

    it("the earlier card received after the next guest's card keeps the next guest's taken view and says so in the notice", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      const after = bothAt("pending", { ...second, state: "received" });
      await nextGuest(el, { ...takenOf({ ...second, state: "received" }, {}), balance: after });
      const shown = dialog(el)!.taken;
      expect(text(inDialog(el, "[data-pay-taken-reader]"))).toContain("Lector 2");
      getBillBalance.mockResolvedValue(bothAt("received", { ...second, state: "received" }));

      await tick(el);

      expect(dialog(el)!.taken).toBe(shown);
      expect(text(inDialog(el, "[data-pay-taken-reader]"))).toContain("Lector 2");
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_received"));
      expect(dialog(el)!.balance!.payments[0]!.state).toBe("received");
    });

    it("the earlier card received after the next guest paid cash keeps the change to give on screen", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      const paidCash = {
        id: "pay-2",
        submissionId: "sub-2",
        method: "cash" as const,
        entry: null,
        applied: "40.00",
        tendered: "50.00",
        change: "10.00",
        state: "received" as const,
      };
      const after = bothAt("pending", paidCash);
      vi.mocked(api.previewBillPayment).mockResolvedValueOnce(cash("40.00", "10.00"));
      vi.mocked(api.takeBillPayment).mockResolvedValueOnce({
        ...takenOf(paidCash, {}),
        balance: after,
      });
      await press(el, "[data-pay-next]");
      await press(el, 'input[name="method"][value="cash"]');
      await type(el, "tendered", "50");
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      const change = t("bill_pay.taken_change").replace("{amount}", money("10.00"));
      await vi.waitFor(() => expect(text(inDialog(el, "[data-pay-taken]"))).toBe(change));
      getBillBalance.mockResolvedValue(bothAt("received", paidCash));

      await tick(el);

      expect(text(inDialog(el, "[data-pay-taken]"))).toBe(change);
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_received"));
    });

    it("the earlier card declined after the next guest's card says it is still owed, keeping the taken view", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      const after = bothAt("pending", { ...second, state: "received" });
      await nextGuest(el, { ...takenOf({ ...second, state: "received" }, {}), balance: after });
      const shown = dialog(el)!.taken;
      getBillBalance.mockResolvedValue(bothAt("declined", { ...second, state: "received" }));

      await tick(el);

      expect(dialog(el)!.taken).toBe(shown);
      expect(dialog(el)!.refusal).toBeNull();
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_not_charged"));
    });

    it("the earlier card received while the next guest's form is being filled keeps the form and drops the warning", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      await press(el, "[data-pay-next]");
      await type(el, "people", "5");
      getBillBalance.mockResolvedValue(ownIs("received"));

      await tick(el);

      expect(inDialog(el, 'wt-input[name="people"]')).toHaveProperty("value", "5");
      expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
      expect(dialog(el)!.taken).toBeNull();
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_received"));
    });

    it("a second card at the reader keeps the first one watched: its decline is said beside the second's warning", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el, reads } = await pendingShare(getBillBalance);
      const pendingSecond = { ...second, state: "pending" as const };
      await nextGuest(el, {
        ...takenOf(pendingSecond, { reserved: "80.00", outstanding: "40.00" }),
        outcome: "timeout",
      });
      expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
      getBillBalance.mockResolvedValue(bothAt("declined", pendingSecond));

      await tick(el);

      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_not_charged"));
      expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();
      expect(dialog(el)!.refusal).toBeNull();
      await press(el, "[data-pay-next]");
      expect(inDialog(el, 'wt-input[name="people"]')).toHaveProperty("value", "");

      getBillBalance.mockResolvedValue(bothAt("declined", { ...second, state: "received" }));
      await tick(el);
      expect(reads()).toBe(2);
      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_received"));
      await tick(el, 3);
      expect(reads()).toBe(2);
    });

    it("the first card declined after a second card was received still ends the run of shares", async () => {
      const getBillBalance = vi.fn(async () => ownIs("pending"));
      const { el } = await pendingShare(getBillBalance);
      const pendingSecond = { ...second, state: "pending" as const };
      await nextGuest(el, {
        ...takenOf(pendingSecond, { reserved: "80.00", outstanding: "40.00" }),
        outcome: "timeout",
      });
      getBillBalance.mockResolvedValue(bothAt("pending", { ...second, state: "received" }));
      await tick(el);
      expect(text(inDialog(el, "[data-pay-next]"))).toBe(
        t("bill_pay.next_share").replace("{n}", "3").replace("{m}", "3"),
      );
      getBillBalance.mockResolvedValue(
        balanceOf({
          received: "40.00",
          outstanding: "80.00",
          payments: [
            paymentOf({ ...own, state: "declined" }),
            paymentOf({ ...second, state: "received" }),
          ],
        }),
      );

      await tick(el);

      expect(text(inDialog(el, "[data-pay-notice]"))).toBe(late("bill_pay.late_not_charged"));
      expect(text(inDialog(el, "[data-pay-next]"))).toBe(t("bill_pay.next"));
      await press(el, "[data-pay-next]");
      expect(inDialog(el, 'wt-input[name="people"]')).toHaveProperty("value", "");
    });
  });

  /** A whole-bill card sent from the phone and answered that it is still at the reader, then a
   * read that finds it received and the bill settled. */
  async function settlingCard(
    getFiledTicket: ReturnType<typeof vi.fn>,
    overrides: Record<string, unknown> = {},
  ) {
    const getBillBalance = vi.fn(async () => balanceOf());
    const whole = { ...own, applied: "120.00" };
    const { el } = await mountApp(
      onPhone({
        ...overrides,
        getBillBalance,
        getFiledTicket,
        takeBillPayment: vi.fn().mockResolvedValue({
          ...takenOf({ ...whole, state: "pending" }, { reserved: "120.00", outstanding: "0.00" }),
          outcome: "timeout",
        }),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    getBillBalance.mockResolvedValue(
      balanceOf({
        status: "settled",
        received: "120.00",
        outstanding: "0.00",
        payments: [paymentOf({ ...whole, state: "received" })],
      }),
    );
    return el;
  }

  it("a received card that settles a full invoice's bill shows the ticket, as a card answered at once does", async () => {
    const getFiledTicket = vi.fn().mockResolvedValue(invoiceOf("120.00", "F1"));
    const el = await settlingCard(getFiledTicket, {
      getPartyBills: vi.fn().mockResolvedValue([billOf({ invoiceType: "F1" })]),
    });

    await tick(el);

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(dialog(el)).toBeNull();
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
  });

  it("a received card that settles a simplified invoice's bill shows the document choice, with the read's payments", async () => {
    const getFiledTicket = vi.fn().mockResolvedValue(invoiceOf("120.00", "F2"));
    const el = await settlingCard(getFiledTicket);

    await tick(el);

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(ticketView(el)).toBeNull();
    expect(dialog(el)).toBeNull();
    expect(documentChoice(el)!.result.total).toBe("120.00");
    expect(getFiledTicket).toHaveBeenCalledOnce();
  });

  it("a ticket that cannot be read leaves the sheet as it is, and the next tick tries again", async () => {
    const getFiledTicket = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(invoiceOf("120.00", "F2"));
    const el = await settlingCard(getFiledTicket);

    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
    expect(documentChoice(el)).toBeNull();
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();

    await tick(el);
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(getFiledTicket).toHaveBeenCalledTimes(2);
  });

  it("a ticket read that fails after another tick has come is tried again, and the document choice then shows", async () => {
    let fail: () => void = () => {};
    const getFiledTicket = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (fail = () => reject(new TypeError("Failed to fetch")))),
      )
      .mockResolvedValue(invoiceOf("120.00", "F2"));
    const el = await settlingCard(getFiledTicket);
    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);

    fail();
    await flush(el);
    expect(documentChoice(el)).toBeNull();
    await tick(el);

    expect(getFiledTicket).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(dialog(el)).toBeNull();
  });

  it("a ticket read answered after the sheet closed shows nothing", async () => {
    let answer: () => void = () => {};
    const getFiledTicket = vi.fn(
      () => new Promise((resolve) => (answer = () => resolve(invoiceOf("120.00", "F2")))),
    );
    const el = await settlingCard(getFiledTicket);
    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);

    answer();
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(ticketView(el)).toBeNull();
    expect(documentChoice(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-pay-notice]")).toBeNull();
  });

  it("an older read answering after a newer one changes nothing", async () => {
    const getBillBalance = vi.fn(async () => ownIs("pending"));
    const { el } = await pendingShare(getBillBalance);
    let answerOlder: () => void = () => {};
    getBillBalance.mockImplementationOnce(
      () => new Promise<BillBalance>((resolve) => (answerOlder = () => resolve(ownIs("pending")))),
    );
    await tick(el);
    getBillBalance.mockResolvedValue(ownIs("received"));
    vi.mocked(api.previewBillPayment).mockRejectedValueOnce({ code: "bill.not_open" });
    await press(el, "[data-pay-next]");
    await press(el, "[data-pay-continue]");
    await vi.waitFor(() => expect(dialog(el)!.balance!.payments[0]!.state).toBe("received"));

    answerOlder();
    await flush(el);

    expect(dialog(el)!.balance!.payments[0]!.state).toBe("received");
  });

  it("closing the sheet stops the reads", async () => {
    const { el, reads } = await pendingShare();
    const closed = new Promise((resolve) =>
      inDialog(el, "wt-dialog")!.addEventListener("wt-close", resolve, { once: true }),
    );

    await press(el, "[data-pay-close]");
    await closed;
    await flush(el);
    expect(dialog(el)).toBeNull();

    await tick(el, 3);
    expect(reads()).toBe(0);
  });

  it("logging out stops the reads", async () => {
    const { el, reads } = await pendingShare();

    emit(shell(el), "logout");
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes");
    if (question?.open) await discardUnsavedLeave(el);
    expect(dialog(el)).toBeNull();

    await tick(el, 3);
    expect(reads()).toBe(0);
  });

  it("taking the till off the page stops the reads", async () => {
    const { el, reads } = await pendingShare();

    el.remove();
    await tick(el, 3);

    expect(reads()).toBe(0);
  });

  it("another phone's card in progress on the bill shows no warning and starts no reads", async () => {
    const getBillBalance = vi.fn(async () =>
      balanceOf({
        reserved: "40.00",
        outstanding: "80.00",
        payments: [paymentOf({ ...own, submissionId: "sub-other", state: "pending" })],
      }),
    );
    const { el } = await mountApp(onPhone({ getBillBalance }));
    const order = await openPhoneTable(el);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(dialog(el)!.balance).not.toBeNull());
    const before = getBillBalance.mock.calls.length;

    await tick(el, 3);

    expect(getBillBalance.mock.calls.length).toBe(before);
    expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
    expect(inDialog(el, "[data-pay-reserved]")).not.toBeNull();
  });

  it("a card the opening read finds still in progress for this phone's unanswered send warns and reads again", async () => {
    const getBillBalance = vi.fn(async () => balanceOf());
    const { el } = await mountApp(
      onPhone({
        getBillBalance,
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    const submissionId = sent()[0]!.submissionId;
    getBillBalance.mockResolvedValue(
      balanceOf({
        reserved: "40.00",
        outstanding: "80.00",
        payments: [paymentOf({ ...own, submissionId, state: "pending" })],
      }),
    );
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    const before = getBillBalance.mock.calls.length;

    await tick(el);

    expect(getBillBalance.mock.calls.length).toBe(before + 1);
  });

  describe("the sheet's automatic re-reads never keep the till signed in", () => {
    const IDLE_SECONDS = 30;
    const signedIn = (el: TillApp) => (el as unknown as { operatorName: string }).operatorName;

    async function settle(el: TillApp): Promise<void> {
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(0);
        await el.updateComplete;
      }
    }

    it("the 5-second re-reads of a pending card run on, and the till still logs out on time", async () => {
      const getBillBalance = vi.fn(async () => balanceOf());
      const { el } = await mountApp(
        onPhone(
          {
            getBillBalance,
            previewBillPayment: vi.fn().mockResolvedValue(share),
            takeBillPayment: vi.fn().mockResolvedValue({
              ...takenOf({ ...own, state: "pending" }, { reserved: "40.00", outstanding: "80.00" }),
              outcome: "timeout",
            }),
          },
          { inactivityTimeoutSeconds: IDLE_SECONDS },
        ),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await press(el, 'input[name="way"][value="share"]');
      await type(el, "people", "3");
      await press(el, 'input[name="method"][value="card"]');
      await press(el, "[data-pay-continue]");
      vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "Date", "setTimeout", "clearTimeout"],
      });
      emit(el, "pointerdown");
      inDialog(el, "[data-pay-confirm]")!.click();
      await settle(el);
      await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
      getBillBalance.mockImplementation(async () => ownIs("pending"));
      const before = getBillBalance.mock.calls.length;

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(PENDING_REREAD_MS - 1);
        await settle(el);
        await vi.advanceTimersByTimeAsync(1);
        await settle(el);
      }

      expect(getBillBalance.mock.calls.length - before).toBe(5);
      expect(signedIn(el)).not.toBe("");
      expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();

      await vi.advanceTimersByTimeAsync(PENDING_REREAD_MS);
      await settle(el);

      expect(signedIn(el)).toBe("");
      expect(dialog(el)).toBeNull();
    });

    it("the equipment read when the sheet opens does not move the logout past the tap that opened it", async () => {
      let answer!: (equipment: DeviceEquipment) => void;
      const overrides = onPhone({}, { inactivityTimeoutSeconds: IDLE_SECONDS });
      const { el } = await mountApp(overrides);
      const order = await openPhoneTable(el);
      overrides.getDeviceEquipment.mockImplementationOnce(
        () => new Promise<DeviceEquipment>((resolve) => (answer = resolve)),
      );
      const readsBefore = overrides.getDeviceEquipment.mock.calls.length;
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

      const payButton = inOrder(order, "[data-pay-sheet]")!;
      emit(payButton, "pointerdown");
      payButton.click();
      await settle(el);
      expect(overrides.getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
      await vi.advanceTimersByTimeAsync(10_000);
      answer(equipmentWith(SECOND_READER));
      await settle(el);

      expect(dialog(el)).not.toBeNull();
      expect(await rowSummary(el)).toContain("Lector 2");

      await vi.advanceTimersByTimeAsync(IDLE_SECONDS * 1000 - 10_001);
      await settle(el);
      expect(signedIn(el)).not.toBe("");

      await vi.advanceTimersByTimeAsync(1);
      await settle(el);
      expect(signedIn(el)).toBe("");
      expect(dialog(el)).toBeNull();
    });
  });
});

describe("the document choice on a handheld", () => {
  const share: AllocationPreview = { ...wholeCard, applied: "40.00", charged: "40.00" };
  const simplified = () => invoiceOf("120.00", "F2");
  const full = () => invoiceOf("120.00", "F1");
  const inChoice = (el: TillApp, selector: string) =>
    documentChoice(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const sharePaid = (n: number) =>
    paymentOf({
      id: `pay-${n}`,
      submissionId: `sub-${n}`,
      method: "card",
      entry: "reader",
      applied: "40.00",
      tendered: null,
      change: null,
    });
  const shareOf = (outstanding: string, invoice?: TillSaleResult) =>
    takenOf(
      { method: "card", entry: "reader", applied: "40.00", tip: "0.00", change: null },
      {
        total: "120.00",
        received: (120 - Number(outstanding)).toFixed(2),
        outstanding,
        ...(outstanding === "0.00"
          ? { status: "settled" as const, payments: [1, 2, 3].map(sharePaid) }
          : {}),
      },
      invoice,
    );
  const printed = { status: "done" as const, jobId: "job-1", canRetry: false };
  const onRequest = {
    listZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: { ...offers.context, receiptPrintMode: "on_request" },
    }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: { ...offers.context, receiptPrintMode: "on_request" },
    }),
  };

  /** Three equal shares paid in turn from the phone, the third answered with `invoice`. */
  async function threeShares(
    invoice: TillSaleResult,
    overrides: Record<string, unknown> = {},
    tillOver: Record<string, unknown> = {},
    theme?: "light" | "dark",
  ) {
    const stubs = onPhone(
      {
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi
          .fn()
          .mockResolvedValueOnce(shareOf("80.00"))
          .mockResolvedValueOnce(shareOf("40.00"))
          .mockResolvedValueOnce(shareOf("0.00", invoice)),
        getReceiptPrintStatus: vi.fn().mockResolvedValue(printed),
        getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
        printReceipt: vi.fn().mockResolvedValue(undefined),
        retryReceipt: vi.fn().mockResolvedValue({ jobId: "job-2" }),
        finishTable: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      },
      tillOver,
    );
    api = stubApi(stubs);
    const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    for (const next of [2, 3]) {
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      await vi.waitFor(() =>
        expect(text(inDialog(el, "[data-pay-next]"))).toBe(
          t("bill_pay.next_share").replace("{n}", String(next)).replace("{m}", "3"),
        ),
      );
      await press(el, "[data-pay-next]");
    }
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el);
    return { el };
  }

  it("the third share's answer with a simplified invoice shows the document choice with its three payments", async () => {
    const { el } = await threeShares(simplified());

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(ticketView(el)).toBeNull();
    expect(dialog(el)).toBeNull();
    expect(vi.mocked(api.takeBillPayment)).toHaveBeenCalledTimes(3);
    expect(documentChoice(el)!.result.total).toBe("120.00");
    expect(documentChoice(el)!.originalReceiptPrint).toEqual(printed);
    expect(vi.mocked(api.getReceiptPrintStatus)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.getReceiptPrintStatus)).toHaveBeenCalledWith("wo-4");
    expect(vi.mocked(api.getInvoiceDeliveries)).not.toHaveBeenCalled();
    expect(vi.mocked(api.finishTable)).not.toHaveBeenCalled();
  });

  it("a last share paid in cash shows its change in the document choice's list, and no second change line", async () => {
    const cashShare = paymentOf({
      id: "pay-3",
      submissionId: "sub-3",
      method: "cash",
      entry: null,
      applied: "40.00",
      tendered: "50.00",
      change: "10.00",
    });
    const { el } = await threeShares(simplified(), {
      takeBillPayment: vi
        .fn()
        .mockResolvedValueOnce(shareOf("80.00"))
        .mockResolvedValueOnce(shareOf("40.00"))
        .mockResolvedValueOnce(
          takenOf(
            { method: "cash", entry: null, applied: "40.00", tendered: "50.00", change: "10.00" },
            {
              total: "120.00",
              received: "120.00",
              outstanding: "0.00",
              status: "settled",
              payments: [sharePaid(1), sharePaid(2), cashShare],
            },
            { ...simplified(), tender: { method: "cash", change: "10.00" } },
          ),
        ),
    });

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    await documentChoice(el)!.updateComplete;
    expect(text(inChoice(el, "[data-settlement-change]"))).toContain(
      `${t("label.change")} ${money("10.00")}`,
    );
  });

  it("where receipts print on request, the original-print action prints it once and reads the ticket again", async () => {
    const { el } = await threeShares(simplified(), {
      ...onRequest,
      getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    });
    await vi.waitFor(() => expect(inChoice(el, '[data-test="print-receipt"]')).not.toBeNull());

    inChoice(el, '[data-test="print-receipt"]')!.click();
    await flush(el);

    expect(vi.mocked(api.printReceipt)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.printReceipt)).toHaveBeenCalledWith("wo-4");
    expect(vi.mocked(api.getReceiptPrintStatus)).toHaveBeenCalledTimes(2);
    expect(documentChoice(el)!.originalReceiptAvailable).toBe(false);
  });

  it("a ticket that failed to print is retried from the document choice", async () => {
    const { el } = await threeShares(simplified(), {
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValue({ status: "failed", jobId: "job-1", canRetry: true }),
    });
    await vi.waitFor(() => expect(inChoice(el, '[data-test="retry-receipt"]')).not.toBeNull());

    inChoice(el, '[data-test="retry-receipt"]')!.click();
    await flush(el);

    expect(vi.mocked(api.retryReceipt)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.retryReceipt)).toHaveBeenCalledWith("wo-4");
    expect(vi.mocked(api.printReceipt)).not.toHaveBeenCalled();
  });

  it.each([
    ["where receipts print on request", true],
    ["where receipts print by themselves", false],
  ] as const)(
    "%s, a device that may not print is offered neither the original print nor a retry",
    async (_, requested) => {
      const { el } = await threeShares(
        simplified(),
        {
          ...(requested ? onRequest : {}),
          getReceiptPrintStatus: vi
            .fn()
            .mockResolvedValue({ status: "failed", jobId: "job-1", canRetry: true }),
        },
        { capabilities: phoneCapabilities.filter((flag) => flag !== "print-receipt") },
      );
      await vi.waitFor(() => expect(documentChoice(el)?.originalReceiptPrint).not.toBeNull());
      expect(documentChoice(el)!.canPrintReceipt).toBe(false);
      expect(documentChoice(el)!.canPrintReceipt).toBe(false);
      expect(inChoice(el, '[data-test="print-receipt"]')).toBeNull();
      expect(inChoice(el, '[data-test="retry-receipt"]')).toBeNull();
      expect(inChoice(el, '[data-test="reprint"]')).toBeNull();
    },
  );

  it("a failed ticket read is checked again from the document choice", async () => {
    const getReceiptPrintStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(printed);
    const { el } = await threeShares(simplified(), { getReceiptPrintStatus });
    await vi.waitFor(() => expect(documentChoice(el)?.originalReceiptReadFailed).toBe(true));
    expect(text(inChoice(el, '[data-test="original-delivery"]'))).toContain(
      t("invoice.print_status_failed"),
    );

    inChoice(el, '[data-test="refresh-receipt"]')!.click();
    await flush(el);

    expect(getReceiptPrintStatus).toHaveBeenCalledTimes(2);
    expect(documentChoice(el)!.originalReceiptReadFailed).toBe(false);
    expect(text(inChoice(el, '[data-test="original-delivery"]'))).toContain(
      t("invoice.print_done"),
    );
  });

  it("Reimprimir queues a copy of the ticket", async () => {
    const { el } = await threeShares(simplified());
    await vi.waitFor(() => expect(inChoice(el, '[data-test="reprint"]')).not.toBeNull());

    inChoice(el, '[data-test="reprint"]')!.click();
    await flush(el);

    expect(vi.mocked(api.reprint)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.reprint).mock.calls[0]![0]).toBe("wo-4");
  });

  it("Finish table finishes the table once", async () => {
    const { el } = await threeShares(simplified());
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());

    await finishFromTable(el);

    expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.finishTable).mock.calls[0]![0]).toBe("v1");
  });

  it("Back to the table returns to the table's order without a new history entry", async () => {
    const { el } = await threeShares(simplified());
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    try {
      inChoice(el, "[data-settlement-none]")!.click();
      await flush(el);

      expect(documentChoice(el)).toBeNull();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el).checkVisibility()).toBe(true);
      expect(vi.mocked(api.getPartyBills).mock.calls.length).toBe(reads + 1);
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(vi.mocked(api.finishTable)).not.toHaveBeenCalled();
    } finally {
      push.mockRestore();
      replace.mockRestore();
    }
  });

  it("Finish table refused because another bill still owes leaves the document choice for the table's refusal", async () => {
    const { el } = await threeShares(simplified(), {
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;

    await finishFromTable(el);

    expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(1);
    expect(documentChoice(el)).toBeNull();
    expect(tableOrder(el).checkVisibility()).toBe(true);
    const refusal = inOrder(tableOrder(el), "[data-finish-refusal]");
    expect(refusal).not.toBeNull();
    expect(refusal!.checkVisibility()).toBe(true);
    expect(text(refusal!.querySelector("span"))).toBe(codeMessage("party.bill_outstanding"));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads);
  });

  it.each([
    ["holds money", { code: "bill.payments_received" }],
    ["changed elsewhere", { code: "draft.out_of_date" }],
    ["taken over", { code: "draft.taken_over" }],
    ["not permitted", { code: "authorization.not_permitted" }],
    ["unanswered", new TypeError("Failed to fetch")],
  ] as const)(
    "Finish table refused (%s) on the document choice says so where it can be seen",
    async (_, refusal) => {
      const { el } = await threeShares(simplified(), {
        finishTable: vi.fn().mockRejectedValue(refusal),
      });
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());

      await finishFromTable(el);

      const alert = el.shadowRoot!.querySelector<HTMLElement>('p.error[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert!.checkVisibility()).toBe(true);
      expect(text(alert)).not.toBe("");
    },
  );

  const unserved = {
    billId: "wo-4",
    billRevision: 0,
    lineId: "line-1",
    name: "Flan",
    quantity: "1.000",
    context: {
      billStatus: "settled",
      stage: "not_started",
      components: [
        {
          id: "ticket-line-1",
          lineId: "line-1",
          state: "queued",
          firedAt: null,
          requestedAt: null,
          stationId: "station-1",
          quantity: "1.000",
          kitchenQuantity: "1.000",
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    },
  };

  /** The document choice's Finish table answered that a paid dish is not served yet, then the
   * confirmation's send answered `refusal`. */
  async function refusedAfterUnserved(
    refusal: { code: string },
    overrides: Record<string, unknown> = {},
  ) {
    const { el } = await threeShares(simplified(), {
      finishTable: vi
        .fn()
        .mockRejectedValueOnce({ code: "party.unserved_dishes", partyId: "v1", dishes: [unserved] })
        .mockRejectedValue(refusal),
      getCancellation: vi.fn().mockResolvedValue({
        billId: "wo-4",
        billRevision: 0,
        revision: 3,
        context: structuredClone(unserved.context),
      }),
      ...overrides,
    });
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());

    await finishFromTable(el);
    await flush(el, 8);

    const confirm = el.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("till-finish-table-dialog");
    expect(confirm).not.toBeNull();
    await confirm!.updateComplete;
    expect(
      confirm!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.checkVisibility(),
    ).toBe(true);
    const reason = confirm!.shadowRoot!.querySelector('wt-combobox[name="reason"]')!;
    const choices = (reason as unknown as { options: { value: string }[] }).options;
    emit(reason, "wt-change", { value: choices[0]!.value });
    await confirm!.updateComplete;
    await userEvent.click(confirm!.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!);
    await flush(el, 8);

    expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("till-finish-table-dialog")).toBeNull();
    return el;
  }

  /** The document choice is gone and the order screen shows the instruction to give the money back. */
  function holdsMoneyOnOrder(el: TillApp): void {
    expect(documentChoice(el)).toBeNull();
    expect(tableOrder(el).checkVisibility()).toBe(true);
    const alert = el.shadowRoot!.querySelector<HTMLElement>('p.error[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.checkVisibility()).toBe(true);
    expect(text(alert)).toBe(t("table.finish_bill_holds_money"));
  }

  it("Finish table with paid dishes not yet served opens the confirmation over the document choice; refused there because a bill owes, it leaves for the table's refusal", async () => {
    const el = await refusedAfterUnserved({ code: "party.bill_outstanding" });

    expect(documentChoice(el)).toBeNull();
    const refusal = inOrder(tableOrder(el), "[data-finish-refusal]");
    expect(refusal).not.toBeNull();
    expect(refusal!.checkVisibility()).toBe(true);
  });

  it.each(["party.bill_outstanding", "bill.payments_received"])(
    "the confirmation for paid dishes not yet served, refused with %s, shows Still to pay as the floor now answers it",
    async (code) => {
      const el = await refusedAfterUnserved(
        { code },
        {
          getTablesState: vi.fn(async () => [
            mesa({
              outstanding: vi.mocked(api.finishTable).mock.calls.length < 2 ? "170.00" : "50.00",
            }),
          ]),
        },
      );

      expect(documentChoice(el)).toBeNull();
      expect(text(inOrder(tableOrder(el), "[data-party-outstanding]"))).toBe(money("50.00"));
    },
  );

  it("Finish table refused because a bill holds money leaves the document choice, and the order screen keeps the instruction", async () => {
    const { el } = await threeShares(simplified(), {
      finishTable: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    });
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());

    await finishFromTable(el);

    expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(1);
    holdsMoneyOnOrder(el);
  });

  it("the confirmation for paid dishes not yet served, refused because a bill holds money, leaves the document choice with the instruction", async () => {
    const el = await refusedAfterUnserved({ code: "bill.payments_received" });

    holdsMoneyOnOrder(el);
  });

  it("a ticket read that never answers leaves Finish table and Back to the table pressable; Finish table sends once", async () => {
    const { el } = await threeShares(simplified(), {
      getReceiptPrintStatus: vi.fn(() => new Promise(() => {})),
      finishTable: vi.fn(() => new Promise(() => {})),
    });
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    await documentChoice(el)!.updateComplete;
    expect(
      inChoice(el, "[data-settlement-none]")!.shadowRoot!.querySelector("button")!.disabled,
    ).toBe(false);

    await finishFromTable(el);
    await openTableMenu(tableOrder(el));
    await userEvent.click(inOrder(tableOrder(el), "[data-table-menu] [data-finish-table]")!);
    await flush(el);

    expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(1);
  });

  it("collecting a bill through Find a bill on a handheld opens the document choice", async () => {
    const { el } = await mountApp(
      onPhone({ collectOrder: vi.fn().mockResolvedValue(simplified()) }),
    );
    await openPhoneTable(el);

    emit(shell(el), "find-bill-pay", {
      workingOrderId: "wo-4",
      tender: { method: "cash", amount: "120.00" },
      invoiced: false,
    });
    await flush(el);

    expect(vi.mocked(api.collectOrder)).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(ticketView(el)).toBeNull();
  });

  it("a full invoice still shows the document choice", async () => {
    const { el } = await threeShares(full());

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(ticketView(el)).toBeNull();
  });

  it("a share that leaves money owing shows no document choice", async () => {
    const { el } = await mountApp(
      onPhone({
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi.fn().mockResolvedValue(shareOf("80.00")),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await vi.waitFor(() => expect(inDialog(el, "[data-pay-next]")).not.toBeNull());
    expect(documentChoice(el)).toBeNull();
    expect(ticketView(el)).toBeNull();
  });

  it("the sheet's own card still at the reader shows no document choice", async () => {
    const { el } = await mountApp(
      onPhone({
        takeBillPayment: vi.fn().mockResolvedValue({
          ...takenOf(
            { method: "card", entry: "reader", applied: "120.00", state: "pending", change: null },
            { reserved: "120.00", outstanding: "0.00" },
          ),
          outcome: "timeout",
        }),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    expect(documentChoice(el)).toBeNull();
    expect(ticketView(el)).toBeNull();
  });

  it("a counter till paying a bill with a simplified invoice still shows the document choice and reads no ticket", async () => {
    const getReceiptPrintStatus = vi.fn();
    const { el } = await mountApp({
      getReceiptPrintStatus,
      takeBillPayment: vi
        .fn()
        .mockResolvedValue(
          takenOf(
            { applied: "120.00", tendered: "120.00", change: "0.00" },
            { received: "120.00", outstanding: "0.00", status: "settled" },
            simplified(),
          ),
        ),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "120");
    await type(el, "tendered", "120");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(ticketView(el)).toBeNull();
    expect(getReceiptPrintStatus).toHaveBeenCalledOnce();
  });

  describe("on the presented path", () => {
    it("a simplified invoice shows the document choice, with no list of payments", async () => {
      const { el } = await payPresented(simplified());

      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      expect(ticketView(el)).toBeNull();
      expect(documentChoice(el)!.result.total).toBe("120.00");
      expect(vi.mocked(api.getReceiptPrintStatus)).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["cash", { method: "cash", tendered: "150.00", guestCount: 4 }],
      ["another card machine", { method: "manual", externalRef: "OP-7", guestCount: 4 }],
    ] as const)(
      "%s with a simplified invoice shows the document choice, with no list of payments",
      async (_, detail) => {
        const { el } = await payPresented(simplified(), undefined, detail);

        expect(vi.mocked(api.collectOrder)).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
        expect(ticketView(el)).toBeNull();
        expect(documentChoice(el)!.result.total).toBe("120.00");
      },
    );

    it("a device whose profile allows the drawer is offered Open drawer, which opens it once", async () => {
      const { el } = await payPresented(
        simplified(),
        undefined,
        { method: "cash", tendered: "150.00", guestCount: 4 },
        { capabilities: [...phoneCapabilities, "open-cash-drawer"] },
      );
      await vi.waitFor(() => expect(inChoice(el, '[data-test="open-drawer"]')).not.toBeNull());

      await userEvent.click(inChoice(el, '[data-test="open-drawer"]')!);
      await flush(el);

      expect(vi.mocked(api.openDrawer)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.openDrawer)).toHaveBeenCalledWith();
    });

    it("a device whose profile does not allow the drawer is offered no Open drawer", async () => {
      const { el } = await payPresented(simplified(), undefined, {
        method: "cash",
        tendered: "150.00",
        guestCount: 4,
      });
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      await documentChoice(el)!.updateComplete;

      expect(inChoice(el, '[data-test="open-drawer"]')).toBeNull();
    });

    it("a full invoice still shows the document choice", async () => {
      const { el } = await payPresented(full());

      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      expect(ticketView(el)).toBeNull();
    });
  });

  /** A presented bill paid on the phone's reader, or from the sheet with `detail`, answered with
   * `invoice`. */
  async function payPresented(
    invoice: TillSaleResult,
    theme?: "light" | "dark",
    detail?: PresentedPayDetail,
    tillOver: Record<string, unknown> = {},
  ) {
    const stubs = onPhone(
      {
        getPartyBills: vi
          .fn()
          .mockResolvedValue([billOf({ status: "placed", receiptAvailable: true })]),
        pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: invoice }),
        collectOrder: vi.fn().mockResolvedValue(invoice),
        getReceiptPrintStatus: vi.fn().mockResolvedValue(printed),
        getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
        openDrawer: vi.fn().mockResolvedValue(undefined),
      },
      tillOver,
    );
    api = stubApi(stubs);
    const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    const sheet = el.shadowRoot!.querySelector<TillPresentedPayDialog>(
      "till-presented-pay-dialog",
    )!;
    await sheet.updateComplete;
    if (detail === undefined)
      sheet.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!.click();
    else emit(sheet, "presented-pay", detail);
    await flush(el);
    return { el };
  }

  /** A part-paid counter order paid off through Find bill, from a phone, in one last payment. */
  async function payCounterOrder({ tableHeld }: { tableHeld: boolean }) {
    const counter = billRow({ workingOrderId: "wo-counter", label: "Lucía" });
    const getPartyBills = vi
      .fn()
      .mockResolvedValue([
        billOf(),
        billOf({ workingOrderId: "wo-5", billNumber: 2, total: "30.00", outstanding: "30.00" }),
      ]);
    const { el } = await mountApp(
      onPhone({
        getPartyBills,
        getTablesState: vi.fn().mockResolvedValue([mesa({ billCount: 2 })]),
        findBillOptions: vi.fn().mockResolvedValue(billOptions),
        listBills: vi.fn().mockResolvedValue(listPage([counter])),
        getFindBill: vi.fn().mockResolvedValue(counter),
        retrieveWorkingOrder: vi.fn().mockResolvedValue({
          kitchenNote: {
            scope: { workingOrderId: "wo-counter" },
            note: null,
            revision: 0,
            ownerRevision: 0,
          },
          id: "wo-counter",
          orderNumber: 42,
          label: "Lucía",
          lines: [],
        }),
        previewBillPayment: vi.fn().mockResolvedValue(share),
        takeBillPayment: vi.fn().mockResolvedValue(
          takenOf(
            { method: "card", entry: "reader", applied: "20.10", tendered: null, change: null },
            {
              workingOrderId: "wo-counter",
              total: "25.10",
              received: "25.10",
              outstanding: "0.00",
              status: "settled",
              payments: [sharePaid(1)],
            },
            { ...simplified(), total: "25.10", orderLabel: "Lucía", invoiceNumber: "F-COUNTER" },
          ),
        ),
        getReceiptPrintStatus: vi.fn().mockResolvedValue(printed),
        getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
      }),
    );
    if (tableHeld) await openPhoneTable(el);
    else {
      await flush(el);
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
    }
    emit(shell(el), "find-bill");
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-bill-open", {
      row: counter,
    });
    await flush(el);
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await type(el, "amount", "20.10");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    const reads = getPartyBills.mock.calls.length;
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    await flush(el);
    return { el, getPartyBills, reads };
  }

  it.each([
    ["while the last table's party is still held", true],
    ["with no table held", false],
  ])(
    "a counter order paid %s shows its own ticket, and New sale goes home",
    async (_, tableHeld) => {
      const { el } = await payCounterOrder({ tableHeld });

      expect(documentChoice(el)).not.toBeNull();
      expect(ticketView(el)).toBeNull();
      expect(documentChoice(el)!.result.invoiceNumber).toBe("F-COUNTER");

      emit(documentChoice(el)!, "settlement-close");
      await flush(el);

      expect(ticketView(el)).toBeNull();
      expect(documentChoice(el)).toBeNull();
      expect(floor(el).checkVisibility()).toBe(true);
    },
  );

  it("a counter order paid while a table's party is still held reads none of that party's bills", async () => {
    const { getPartyBills, reads } = await payCounterOrder({ tableHeld: true });

    expect(reads).toBeGreaterThan(0);
    expect(getPartyBills.mock.calls.length).toBe(reads);
  });

  describe("with other bills to pay", () => {
    const billOne = billOf();
    const billTwo = billOf({
      workingOrderId: "wo-5",
      billNumber: 2,
      total: "30.00",
      outstanding: "30.00",
    });
    const billThree = billOf({
      workingOrderId: "wo-9",
      billNumber: 3,
      total: "20.00",
      outstanding: "20.00",
    });
    const settled = (bill: PartyBill): PartyBill => ({
      ...bill,
      status: "settled",
      outstanding: "0.00",
    });
    const backButton = (el: TillApp) => inChoice(el, "[data-settlement-none]")!;
    const firstDrawn = async (el: TillApp) => {
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      await documentChoice(el)!.updateComplete;
    };

    /** Bill 1 of a party paid in three shares from the phone. Bills are read as `before` until the
     * last share is sent, and as `after` from then on: the stub's order is not number order. */
    function payBillOne(
      before: PartyBill[],
      after: () => Promise<PartyBill[]> = async () =>
        before.map((bill) => (bill.workingOrderId === "wo-4" ? settled(bill) : bill)),
      overrides: Record<string, unknown> = {},
    ) {
      const takeBillPayment = vi
        .fn()
        .mockResolvedValueOnce(shareOf("80.00"))
        .mockResolvedValueOnce(shareOf("40.00"))
        .mockResolvedValueOnce(shareOf("0.00", simplified()));
      return threeShares(simplified(), {
        takeBillPayment,
        getPartyBills: vi.fn(async () =>
          takeBillPayment.mock.calls.length >= 3 ? after() : before,
        ),
        getTablesState: vi
          .fn()
          .mockResolvedValue([mesa({ billCount: before.length, outstanding: "170.00" })]),
        ...overrides,
      });
    }
    const threeBills = [billThree, billOne, billTwo];
    const beer: TillProduct = {
      id: "beer",
      menuItemId: "offer-beer",
      name: "Beer",
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
      category: null,
      allergens: null,
    };

    it("Back shows the lowest-numbered bill still to pay, whose own lines are read", async () => {
      const { el } = await payBillOne(threeBills);
      await firstDrawn(el);

      backButton(el).click();
      await flush(el);

      expect(documentChoice(el)).toBeNull();
      expect(tableOrder(el).orderId).toBe("wo-5");
      expect(vi.mocked(api.getTabLines).mock.lastCall?.[0]).toBe("wo-5");
      expect(tableOrder(el).checkVisibility()).toBe(true);
    });

    it("Back reads the next bill's lines once", async () => {
      const { el } = await payBillOne(threeBills);
      await firstDrawn(el);

      backButton(el).click();
      await flush(el);

      expect(tableOrder(el).orderId).toBe("wo-5");
      expect(vi.mocked(api.getTabLines).mock.calls.filter(([id]) => id === "wo-5")).toHaveLength(1);
    });

    it("while the floor read is out at Back, the next bill's lines are already drawn under its name", async () => {
      const nextLines = [{ ...bill120[0]!, name: "Next bill's dish" }];
      const { el } = await payBillOne(threeBills, undefined, {
        getTabLines: vi.fn(async (id: string) => ({
          lines: id === "wo-5" ? nextLines : bill120,
          revision: 0,
        })),
      });
      await firstDrawn(el);
      await flush(el);
      let answerFloor!: (tables: unknown) => void;
      vi.mocked(api.getTablesState).mockImplementation(
        () => new Promise((resolve) => (answerFloor = resolve as (tables: unknown) => void)),
      );

      backButton(el).click();
      await flush(el);

      expect(tableOrder(el).orderId).toBe("wo-5");
      expect(tableOrder(el).lines).toEqual(nextLines);

      answerFloor([mesa({ billCount: 3, outstanding: "50.00" })]);
      await flush(el);

      expect(tableOrder(el).lines).toEqual(nextLines);
      expect(text(inOrder(tableOrder(el), "[data-party-outstanding]"))).toBe(money("50.00"));
      expect(vi.mocked(api.getTabLines).mock.calls.filter(([id]) => id === "wo-5")).toHaveLength(1);
    });

    it("Back shows the next bill's Still to pay at this table as the floor now answers it", async () => {
      const { el } = await payBillOne(threeBills);
      await firstDrawn(el);
      vi.mocked(api.getTablesState).mockResolvedValue([
        mesa({ billCount: 3, outstanding: "50.00" }),
      ]);

      backButton(el).click();
      await flush(el);

      expect(text(inOrder(tableOrder(el), "[data-party-outstanding]"))).toBe(money("50.00"));
    });

    it("a floor read failing at Back says the table could not be read again", async () => {
      const { el } = await payBillOne(threeBills);
      await firstDrawn(el);
      vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

      backButton(el).click();
      await flush(el);

      expect(tableOrder(el).orderId).toBe("wo-5");
      expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toBe(
        t("table.reread_failed"),
      );
    });

    describe("Finish table refused from the document choice", () => {
      const billOnePaidAndRest = threeBills.map((bill) =>
        bill === billOne ? settled(bill) : bill,
      );
      const allPaidThenRest = () =>
        vi
          .fn<() => Promise<PartyBill[]>>()
          .mockResolvedValueOnce(threeBills.map(settled))
          .mockResolvedValue(billOnePaidAndRest);
      const pressFinish = async (el: TillApp) => {
        await finishFromTable(el);
      };
      const stillToPay = (el: TillApp) => text(inOrder(tableOrder(el), "[data-party-outstanding]"));

      it("because a bill still owes, shows Still to pay as the floor now answers it", async () => {
        const after = allPaidThenRest();
        const { el } = await payBillOne(threeBills, after, {
          finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
        });
        await firstDrawn(el);
        vi.mocked(api.getTablesState).mockResolvedValue([
          mesa({ billCount: 3, outstanding: "50.00" }),
        ]);

        await pressFinish(el);

        expect(documentChoice(el)).toBeNull();
        expect(inOrder(tableOrder(el), "[data-finish-refusal]")).not.toBeNull();
        expect(stillToPay(el)).toBe(money("50.00"));
      });

      it("because a bill holds money, shows Still to pay as the floor now answers it and keeps the instruction", async () => {
        const after = allPaidThenRest();
        const { el } = await payBillOne(threeBills, after, {
          finishTable: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
        });
        await firstDrawn(el);
        vi.mocked(api.getTablesState).mockResolvedValue([
          mesa({ billCount: 3, outstanding: "50.00" }),
        ]);

        await pressFinish(el);

        expect(documentChoice(el)).toBeNull();
        expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toBe(
          t("table.finish_bill_holds_money"),
        );
        expect(stillToPay(el)).toBe(money("50.00"));
      });

      it("because a bill holds money, with the floor unreadable too, the instruction stays", async () => {
        const after = allPaidThenRest();
        const { el } = await payBillOne(threeBills, after, {
          finishTable: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
        });
        await firstDrawn(el);
        vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

        await pressFinish(el);

        expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toBe(
          t("table.finish_bill_holds_money"),
        );
      });
    });

    it("Back reads the balance of the next bill, so what it has already taken is shown", async () => {
      const partPaid = { ...billTwo, hasPayments: true, outstanding: "10.00" };
      const getBillBalance = vi.fn(async (id: string) =>
        balanceOf({ workingOrderId: id, total: "30.00", received: "20.00", outstanding: "10.00" }),
      );
      const { el } = await payBillOne([billThree, billOne, partPaid], undefined, {
        getBillBalance,
      });
      await firstDrawn(el);

      backButton(el).click();
      await vi.waitFor(() => expect(tableOrder(el).orderId).toBe("wo-5"));
      await flush(el);

      expect(getBillBalance.mock.lastCall?.[0]).toBe("wo-5");
      expect(text(inOrder(tableOrder(el), "[data-bill-received]"))).toContain(money("20.00"));
    });

    it("Back reads the next bill's balance once", async () => {
      const partPaid = { ...billTwo, hasPayments: true, outstanding: "10.00" };
      const getBillBalance = vi.fn(async (id: string) =>
        balanceOf({ workingOrderId: id, total: "30.00", received: "20.00", outstanding: "10.00" }),
      );
      const { el } = await payBillOne([billThree, billOne, partPaid], undefined, {
        getBillBalance,
      });
      await firstDrawn(el);

      backButton(el).click();
      await vi.waitFor(() => expect(tableOrder(el).orderId).toBe("wo-5"));
      await flush(el);

      expect(getBillBalance.mock.calls.filter(([id]) => id === "wo-5")).toHaveLength(1);
    });

    it("Back reads only once the move is done, so a slow draft save cannot lose the next bill's balance", async () => {
      const partPaid = { ...billTwo, hasPayments: true, outstanding: "10.00" };
      const bills = [billThree, billOne, partPaid];
      const getBillBalance = vi.fn(async (id: string) =>
        balanceOf({ workingOrderId: id, total: "30.00", received: "20.00", outstanding: "10.00" }),
      );
      const { el } = await payBillOne(bills, async () => bills, { getBillBalance });
      await firstDrawn(el);
      await flush(el);
      const saving = vi.mocked(api.saveDraft);
      const save = saving.getMockImplementation()!;
      let answer!: () => void;
      const held = new Promise<void>((resolve) => (answer = resolve));
      saving.mockImplementation(async (...args) => {
        await held;
        return save(...args);
      });
      tableOrder(el).draftStore!.appendLines([{ product: beer, quantity: "1" }]);

      backButton(el).click();
      await flush(el);
      expect(tableOrder(el).orderId).toBe("wo-4");
      answer();
      await vi.waitFor(() => expect(tableOrder(el).orderId).toBe("wo-5"));
      await flush(el);

      expect(getBillBalance.mock.lastCall?.[0]).toBe("wo-5");
      expect(text(inOrder(tableOrder(el), "[data-bill-received]"))).toContain(money("20.00"));
    });

    it("when the read after the payment says another till paid the rest, the title goes back to the table and Finish table returns", async () => {
      const { el } = await payBillOne(threeBills, async () => threeBills.map(settled));
      await firstDrawn(el);
      await vi.waitFor(() =>
        expect(tableOrder(el).bills.every((bill) => bill.status === "settled")).toBe(true),
      );
      await documentChoice(el)!.updateComplete;

      expect(tableOrder(el).bills).toEqual(threeBills.map(settled));
    });

    it("when the read after the payment fails, what the screen showed stays", async () => {
      const { el } = await payBillOne(threeBills, () =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      await firstDrawn(el);
      await flush(el);
      await documentChoice(el)!.updateComplete;

      expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual([
        "wo-9",
        "wo-4",
        "wo-5",
      ]);
      expect(el.shadowRoot!.querySelector('p.error[role="alert"]')).toBeNull();
    });

    const alert = (el: TillApp) => el.shadowRoot!.querySelector('p.error[role="alert"]');

    /** A read that answers only when the test says. */
    function heldRead<T = PartyBill[]>() {
      let answer!: (value: T) => void;
      let fail!: (error: unknown) => void;
      const answered = new Promise<T>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      });
      return { answered, answer, fail };
    }

    /** Bill 1 paid in three shares, with `afterSecond` answering the bills read after the second
     * and `afterLast` those from the last share on. */
    async function payBillOneAfter(
      afterSecond: () => Promise<PartyBill[]>,
      afterLast: () => Promise<PartyBill[]>,
      overrides: Record<string, unknown> = {},
      tillOver: Record<string, unknown> = {},
    ) {
      const takeBillPayment = vi
        .fn()
        .mockResolvedValueOnce(shareOf("80.00"))
        .mockResolvedValueOnce(shareOf("40.00"))
        .mockResolvedValueOnce(shareOf("0.00", simplified()));
      const getPartyBills = vi.fn(async () => {
        const taken = takeBillPayment.mock.calls.length;
        if (taken === 2) return afterSecond();
        return taken < 3 ? threeBills : afterLast();
      });
      const { el } = await threeShares(
        simplified(),
        {
          takeBillPayment,
          getPartyBills,
          getTablesState: vi
            .fn()
            .mockResolvedValue([mesa({ billCount: 3, outstanding: "170.00" })]),
          ...overrides,
        },
        tillOver,
      );
      await firstDrawn(el);
      return { el, getPartyBills };
    }

    const readFailed = () => Promise.reject(new TypeError("Failed to fetch"));
    const billOnePaid = threeBills.map((bill) => (bill === billOne ? settled(bill) : bill));

    it("when the bills read before the last payment failed, the read after it lists what is left and ends the alert", async () => {
      const read = heldRead();
      const { el, getPartyBills } = await payBillOneAfter(readFailed, () => read.answered);

      expect(getPartyBills.mock.settledResults.map((result) => result.type)).toContain("rejected");
      expect(text(alert(el))).toBe(t("table.reread_failed"));

      read.answer(billOnePaid);
      await flush(el);
      await documentChoice(el)!.updateComplete;

      expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual([
        "wo-9",
        "wo-4",
        "wo-5",
      ]);
      expect(alert(el)).toBeNull();
    });

    it("when the read after the last payment fails too, the alert stays", async () => {
      const read = heldRead();
      const { el } = await payBillOneAfter(readFailed, () => read.answered);

      read.fail(new TypeError("Failed to fetch"));
      await flush(el);

      expect(documentChoice(el)).not.toBeNull();
      expect(text(alert(el))).toBe(t("table.reread_failed"));
    });

    it("when the 15-second read overtakes the document choice's read and fails, the alert stays once the older read answers", async () => {
      const nativeTimeout = window.setTimeout.bind(window);
      const fifteenSeconds: (() => void)[] = [];
      const timeout = vi.spyOn(window, "setTimeout").mockImplementation(((
        handler: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (delay === 15_000 && typeof handler === "function")
          fifteenSeconds.push(handler as () => void);
        return nativeTimeout(handler, delay, ...args);
      }) as typeof window.setTimeout);
      try {
        const read = heldRead();
        const afterLast = vi
          .fn<() => Promise<PartyBill[]>>()
          .mockReturnValueOnce(read.answered)
          .mockImplementation(readFailed);
        const { el } = await payBillOneAfter(readFailed, afterLast);
        expect(afterLast).toHaveBeenCalledOnce();
        expect(text(alert(el))).toBe(t("table.reread_failed"));

        for (const fire of fifteenSeconds.splice(0)) fire();
        await flush(el);
        expect(afterLast).toHaveBeenCalledTimes(2);

        read.answer(billOnePaid);
        await flush(el);

        expect(documentChoice(el)).not.toBeNull();
        expect(text(alert(el))).toBe(t("table.reread_failed"));
      } finally {
        timeout.mockRestore();
      }
    });

    it("what a newer re-read says stays once the document choice's older read answers", async () => {
      const read = heldRead();
      const afterLast = vi
        .fn<() => Promise<PartyBill[]>>()
        .mockReturnValueOnce(read.answered)
        .mockImplementation(readFailed);
      const { el } = await payBillOneAfter(async () => threeBills, afterLast, {
        updateOrderLine: vi
          .fn()
          .mockResolvedValue({ revision: 1, party: { id: "v1", revision: 4 } }),
      });
      expect(alert(el)).toBeNull();
      vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

      emit(tableOrder(el), "change-line", { lineNo: 1, lineName: "x", patch: {}, revision: 0 });
      await flush(el);
      expect(afterLast).toHaveBeenCalledTimes(2);
      expect(text(alert(el))).toBe(t("table.reread_failed"));

      read.answer(billOnePaid);
      await flush(el);

      expect(documentChoice(el)).not.toBeNull();
      expect(text(alert(el))).toBe(t("table.reread_failed"));
    });

    /** Bill 1 paid in three shares with its bills read still out, an earlier failure's alert showing
     * and a Change, sent before the last share, answered: its re-read is out on the floor. */
    async function newerRereadOnTheFloor() {
      const read = heldRead();
      const floor = heldRead<unknown>();
      const change = heldRead<unknown>();
      const afterSecond = vi.fn(() => {
        emit(tableOrder(document.querySelector<TillApp>("till-app")!), "change-line", {
          lineNo: 1,
          lineName: "x",
          patch: {},
          revision: 0,
        });
        return readFailed();
      });
      const afterLast = vi
        .fn<() => Promise<PartyBill[]>>()
        .mockReturnValueOnce(read.answered)
        .mockResolvedValue(billOnePaid);
      const { el } = await payBillOneAfter(afterSecond, afterLast, {
        updateOrderLine: vi.fn(() => change.answered),
      });
      expect(text(alert(el))).toBe(t("table.reread_failed"));
      vi.mocked(api.getTablesState).mockImplementation(() => floor.answered as Promise<never>);

      change.answer({ revision: 1, party: { id: "v1", revision: 4 } });
      await flush(el);
      expect(vi.mocked(api.getTablesState)).toHaveBeenCalled();
      expect(afterLast).toHaveBeenCalledOnce();
      return { el, read, floor };
    }

    it("the document choice's read answering while a newer re-read waits on the floor, with that re-read then fine, ends the alert", async () => {
      const { el, read, floor } = await newerRereadOnTheFloor();

      read.answer(billOnePaid);
      await flush(el);
      floor.answer([mesa({ billCount: 3, outstanding: "50.00" })]);
      await flush(el);

      expect(documentChoice(el)).not.toBeNull();
      expect(alert(el)).toBeNull();
    });

    it("the document choice's read answering while a newer re-read waits on the floor, with that floor read then failing, says so", async () => {
      const { el, read, floor } = await newerRereadOnTheFloor();

      read.answer(billOnePaid);
      await flush(el);
      floor.fail(new TypeError("Failed to fetch"));
      await flush(el);

      expect(documentChoice(el)).not.toBeNull();
      expect(text(alert(el))).toBe(t("table.reread_failed"));
    });

    it("a refused Open drawer stays when the document choice's read succeeds", async () => {
      const read = heldRead();
      const { el } = await payBillOneAfter(
        readFailed,
        () => read.answered,
        { openDrawer: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) },
        { capabilities: [...phoneCapabilities, "open-cash-drawer"] },
      );

      await userEvent.click(inChoice(el, '[data-test="open-drawer"]')!);
      await flush(el);
      expect(text(alert(el))).toBe(t("drawer.error"));

      read.answer(billOnePaid);
      await flush(el);

      expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual([
        "wo-9",
        "wo-4",
        "wo-5",
      ]);
      expect(text(alert(el))).toBe(t("drawer.error"));
    });

    it("when the document choice's read answers after Back, what the read at Back said stays", async () => {
      const read = heldRead();
      const afterLast = vi
        .fn<() => Promise<PartyBill[]>>()
        .mockReturnValueOnce(read.answered)
        .mockResolvedValue(billOnePaid);
      const { el } = await payBillOneAfter(readFailed, afterLast);
      vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

      backButton(el).click();
      await flush(el);
      expect(documentChoice(el)).toBeNull();
      expect(text(alert(el))).toBe(t("table.reread_failed"));

      read.answer(billOnePaid);
      await flush(el);

      expect(text(alert(el))).toBe(t("table.reread_failed"));
    });

    it("a re-read still out from before the last payment says nothing over the document choice", async () => {
      const earlier = heldRead();
      const { el } = await payBillOneAfter(
        () => earlier.answered,
        async () => billOnePaid,
      );
      await flush(el);
      expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual([
        "wo-9",
        "wo-4",
        "wo-5",
      ]);

      earlier.fail(new TypeError("Failed to fetch"));
      await flush(el);

      expect(documentChoice(el)).not.toBeNull();
      expect(alert(el)).toBeNull();
    });

    it("a re-read whose floor read is still out from before the last payment reads no more bills", async () => {
      const floorRead = heldRead<unknown>();
      const tables = [mesa({ billCount: 3, outstanding: "170.00" })];
      const { el, getPartyBills } = await payBillOneAfter(
        async () => threeBills,
        async () => billOnePaid,
        {
          getTablesState: vi.fn(() =>
            vi.mocked(api.takeBillPayment).mock.calls.length === 2
              ? floorRead.answered
              : Promise.resolve(tables),
          ),
        },
      );
      await flush(el);
      const reads = getPartyBills.mock.calls.length;

      floorRead.answer(tables);
      await flush(el);

      expect(getPartyBills.mock.calls.length).toBe(reads);
      expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual([
        "wo-9",
        "wo-4",
        "wo-5",
      ]);
    });

    it("a table of one bill is as it was: its name, no list, Finish table first, Back staying on the bill", async () => {
      const { el } = await payBillOne([billOne]);
      await firstDrawn(el);

      expect(inChoice(el, '[data-test="finish-table"]')).toBeNull();

      vi.mocked(api.getTablesState).mockResolvedValue([
        mesa({ billCount: 1, outstanding: "0.00" }),
      ]);
      backButton(el).click();
      await flush(el);

      expect(tableOrder(el).orderId).toBe("wo-4");
      expect(text(inOrder(tableOrder(el), "[data-party-outstanding]"))).toBe(money("0.00"));
    });

    it("with a draft save refused at Back, the screen stays on the paid bill and says why", async () => {
      const { el } = await payBillOne(threeBills, () => new Promise<PartyBill[]>(() => {}));
      await firstDrawn(el);
      vi.mocked(api.saveDraft).mockRejectedValue(new TypeError("Failed to fetch"));
      tableOrder(el).draftStore!.appendLines([{ product: beer, quantity: "1" }]);

      backButton(el).click();
      await flush(el);

      expect(api.saveDraft).toHaveBeenCalled();
      expect(documentChoice(el)).toBeNull();
      expect(tableOrder(el).orderId).toBe("wo-4");
      expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toContain(
        t("table.draft_save_failed"),
      );
    });
  });
});

describe("till-app: a phone's first payment picks up the one free reader (default 18)", () => {
  /** No reader chosen, and `offered` the profile's only reader. */
  const firstUse = (offered: EquipmentItem = SECOND_READER): DeviceEquipment => ({
    roles: [
      roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
      roleOf("card_terminal", null, [offered]),
    ],
  });
  const holding = (reader: EquipmentItem): DeviceEquipment => ({
    roles: [
      roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
      roleOf("card_terminal", reader, [reader]),
    ],
  });
  const pickOf = (id: string): EquipmentChange => ({
    role: "card_terminal",
    selection: { id },
    via: "list",
    takeOver: false,
  });

  /** Each pick waits until its own `answer` (or `refuse`) is called. */
  function heldPicks() {
    const answers: Array<{ ok: () => void; fail: (error: unknown) => void }> = [];
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise<DeviceEquipment>((resolve, reject) => {
          const id = typeof change.selection === "object" ? change.selection.id : "";
          const reader = [SECOND_READER, THIRD_READER].find((each) => each.id === id)!;
          answers.push({ ok: () => resolve(holding(reader)), fail: reject });
        }),
    );
    return { setDeviceEquipment, answers };
  }

  /** The open sheet: the bill's dialog, else the presented bill's. */
  const sheet = (el: TillApp) => dialog(el) ?? presented(el);
  const row = (el: TillApp) =>
    sheet(el)!.shadowRoot!.querySelector<TillPayEquipment>("till-pay-equipment")!;
  async function readerField(el: TillApp): Promise<WtCombobox> {
    await sheet(el)!.updateComplete;
    await row(el).updateComplete;
    return row(el).shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="cardReaderId"]')!;
  }
  async function summary(el: TillApp): Promise<string> {
    await sheet(el)!.updateComplete;
    await row(el).updateComplete;
    return text(row(el).shadowRoot!.querySelector("[data-pay-equipment-summary]"));
  }
  async function closeSheet(el: TillApp): Promise<void> {
    if (dialog(el) !== null) emit(dialog(el)!, "bill-pay-close");
    else emit(presented(el)!, "presented-pay-close");
    await flush(el);
  }

  async function firstUsePhone(
    overrides: Record<string, unknown> = {},
    theme?: "light" | "dark",
    tillOver: Record<string, unknown> = {},
  ) {
    api = stubApi(
      onPhone(
        { getDeviceEquipment: vi.fn().mockResolvedValue(firstUse()), ...overrides },
        tillOver,
      ),
    );
    const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
    const order = await openPhoneTable(el);
    return { el, order };
  }

  const placed = { getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]) };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["bill", {}],
    ["presented", placed],
  ] as const)(
    "on the %s path, picks up the one free reader as the sheet opens and keeps the row closed naming it",
    async (_path, over) => {
      const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
      const { el, order } = await firstUsePhone({ ...over, setDeviceEquipment });
      expect(setDeviceEquipment).not.toHaveBeenCalled();

      await pressPaySheet(el, order);
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
      await flush(el);

      expect(setDeviceEquipment.mock.calls[0]![0]).toEqual(pickOf(SECOND_READER.id));
      expect(row(el).open).toBe(false);
      expect(await summary(el)).toContain("Lector 2");
    },
  );

  it.each([
    ["bill", {}],
    ["presented", placed],
  ] as const)(
    "on the %s path, a refused automatic pick opens the row with the reader empty and the refusal under it",
    async (_path, over) => {
      const { setDeviceEquipment, answers } = heldPicks();
      const { el, order } = await firstUsePhone({ ...over, setDeviceEquipment });
      await pressPaySheet(el, order);
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
      await flush(el);
      expect(row(el).open).toBe(false);

      answers[0]!.fail({ code: "device.equipment_held", status: 409 });
      await flush(el);

      expect(row(el).open).toBe(true);
      const reader = await readerField(el);
      expect(reader.value).toBe("");
      expect(reader.error).toBe(codeMessage("device.equipment_held"));
      expect(setDeviceEquipment).toHaveBeenCalledOnce();
    },
  );

  it("an automatic pick with no answer opens the row and says it was not saved", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const { el, order } = await firstUsePhone({ setDeviceEquipment });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());

    answers[0]!.fail(new TypeError("Failed to fetch"));
    await flush(el);

    expect(row(el).open).toBe(true);
    const reader = await readerField(el);
    expect(reader.value).toBe("");
    expect(reader.error).toBe(t("pay_equipment.not_saved"));
  });

  it("closing and reopening the sheet while the pick is out sends no second pick", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const { el, order } = await firstUsePhone({ setDeviceEquipment });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());

    await closeSheet(el);
    await pressPaySheet(el, tableOrder(el));
    await flush(el);
    vi.mocked(api.getDeviceEquipment).mockResolvedValue(holding(SECOND_READER));
    answers[0]!.ok();
    await flush(el);
    await closeSheet(el);
    await pressPaySheet(el, tableOrder(el));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(await summary(el)).toContain("Lector 2");
  });

  it("the 15-second equipment poll answering meanwhile sends no second pick", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { setDeviceEquipment, answers } = heldPicks();
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse());
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    const reads = getDeviceEquipment.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);
    await flush(el);
    expect(getDeviceEquipment.mock.calls.length).toBeGreaterThan(reads);
    answers[0]!.fail({ code: "reader.payment_in_progress", status: 409 });
    await flush(el);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(row(el).open).toBe(true);
  });

  it("a tap arriving before the opening read answers takes the reader, and nothing is picked by itself", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse(THIRD_READER));
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    const opening: Array<(equipment: DeviceEquipment) => void> = [];
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => opening.push(resolve)),
    );
    await pressPaySheet(el, order);
    expect(opening).toHaveLength(1);

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    opening[0]!(firstUse(THIRD_READER));
    await flush(el);
    answers[0]!.ok();
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(setDeviceEquipment.mock.calls[0]![0]).toMatchObject({ via: "scan" });
  });

  it("a tap refused before the opening read answers leaves the reader to the waiter", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse(THIRD_READER));
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    const opening: Array<(equipment: DeviceEquipment) => void> = [];
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => opening.push(resolve)),
    );
    await pressPaySheet(el, order);

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    answers[0]!.fail({ code: "device.equipment_held", status: 409 });
    await flush(el);
    for (const answer of opening) answer(firstUse(THIRD_READER));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
    expect(row(el).open).toBe(true);
  });

  it("a phone that held Lector 2 earlier in the page and lost it picks nothing by itself", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(THIRD_READER));
    const getDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    getDeviceEquipment.mockResolvedValue(firstUse(THIRD_READER));

    await pressPaySheet(el, order);
    await flush(el);

    expect(setDeviceEquipment).not.toHaveBeenCalled();
    expect(row(el).open).toBe(true);
    expect((await readerField(el)).value).toBe("");
  });

  it("a reader the waiter picked earlier in the page counts as having had one", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(THIRD_READER));
    const getDeviceEquipment = vi.fn().mockResolvedValue({
      roles: [
        roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
        roleOf("card_terminal", null, [SECOND_READER, THIRD_READER]),
      ],
    });
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    await pressPaySheet(el, order);
    expect(row(el).open).toBe(true);
    const combobox = await readerField(el);
    await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combobox.updateComplete;
    const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
      (each) => each.textContent!.trim().startsWith("Lector 3"),
    )!;
    await userEvent.click(option);
    await flush(el);
    expect(setDeviceEquipment).toHaveBeenCalledOnce();

    getDeviceEquipment.mockResolvedValue(firstUse(SECOND_READER));
    await closeSheet(el);
    await pressPaySheet(el, tableOrder(el));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledOnce();
  });

  it("a practice phone picks up no real reader", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    api = stubApi(
      onPhone(
        { getDeviceEquipment: vi.fn().mockResolvedValue(firstUse()), setDeviceEquipment },
        {
          cardProvider: "simulator",
          activeReaders: [],
        },
      ),
    );
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await pressPaySheet(el, await openPhoneTable(el));
    await flush(el);

    expect(dialog(el)!.fixedReader).not.toBeNull();
    expect(setDeviceEquipment).not.toHaveBeenCalled();
  });

  it("a reader another phone holds is never picked up by itself", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    const held = {
      ...SECOND_READER,
      heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: null },
    };
    const { el, order } = await firstUsePhone({
      setDeviceEquipment,
      getDeviceEquipment: vi.fn().mockResolvedValue(firstUse(held)),
    });

    await pressPaySheet(el, order);
    await flush(el);

    expect(setDeviceEquipment).not.toHaveBeenCalled();
    expect(row(el).open).toBe(true);
  });

  it("an opening read that never answers is cut off, and the row opens with nothing picked", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse());
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    getDeviceEquipment.mockImplementation(
      (options?: { signal?: AbortSignal }) =>
        new Promise<DeviceEquipment>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      inOrder(order, "[data-pay-sheet]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      await sheet(el)!.updateComplete;
      expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
      expect(row(el).open).toBe(false);

      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
      await el.updateComplete;
      await sheet(el)!.updateComplete;
      await row(el).updateComplete;
      expect(row(el).open).toBe(true);
      expect(setDeviceEquipment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an automatic pick refused while a reopened sheet's opening read is out keeps the row closed until that read answers", async () => {
    const { setDeviceEquipment, answers } = heldPicks();
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse());
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    const reads: Array<(equipment: DeviceEquipment) => void> = [];
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => reads.push(resolve)),
    );
    await closeSheet(el);
    await pressPaySheet(el, tableOrder(el));
    expect(reads).toHaveLength(1);

    answers[0]!.fail({ code: "device.equipment_held", status: 409 });
    await flush(el);
    await row(el).updateComplete;
    expect(row(el).open).toBe(false);

    const held = {
      ...SECOND_READER,
      heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: null },
    };
    for (const read of reads) read(firstUse(held));
    await flush(el);
    await row(el).updateComplete;
    expect(row(el).open).toBe(true);
    expect(setDeviceEquipment).toHaveBeenCalledOnce();
  });

  it("an earlier opening's read failing after the sheet reopened leaves the row to the newer opening", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    const getDeviceEquipment = vi.fn().mockResolvedValue(firstUse());
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    const reads: Array<{ ok: (equipment: DeviceEquipment) => void; fail: (e: unknown) => void }> =
      [];
    getDeviceEquipment.mockImplementation(
      () =>
        new Promise<DeviceEquipment>((resolve, reject) =>
          reads.push({ ok: resolve, fail: reject }),
        ),
    );
    await pressPaySheet(el, order);
    await closeSheet(el);
    await pressPaySheet(el, tableOrder(el));
    expect(reads).toHaveLength(2);

    reads[0]!.fail(new TypeError("Failed to fetch"));
    await flush(el);
    await row(el).updateComplete;
    expect(row(el).open).toBe(false);
    expect(setDeviceEquipment).not.toHaveBeenCalled();

    reads[1]!.ok(firstUse());
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);
    expect(row(el).open).toBe(false);
    expect(await summary(el)).toContain("Lector 2");
  });

  it("when the equipment held offers no reader but the opening read finds one, the pick is sent and the row stays open", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    const getDeviceEquipment = vi.fn().mockResolvedValue({
      roles: [roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]), roleOf("card_terminal", null, [])],
    });
    const { el, order } = await firstUsePhone({ setDeviceEquipment, getDeviceEquipment });
    getDeviceEquipment.mockResolvedValue(firstUse());

    await pressPaySheet(el, order);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);

    expect(setDeviceEquipment.mock.calls[0]![0]).toEqual(pickOf(SECOND_READER.id));
    expect(row(el).open).toBe(true);
    expect((await readerField(el)).value).toBe(SECOND_READER.id);
  });

  const lookBackgrounds = new Map<string, string>();
  it.each([
    ["picked", "light", 390],
    ["picked", "dark", 390],
    ["refused", "light", 390],
    ["refused", "dark", 390],
    ["picked", "light", 1280],
    ["picked", "dark", 1280],
  ] as const)("looks right %s, %s at %i px", async (state, theme, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const setDeviceEquipment =
        state === "picked"
          ? vi.fn().mockResolvedValue(holding(SECOND_READER))
          : vi.fn().mockRejectedValue({ code: "device.equipment_held", status: 409 });
      // A person with no language of their own signs in to the venue's (`resolveActiveLocale`).
      const { el, order } = await firstUsePhone({ setDeviceEquipment }, theme, {
        locale: "es-ES",
      });
      await pressPaySheet(el, order);
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
      await flush(el);
      await row(el).updateComplete;
      expect(row(el).open).toBe(state === "refused");
      expect(currentLocale()).toBe("es-ES");
      const panel = dialog(el)!
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      lookBackgrounds.set(`${state}-${theme}-${width}`, background);
      if (theme === "dark")
        expect(background).not.toBe(lookBackgrounds.get(`${state}-light-${width}`));
      const shot = `__screenshots__/look/a796-first-use-${state}-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-first-use-${state}-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const rowBox = row(el).getBoundingClientRect();
      await commands.writeFile(
        `src/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          rowInside: rowBox.left >= box.left && rowBox.right <= box.right,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});

describe("till-app: why the sheet's reader has gone (default 19)", () => {
  const withReader = (reader: RoleEquipment): DeviceEquipment => ({
    roles: [roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]), reader],
  });
  const holding = (reader: EquipmentItem) =>
    withReader(roleOf("card_terminal", reader, [reader, THIRD_READER]));
  const takenByMarc = withReader(
    roleOf("card_terminal", null, [{ ...SECOND_READER, heldBy: MARC }, THIRD_READER]),
  );
  const OFF = { ...SECOND_READER, available: false };
  const switchedOff = withReader(roleOf("card_terminal", OFF, [OFF, THIRD_READER]));
  const unpaired = withReader({
    ...roleOf("card_terminal", OFF, [OFF, THIRD_READER]),
    resolved: null,
  });
  const dropped = withReader(roleOf("card_terminal", null, [THIRD_READER]));

  const sheet = (el: TillApp) => dialog(el) ?? presented(el);
  const row = (el: TillApp) =>
    sheet(el)!.shadowRoot!.querySelector<TillPayEquipment>("till-pay-equipment")!;
  async function reason(el: TillApp): Promise<{ line: string; hint: string | null } | null> {
    await sheet(el)!.updateComplete;
    await row(el).updateComplete;
    const box = row(el).shadowRoot!.querySelector("[data-pay-reader-reason]");
    if (box === null) return null;
    const hint = box.querySelector("[data-pay-reader-hint]");
    return {
      line: text(box.querySelector("[data-pay-reader-line]")),
      hint: hint === null ? null : text(hint),
    };
  }
  async function closeSheet(el: TillApp): Promise<void> {
    if (dialog(el) !== null) emit(dialog(el)!, "bill-pay-close");
    else emit(presented(el)!, "presented-pay-close");
    await flush(el);
  }
  const placed = { getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]) };

  /** A phone that held Lector 2 when the table opened; the sheet's opening read answers `then`. */
  async function lostPhone(
    then: DeviceEquipment,
    overrides: Record<string, unknown> = {},
    theme?: "light" | "dark",
    tillOver: Record<string, unknown> = {},
  ) {
    const getDeviceEquipment = vi.fn().mockResolvedValue(holding(SECOND_READER));
    api = stubApi(onPhone({ getDeviceEquipment, ...overrides }, tillOver));
    const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
    const order = await openPhoneTable(el);
    getDeviceEquipment.mockResolvedValue(then);
    await pressPaySheet(el, order);
    await flush(el);
    return { el, order, getDeviceEquipment };
  }

  const takenLine = () =>
    t("equipment.taken_person")
      .replace("{item}", "Lector 2")
      .replace("{device}", "Móvil 2")
      .replace("{person}", "Marc");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["bill", {}],
    ["presented", placed],
  ] as const)(
    "on the %s path, a reader another phone took opens the row saying who took it, and to choose the one in hand",
    async (_path, over) => {
      const { el } = await lostPhone(takenByMarc, over);

      expect(row(el).open).toBe(true);
      expect(await reason(el)).toEqual({
        line: takenLine(),
        hint: t("pay_equipment.choose_in_hand"),
      });
    },
  );

  it.each([
    ["switched off", switchedOff],
    ["unpaired", unpaired],
  ] as const)("a %s reader says it is switched off", async (_how, then) => {
    const { el } = await lostPhone(then);

    expect(row(el).open).toBe(true);
    expect(await reason(el)).toEqual({
      line: t("equipment.switched_off").replace("{item}", "Lector 2"),
      hint: null,
    });
  });

  it("a switched-off reader says so on a freshly mounted page too", async () => {
    const { el } = await lostPhone(switchedOff, {
      getDeviceEquipment: vi.fn().mockResolvedValue(switchedOff),
    });

    expect(await reason(el)).toEqual({
      line: t("equipment.switched_off").replace("{item}", "Lector 2"),
      hint: null,
    });
  });

  it.each([
    ["bill", {}],
    ["presented", placed],
  ] as const)(
    "on the %s path, a reader taken off the list says it is no longer available",
    async (_path, over) => {
      const { el } = await lostPhone(dropped, over);

      expect(row(el).open).toBe(true);
      expect(await reason(el)).toEqual({
        line: t("pay_equipment.reader_gone").replace("{item}", "Lector 2"),
        hint: null,
      });
    },
  );

  it("a reader the server has forgotten, on a freshly mounted page, gets no line", async () => {
    const { el } = await lostPhone(takenByMarc, {
      getDeviceEquipment: vi.fn().mockResolvedValue(takenByMarc),
    });

    expect(row(el).open).toBe(true);
    expect(await reason(el)).toBeNull();
  });

  it("a practice phone gets no missing-reader line", async () => {
    const { el } = await lostPhone(takenByMarc, {}, undefined, {
      cardProvider: "simulator",
      activeReaders: [],
    });

    expect(await reason(el)).toBeNull();
  });

  it("the line goes once the phone has a ready reader again, and stays gone when it loses that one without being told why", async () => {
    const { el, order, getDeviceEquipment } = await lostPhone(takenByMarc);
    expect(await reason(el)).not.toBeNull();

    await closeSheet(el);
    getDeviceEquipment.mockResolvedValue(holding(THIRD_READER));
    await pressPaySheet(el, order);
    await flush(el);
    expect(await reason(el)).toBeNull();

    await closeSheet(el);
    getDeviceEquipment.mockResolvedValue(withReader(roleOf("card_terminal", null, [THIRD_READER])));
    await pressPaySheet(el, order);
    await flush(el);
    expect(row(el).open).toBe(true);
    expect(await reason(el)).toBeNull();
  });

  it("the line stays when the sheet opens again on a read that says the same", async () => {
    const { el, order } = await lostPhone(takenByMarc);
    await closeSheet(el);
    await pressPaySheet(el, order);
    await flush(el);

    expect(await reason(el)).toEqual({
      line: takenLine(),
      hint: t("pay_equipment.choose_in_hand"),
    });
  });

  it("picking Lector 2 again from the list after the takeover asks today's question", async () => {
    const { el } = await lostPhone(takenByMarc);
    const combobox = row(el).shadowRoot!.querySelector<WtCombobox>(
      'wt-combobox[name="cardReaderId"]',
    )!;
    await userEvent.click(combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    await combobox.updateComplete;
    const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
      (each) => each.textContent!.trim().startsWith("Lector 2"),
    )!;
    await userEvent.click(option);
    await flush(el);
    await row(el).updateComplete;

    expect(text(row(el).shadowRoot!.querySelector("[data-pay-take-question]"))).toBe(
      t("equipment.take_question_person")
        .replace("{item}", "Lector 2")
        .replace("{device}", "Móvil 2")
        .replace("{person}", "Marc"),
    );
  });

  const lookBackgrounds = new Map<string, string>();
  it.each([
    ["light", 390],
    ["dark", 390],
    ["light", 1280],
    ["dark", 1280],
  ] as const)("looks right taken, %s at %i px", async (theme, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      // A person with no language of their own signs in to the venue's (`resolveActiveLocale`).
      const { el } = await lostPhone(takenByMarc, {}, theme, { locale: "es-ES" });
      await row(el).updateComplete;
      expect(currentLocale()).toBe("es-ES");
      expect(row(el).open).toBe(true);
      expect(await reason(el)).toEqual({
        line: takenLine(),
        hint: t("pay_equipment.choose_in_hand"),
      });
      const panel = dialog(el)!
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      lookBackgrounds.set(`${theme}-${width}`, background);
      if (theme === "dark") expect(background).not.toBe(lookBackgrounds.get(`light-${width}`));
      const shot = `__screenshots__/look/a796-reader-taken-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-reader-taken-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const reasonBox = row(el)
        .shadowRoot!.querySelector("[data-pay-reader-reason]")!
        .getBoundingClientRect();
      await commands.writeFile(
        `src/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          reasonInside: reasonBox.left >= box.left && reasonBox.right <= box.right,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});

describe("till-app: a reader refused at Take payment, and a printer that has gone (default 19)", () => {
  const TERRACE_PRINTER = equipmentItem("p2", "Terraza");
  const UNAVAILABLE_BAR_PRINTER = { ...BAR_PRINTER, available: false };

  const holding = (
    receipt: RoleEquipment = roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
  ): DeviceEquipment => ({
    roles: [receipt, roleOf("card_terminal", SECOND_READER, [SECOND_READER, THIRD_READER])],
  });
  const takenByMarc: DeviceEquipment = {
    roles: [
      roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
      roleOf("card_terminal", null, [{ ...SECOND_READER, heldBy: MARC }, THIRD_READER]),
    ],
  };
  const notHeld = () => ({ code: "reader.not_held", status: 409 });

  const sheet = (el: TillApp) => dialog(el) ?? presented(el);
  const row = (el: TillApp) =>
    sheet(el)!.shadowRoot!.querySelector<TillPayEquipment>("till-pay-equipment")!;
  async function settled(el: TillApp): Promise<TillPayEquipment> {
    await flush(el);
    await sheet(el)!.updateComplete;
    await row(el).updateComplete;
    return row(el);
  }
  const field = (el: TillApp, name: string) =>
    row(el).shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name="${name}"]`)!;
  const printerWarning = (el: TillApp) =>
    row(el).shadowRoot!.querySelector("[data-pay-printer-warning]")?.textContent!.trim();
  const bottom = (el: TillApp) =>
    sheet(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;
  const shownText = (root: ParentNode): string =>
    [...root.querySelectorAll("*")]
      .map((node) => (node.shadowRoot === null ? "" : shownText(node.shadowRoot)))
      .join(" ") + ` ${root.textContent ?? ""}`;

  /** How many times each of the stub API's requests has been called. */
  const apiCalls = (): Record<string, number> =>
    Object.fromEntries(
      Object.entries(api).map(([name, request]) => {
        expect(vi.isMockFunction(request), name).toBe(true);
        return [name, vi.mocked(request as () => unknown).mock.calls.length];
      }),
    );
  const apiCallsSince = (before: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(apiCalls())
        .map(([name, count]) => [name, count - (before[name] ?? 0)] as const)
        .filter(([, count]) => count > 0),
    );

  async function billOnConfirmation(overrides: Record<string, unknown> = {}) {
    const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
    const { el } = await mountApp(onPhone({ getDeviceEquipment, ...overrides }));
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    return { el, order, getDeviceEquipment };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("a card refused reader.not_held on its first send", () => {
    it("on the bill path, says so under the reader field, reads the equipment once, and opens the row with the reader empty", async () => {
      const { el, getDeviceEquipment } = await billOnConfirmation({
        takeBillPayment: vi.fn().mockRejectedValue(notHeld()),
      });
      getDeviceEquipment.mockResolvedValue(takenByMarc);
      const readsBefore = getDeviceEquipment.mock.calls.length;
      const before = apiCalls();

      await press(el, "[data-pay-confirm]");
      const shown = await settled(el);

      expect(sent()).toHaveLength(1);
      expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
      // The bill's own re-reads after a refusal, the refused send, and the one equipment read.
      expect(apiCallsSince(before)).toEqual({
        getTablesState: 1,
        getPartyBills: 1,
        getTabLines: 1,
        listGroups: 1,
        getBillBalance: 1,
        takeBillPayment: 1,
        getDeviceEquipment: 1,
      });
      expect(getDeviceEquipment.mock.calls.at(-1)).toEqual([{ signal: expect.any(AbortSignal) }]);
      expect(shown.open).toBe(true);
      expect(field(el, "cardReaderId").value).toBe("");
      expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
      expect(bottom(el)).toBe("");
      expect(shownText(dialog(el)!.shadowRoot!)).not.toContain(codeMessage("reader.not_held"));
    });

    it("on the presented path through api.pay, says so under the reader field, reads the equipment once, and opens the row with the reader empty", async () => {
      const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
      const pay = vi.fn().mockRejectedValue(notHeld());
      const { el } = await mountApp(
        onPhone({
          getDeviceEquipment,
          pay,
          getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
        }),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await presented(el)!.updateComplete;
      getDeviceEquipment.mockResolvedValue(takenByMarc);
      const readsBefore = getDeviceEquipment.mock.calls.length;

      presented(el)!.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!.click();
      const shown = await settled(el);

      expect(pay).toHaveBeenCalledOnce();
      expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
      expect(getDeviceEquipment.mock.calls.at(-1)).toEqual([{ signal: expect.any(AbortSignal) }]);
      expect(shown.open).toBe(true);
      expect(field(el, "cardReaderId").value).toBe("");
      expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
      expect(bottom(el)).toBe("");
      expect(shownText(presented(el)!.shadowRoot!)).not.toContain(codeMessage("reader.not_held"));
    });

    const rereads = [
      ["fails with no answer", () => Promise.reject(new TypeError("Failed to fetch"))],
      ["still shows the phone holding the reader", () => Promise.resolve(holding())],
    ] as const;

    it.each(rereads)(
      "on the bill path, the row opens with the refusal under the reader field when the re-read %s",
      async (_name, reread) => {
        const { el, getDeviceEquipment } = await billOnConfirmation({
          takeBillPayment: vi.fn().mockRejectedValue(notHeld()),
        });
        expect(row(el).open).toBe(false);
        getDeviceEquipment.mockImplementation(reread);

        await press(el, "[data-pay-confirm]");
        const shown = await settled(el);

        expect(shown.open).toBe(true);
        expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
      },
    );

    it.each(rereads)(
      "on the presented path, the row opens with the refusal under the reader field when the re-read %s",
      async (_name, reread) => {
        const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
        const { el } = await mountApp(
          onPhone({
            getDeviceEquipment,
            pay: vi.fn().mockRejectedValue(notHeld()),
            getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
          }),
        );
        const order = await openPhoneTable(el);
        await pressPaySheet(el, order);
        await settled(el);
        expect(row(el).open).toBe(false);
        getDeviceEquipment.mockImplementation(reread);

        presented(el)!.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!.click();
        const shown = await settled(el);

        expect(shown.open).toBe(true);
        expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
      },
    );

    it("a re-read that never answers is cut off at the request limit", async () => {
      const { el, getDeviceEquipment } = await billOnConfirmation({
        takeBillPayment: vi.fn().mockRejectedValue(notHeld()),
      });
      const signals: AbortSignal[] = [];
      getDeviceEquipment.mockImplementation(
        (options?: { signal?: AbortSignal }) =>
          new Promise<DeviceEquipment>((_resolve, reject) => {
            if (options?.signal !== undefined) signals.push(options.signal);
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS);
      expect(signals[0]!.aborted).toBe(true);
    });

    it("a counter till keeps reader.not_held's general message above the action", async () => {
      const readers = [
        { id: "r1", name: "Lector 1", provider: "stripe_terminal" },
        { id: "r2", name: "Lector 2", provider: "stripe_terminal" },
      ];
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
          activeReaders: readers,
          defaultReaderId: "r1",
        }),
        previewBillPayment: vi
          .fn()
          .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" }),
        takeBillPayment: vi.fn().mockRejectedValue(notHeld()),
      });
      await openTable(el);
      await openDialog(el, "contribution");
      await type(el, "amount", "40");
      await press(el, 'input[name="method"][value="card"]');
      await press(el, 'input[name="reader"][value="r2"]');
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");

      expect(dialog(el)!.handheld).toBe(false);
      expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("reader.not_held"));
      expect(shownText(dialog(el)!.shadowRoot!)).not.toContain(t("bill_pay.reader_not_held"));
    });
  });

  const lookBackgrounds = new Map<string, string>();
  it.each([
    ["reader-refused", "light", 390],
    ["reader-refused", "dark", 390],
    ["reader-refused", "light", 1280],
    ["reader-refused", "dark", 1280],
    ["printer-off", "light", 390],
    ["printer-off", "dark", 390],
    ["printer-off", "light", 1280],
    ["printer-off", "dark", 1280],
  ] as const)("looks right, %s, %s at %i px", async (state, theme, width) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const refused = state === "reader-refused";
      const getDeviceEquipment = vi
        .fn()
        .mockResolvedValue(
          refused
            ? holding()
            : holding(
                roleOf("receipt", UNAVAILABLE_BAR_PRINTER, [
                  UNAVAILABLE_BAR_PRINTER,
                  TERRACE_PRINTER,
                ]),
              ),
        );
      api = stubApi(
        onPhone(
          { getDeviceEquipment, takeBillPayment: vi.fn().mockRejectedValue(notHeld()) },
          // A person with no language of their own signs in to the venue's (`resolveActiveLocale`).
          { locale: "es-ES" },
        ),
      );
      const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await press(el, 'input[name="method"][value="card"]');
      if (refused) {
        await press(el, "[data-pay-continue]");
        getDeviceEquipment.mockResolvedValue(takenByMarc);
        await press(el, "[data-pay-confirm]");
      }
      await settled(el);
      expect(currentLocale()).toBe("es-ES");
      expect(row(el).open).toBe(true);
      if (refused) expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
      else
        expect(printerWarning(el)).toBe(
          t("pay_equipment.printer_switched_off").replace("{item}", "Barra"),
        );
      const panel = dialog(el)!
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector<HTMLElement>("dialog")!;
      const background = getComputedStyle(panel).backgroundColor;
      lookBackgrounds.set(`${state}-${theme}-${width}`, background);
      if (theme === "dark")
        expect(background).not.toBe(lookBackgrounds.get(`${state}-light-${width}`));
      const shot = `__screenshots__/look/a796-${state}-${theme}-${width}`;
      await page.screenshot({
        element: panel,
        path: `__screenshots__/look/a796-${state}-${theme}-${width}.png`,
      });
      const box = panel.getBoundingClientRect();
      const rowBox = row(el).getBoundingClientRect();
      await commands.writeFile(
        `src/${shot}.json`,
        JSON.stringify({
          innerWidth: window.innerWidth,
          panelWidth: box.width,
          rowInside: rowBox.left >= box.left && rowBox.right <= box.right,
          background,
        }),
      );
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it("a retry after a network failure refused reader.not_held says the server could not check it, never that nothing was charged (review 2's C1)", async () => {
    const answers: ((error: unknown) => void)[] = [];
    const takeBillPayment = vi.fn(
      () => new Promise<BillPaymentResult>((_resolve, reject) => answers.push(reject)),
    );
    const { el, getDeviceEquipment } = await billOnConfirmation({ takeBillPayment });
    getDeviceEquipment.mockResolvedValue(takenByMarc);
    const readsBefore = getDeviceEquipment.mock.calls.length;
    await press(el, "[data-pay-confirm]");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      answers[0]!(new TypeError("Failed to fetch"));
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    expect(answers).toHaveLength(2);
    answers[1]!(notHeld());
    await settled(el);

    expect(bottom(el)).toBe(t("bill_pay.not_checked"));
    expect(shownText(dialog(el)!.shadowRoot!)).not.toContain(t("bill_pay.reader_not_held"));
    expect(field(el, "cardReaderId")?.error ?? "").toBe("");
    expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore);
  });

  /** The sentence of `bill_pay.reader_not_held` that says nothing was charged. */
  const notCharged = () => t("bill_pay.reader_not_held").split(". ").at(-1)!;

  /** The presented sheet's Take, pressed and settled. */
  async function pressTake(el: TillApp): Promise<TillPayEquipment> {
    presented(el)!.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!.click();
    return settled(el);
  }

  /** A press refused `reader.not_held` on a bill with an earlier card of unknown outcome: the
   * reader field says so, the row is open, one equipment read is sent, and nothing anywhere says
   * no card was charged. */
  async function expectUnknownRefusal(
    el: TillApp,
    getDeviceEquipment: Mock,
    act: () => Promise<TillPayEquipment>,
    reread: DeviceEquipment = takenByMarc,
  ): Promise<void> {
    getDeviceEquipment.mockResolvedValue(reread);
    const readsBefore = getDeviceEquipment.mock.calls.length;
    const shown = await act();
    expect(shown.open).toBe(true);
    expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held_unknown"));
    expect(bottom(el)).toBe("");
    expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
    expect(codeMessage("reader.not_held")).toContain(notCharged());
    expect(shownText(sheet(el)!.shadowRoot!)).not.toContain(notCharged());
  }

  it.each([
    [
      "a send with no answer",
      (pay: Mock) => pay.mockRejectedValueOnce(new TypeError("Failed to fetch")),
      () => t("sale.unconfirmed"),
    ],
    [
      "a reader that did not answer",
      (pay: Mock) => pay.mockResolvedValueOnce({ outcome: "timeout" }),
      () => `${t("card.no_answer")}. ${t("card.pending_check")}`,
    ],
  ] as const)(
    "on the presented path, every press after %s refused reader.not_held asks for the reader and says the earlier card got no answer, never that nothing was charged",
    async (_name, first, shownFirst) => {
      const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
      const pay = vi.fn();
      first(pay);
      pay.mockRejectedValue(notHeld());
      const { el } = await mountApp(
        onPhone({
          getDeviceEquipment,
          pay,
          getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
        }),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await settled(el);
      await pressTake(el);
      expect(bottom(el)).toBe(shownFirst());

      // The re-reads still show the phone holding the reader, so the waiter can press again.
      await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el), holding());
      // The waiter closes the row; the next refusal opens it again and reads the equipment again.
      row(el).dispatchEvent(
        new CustomEvent("pay-equipment-toggle", { detail: { open: false }, bubbles: true }),
      );
      expect((await settled(el)).open).toBe(false);
      await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el), holding());
      expect(pay).toHaveBeenCalledTimes(3);
    },
  );

  const unknownBackgrounds = new Map<string, string>();
  it.each(["light", "dark"] as const)(
    "looks right, the presented sheet's refusal after a card that got no answer, %s at 390 px",
    async (theme) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(390, 900);
      try {
        expect(window.innerWidth).toBe(390);
        const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
        const pay = vi.fn().mockResolvedValueOnce({ outcome: "timeout" });
        pay.mockRejectedValue(notHeld());
        api = stubApi(
          onPhone(
            {
              getDeviceEquipment,
              pay,
              getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
            },
            { locale: "es-ES" },
          ),
        );
        const { el } = await mountWidget<TillApp>("till-app", { api }, theme);
        const order = await openPhoneTable(el);
        await pressPaySheet(el, order);
        await settled(el);
        await pressTake(el);
        getDeviceEquipment.mockResolvedValue(takenByMarc);
        await pressTake(el);
        expect(currentLocale()).toBe("es-ES");
        expect(row(el).open).toBe(true);
        expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held_unknown"));
        const panel = presented(el)!
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector<HTMLElement>("dialog")!;
        const background = getComputedStyle(panel).backgroundColor;
        unknownBackgrounds.set(theme, background);
        if (theme === "dark") expect(background).not.toBe(unknownBackgrounds.get("light"));
        const shot = `__screenshots__/look/a796-reader-refused-unknown-${theme}-390`;
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a796-reader-refused-unknown-${theme}-390.png`,
        });
        const box = panel.getBoundingClientRect();
        const rowBox = row(el).getBoundingClientRect();
        await commands.writeFile(
          `src/${shot}.json`,
          JSON.stringify({
            innerWidth: window.innerWidth,
            panelWidth: box.width,
            rowInside: rowBox.left >= box.left && rowBox.right <= box.right,
            background,
          }),
        );
      } finally {
        await page.viewport(viewport.width, viewport.height);
      }
    },
  );

  it("on the presented path, a send that got no answer after the order was left still marks the bill", async () => {
    const answers: ((error: unknown) => void)[] = [];
    const pay = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => answers.push(reject)))
      .mockRejectedValue(notHeld());
    const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment,
        pay,
        getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
      }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await settled(el);
    presented(el)!.shadowRoot!.querySelector<HTMLElement>("[data-presented-pay-take]")!.click();
    await flush(el);
    expect(answers).toHaveLength(1);
    const app = el as unknown as { activeTabId?: string };
    const billId = app.activeTabId;
    app.activeTabId = "elsewhere";
    answers[0]!(new TypeError("Failed to fetch"));
    await flush(el);
    app.activeTabId = billId;
    await flush(el);
    if (presented(el) === null) await pressPaySheet(el, order);
    await settled(el);

    await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el));
    expect(pay).toHaveBeenCalledTimes(2);
  });

  /** Three bill-path sends of a card that get no answer, leaving the dialog locked on Check again. */
  async function billUnanswered(overrides: Record<string, unknown> = {}) {
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue(notHeld());
    const opened = await billOnConfirmation({ takeBillPayment, ...overrides });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      dialog(opened.el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS * 3);
    } finally {
      vi.useRealTimers();
    }
    await settled(opened.el);
    expect(sent()).toHaveLength(3);
    expect(bottom(opened.el)).toBe(t("bill_pay.unconfirmed"));
    return { ...opened, takeBillPayment };
  }

  /** Check again, refused `reader.not_held`: the send may have been recorded, so `not_checked`. */
  async function checkAgainRefused(el: TillApp): Promise<void> {
    await press(el, "[data-pay-confirm]");
    await settled(el);
    expect(sent()).toHaveLength(4);
    expect(bottom(el)).toBe(t("bill_pay.not_checked"));
  }

  it("on the presented path, Pay after a bill payment on that bill got no answer opens that payment locked on Check again, and charges nothing", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
    const pay = vi.fn().mockRejectedValue(notHeld());
    const { el, order } = await billUnanswered({ getPartyBills, pay });
    getPartyBills.mockResolvedValue([billOf({ status: "placed" })]);
    dialog(el)!.dispatchEvent(new CustomEvent("bill-pay-close", { bubbles: true, composed: true }));
    order.dispatchEvent(
      new CustomEvent("pay-presented", {
        detail: { workingOrderId: billOf().workingOrderId },
        bubbles: true,
        composed: true,
      }),
    );
    await settled(el);

    expect(presented(el)).toBeNull();
    expect(dialog(el)!.confirmationLocked).toBe(true);
    expect(text(inDialog(el, "[data-pay-confirm]"))).toBe(t("bill_pay.recheck"));
    expect(pay).not.toHaveBeenCalled();
  });

  it("on the presented path, a press refused reader.not_held after a bill payment on that bill got no answer, after its Check again was refused reader.not_held, never says nothing was charged", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
    const pay = vi.fn().mockRejectedValue(notHeld());
    const { el, order, getDeviceEquipment } = await billUnanswered({ getPartyBills, pay });
    await checkAgainRefused(el);
    getPartyBills.mockResolvedValue([billOf({ status: "placed" })]);
    dialog(el)!.dispatchEvent(new CustomEvent("bill-pay-close", { bubbles: true, composed: true }));
    order.dispatchEvent(
      new CustomEvent("pay-presented", {
        detail: { workingOrderId: billOf().workingOrderId },
        bubbles: true,
        composed: true,
      }),
    );
    await settled(el);

    await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el));
    expect(pay).toHaveBeenCalledOnce();
  });

  it("on the bill path, a fresh Take payment refused reader.not_held after an unanswered card on the bill never says nothing was charged", async () => {
    const { el, getDeviceEquipment } = await billUnanswered();
    await checkAgainRefused(el);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");

    await expectUnknownRefusal(el, getDeviceEquipment, async () => {
      await press(el, "[data-pay-confirm]");
      return settled(el);
    });
    expect(sent()).toHaveLength(5);
    expect(sent()[4]!.submissionId).not.toBe(sent()[0]!.submissionId);
  });

  it("on the bill path, a fresh Take payment refused reader.not_held after an automatic retry answered not_checked never says nothing was charged", async () => {
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue(notHeld());
    const { el, getDeviceEquipment } = await billOnConfirmation({ takeBillPayment });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    await settled(el);
    expect(sent()).toHaveLength(2);
    expect(bottom(el)).toBe(t("bill_pay.not_checked"));
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");

    await expectUnknownRefusal(el, getDeviceEquipment, async () => {
      await press(el, "[data-pay-confirm]");
      return settled(el);
    });
    expect(sent()).toHaveLength(3);
  });

  it("on the bill path, a cash payment that got no answer does not stop a later card's refusal saying nothing was charged", async () => {
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        takenOf(
          { method: "cash", entry: null, applied: "40.00", tendered: "40.00", change: "0.00" },
          { received: "40.00", outstanding: "80.00" },
        ),
      )
      .mockRejectedValue(notHeld());
    const getDeviceEquipment = vi.fn().mockResolvedValue(holding());
    const previewBillPayment = vi
      .fn()
      .mockResolvedValueOnce(cash("40.00", "0.00"))
      .mockResolvedValue({ ...wholeCard, applied: "40.00", charged: "40.00" });
    const { el } = await mountApp(
      onPhone({ getDeviceEquipment, previewBillPayment, takeBillPayment }),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await press(el, 'input[name="method"][value="cash"]');
    await type(el, "tendered", "40");
    await press(el, "[data-pay-continue]");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS * 3);
    } finally {
      vi.useRealTimers();
    }
    await settled(el);
    expect(bottom(el)).toBe(t("bill_pay.unconfirmed"));
    await press(el, "[data-pay-confirm]");
    await flush(el);
    expect(sent()).toHaveLength(4);
    expect(sent()[3]!.submissionId).toBe(sent()[0]!.submissionId);
    expect(inDialog(el, "[data-pay-taken]")).not.toBeNull();
    await press(el, "[data-pay-next]");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    getDeviceEquipment.mockResolvedValue(takenByMarc);

    await press(el, "[data-pay-confirm]");
    const shown = await settled(el);

    expect(sent()).toHaveLength(5);
    expect(shown.open).toBe(true);
    expect(field(el, "cardReaderId").error).toBe(t("bill_pay.reader_not_held"));
  });

  /** Closes the bill's payment sheet and opens the presented sheet on the same bill. */
  async function presentAfterBill(
    el: TillApp,
    order: HTMLElement,
    getPartyBills: Mock,
  ): Promise<void> {
    getPartyBills.mockResolvedValue([billOf({ status: "placed" })]);
    dialog(el)!.dispatchEvent(new CustomEvent("bill-pay-close", { bubbles: true, composed: true }));
    order.dispatchEvent(
      new CustomEvent("pay-presented", {
        detail: { workingOrderId: billOf().workingOrderId },
        bubbles: true,
        composed: true,
      }),
    );
    await settled(el);
  }

  it("on the presented path, a press refused reader.not_held after a bill-path card whose first attempt got no answer and whose retry was refused reader.not_found never says nothing was charged", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
    const pay = vi.fn().mockRejectedValue(notHeld());
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "reader.not_found", params: { id: READER_ID }, status: 400 });
    const { el, order, getDeviceEquipment } = await billOnConfirmation({
      getPartyBills,
      pay,
      takeBillPayment,
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-pay-confirm]")!.click();
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS);
    } finally {
      vi.useRealTimers();
    }
    await settled(el);
    expect(sent()).toHaveLength(2);
    await presentAfterBill(el, order, getPartyBills);

    await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el));
    expect(pay).toHaveBeenCalledOnce();
  });

  it("on the presented path, a press refused reader.not_held after a bill-path card answered timeout never says nothing was charged", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([billOf()]);
    const pay = vi.fn().mockRejectedValue(notHeld());
    const takeBillPayment = vi.fn().mockResolvedValue({
      ...takenOf(
        { method: "card", entry: "reader", applied: "120.00", state: "pending", change: null },
        { reserved: "120.00", outstanding: "0.00" },
      ),
      outcome: "timeout",
    });
    const { el, order, getDeviceEquipment } = await billOnConfirmation({
      getPartyBills,
      pay,
      takeBillPayment,
    });
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    await presentAfterBill(el, order, getPartyBills);

    await expectUnknownRefusal(el, getDeviceEquipment, () => pressTake(el));
    expect(pay).toHaveBeenCalledOnce();
  });

  it.each([
    {
      code: "server.internal",
      status: 503,
      held: true,
      refusal: "bill_pay.reader_not_held_unknown",
    },
    {
      code: "reader.not_found",
      status: 404,
      held: false,
      refusal: "bill_pay.reader_not_held",
    },
  ] as const)(
    "on the bill path, a reader refusal after an earlier $status answer preserves what is known of the charge",
    async ({ code, status, held, refusal }) => {
      const takeBillPayment = vi
        .fn()
        .mockRejectedValueOnce({ code, status })
        .mockRejectedValue(notHeld());
      const { el, getDeviceEquipment } = await billOnConfirmation({ takeBillPayment });
      await press(el, "[data-pay-confirm]");
      await settled(el);
      if (held) {
        expect(dialog(el)!.confirmationLocked).toBe(true);
        expect(bottom(el)).toBe(t("bill_pay.unconfirmed"));
      } else {
        expect(dialog(el)!.confirmationLocked).toBe(false);
        await press(el, "[data-pay-continue]");
      }
      await press(el, "[data-pay-confirm]");
      await settled(el);
      expect(bottom(el)).toBe(t("bill_pay.not_checked"));
      await press(el, 'input[name="method"][value="card"]');
      await press(el, "[data-pay-continue]");
      getDeviceEquipment.mockResolvedValue(takenByMarc);

      await press(el, "[data-pay-confirm]");
      const shown = await settled(el);

      const ids = sent().map((request) => request.submissionId);
      expect(ids).toHaveLength(3);
      expect(ids[1]).toBe(ids[0]);
      expect(ids[2]).not.toBe(ids[0]);
      expect(shown.open).toBe(true);
      expect(field(el, "cardReaderId").error).toBe(t(refusal));
    },
  );

  describe("a printer that would print nothing", () => {
    const off = (selection: "item" | "default"): RoleEquipment =>
      selection === "item"
        ? roleOf("receipt", UNAVAILABLE_BAR_PRINTER, [UNAVAILABLE_BAR_PRINTER, TERRACE_PRINTER])
        : {
            ...roleOf("receipt", UNAVAILABLE_BAR_PRINTER, [
              UNAVAILABLE_BAR_PRINTER,
              TERRACE_PRINTER,
            ]),
            selection: "default",
            chosenId: null,
            chosen: null,
            default: UNAVAILABLE_BAR_PRINTER,
          };
    const switchedOffLine = () =>
      t("pay_equipment.printer_switched_off").replace("{item}", "Barra");

    async function onForm(receipt: RoleEquipment) {
      const { el } = await mountApp(
        onPhone({ getDeviceEquipment: vi.fn().mockResolvedValue(holding(receipt)) }),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await press(el, 'input[name="method"][value="card"]');
      await settled(el);
      return el;
    }
    const continueDisabled = (el: TillApp) =>
      (inDialog(el, "[data-pay-continue]") as HTMLElement & { disabled: boolean }).disabled;
    async function paid(el: TillApp): Promise<void> {
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ method: "card", entry: "reader", readerId: "r2" });
    }

    it.each([
      ["chosen and switched off", off("item"), switchedOffLine],
      ["the default, switched off", off("default"), switchedOffLine],
      [
        "listed with none set",
        roleOf("receipt", null, [BAR_PRINTER, TERRACE_PRINTER]),
        () => t("pay_equipment.printer_none"),
      ],
    ] as const)(
      "a printer %s opens the row with the printer empty and a warning; Continue stays enabled and the card is sent",
      async (_how, receipt, warning) => {
        const el = await onForm(receipt);

        expect(row(el).open).toBe(true);
        expect(field(el, "receiptPrinterId").value).toBe("");
        expect(printerWarning(el)).toBe(warning());
        expect(continueDisabled(el)).toBe(false);
        await paid(el);
      },
    );

    it("a printer the server forgot falls back to the profile's default: row closed, labelled, and the card is sent", async () => {
      const el = await onForm({
        ...roleOf("receipt", TERRACE_PRINTER, [TERRACE_PRINTER]),
        selection: "default",
        chosenId: null,
        chosen: null,
        default: TERRACE_PRINTER,
      });

      expect(row(el).open).toBe(false);
      expect(await rowSummary(el)).toContain(
        t("pay_equipment.ticket_at_default").replace("{printer}", "Terraza"),
      );
      expect(printerWarning(el)).toBeUndefined();
      await paid(el);
    });

    it("a profile with no receipt printer reads sin ticket with the row closed, and the card is sent", async () => {
      const el = await onForm(roleOf("receipt", null, []));

      expect(row(el).open).toBe(false);
      expect(await rowSummary(el)).toContain(t("pay_equipment.no_ticket"));
      expect(printerWarning(el)).toBeUndefined();
      await paid(el);
    });

    it("the presented sheet shows the switched-off printer's warning and still takes the card", async () => {
      const pay = vi
        .fn()
        .mockResolvedValue({ outcome: "captured", ticket: invoiceOf("120.00", "F2") });
      const { el } = await mountApp(
        onPhone({
          getDeviceEquipment: vi.fn().mockResolvedValue(holding(off("item"))),
          pay,
          getPartyBills: vi
            .fn()
            .mockResolvedValue([billOf({ status: "placed", receiptAvailable: true })]),
        }),
      );
      const order = await openPhoneTable(el);
      await pressPaySheet(el, order);
      await settled(el);

      expect(row(el).open).toBe(true);
      expect(printerWarning(el)).toBe(switchedOffLine());
      const take = presented(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-presented-pay-take]",
      )!;
      expect(take.disabled).toBe(false);
      take.click();
      await flush(el);
      expect(pay).toHaveBeenCalledOnce();
    });
  });
});

describe("till-app: Finish table refused from the ⋮ on a handheld opened from the floor", () => {
  it("shows the refusal, its Take payment and its Record unpaid departure in the window at 390x844", async () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(390, 844);
    try {
      const { el } = await mountApp(
        onPhone({
          getTablesState: vi
            .fn()
            .mockResolvedValue([mesa({ outstanding: "148.50", billCount: 2 })]),
          getPartyBills: vi.fn().mockResolvedValue([
            billOf(),
            billOf({
              workingOrderId: "wo-5",
              billNumber: 2,
              total: "28.50",
              outstanding: "28.50",
            }),
          ]),
          finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
        }),
      );
      const order = await openTable(el);
      await resized(order);
      expect(order.shadowRoot!.querySelector("[data-draft-pane]")!.checkVisibility()).toBe(true);
      expect(
        order.shadowRoot!.querySelector("[data-view=order]")!.getAttribute("aria-pressed"),
      ).toBe("true");

      await openTableMenu(order);
      await userEvent.click(inOrder(order, "[data-table-menu] [data-finish-table]")!);
      await flush(el);

      expect(vi.mocked(api.finishTable)).toHaveBeenCalledTimes(1);
      const refusal = inOrder(order, "[data-finish-refusal]")!;
      expect(refusal).not.toBeNull();
      expect(refusal.checkVisibility()).toBe(true);
      expect(text(refusal.querySelector("span"))).toBe(codeMessage("party.bill_outstanding"));
      expect(inOrder(order, "[data-finish-refusal] [data-take-payment]")!.checkVisibility()).toBe(
        true,
      );
      expect(
        inOrder(order, "[data-finish-refusal] [data-record-departure]")!.checkVisibility(),
      ).toBe(true);
      await expect
        .poll(() => {
          const box = refusal.getBoundingClientRect();
          // scrollIntoView leaves the box's fractional offset, under a pixel past the edge.
          return box.top >= 0 && Math.round(box.bottom) <= innerHeight;
        })
        .toBe(true);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});

describe("a presented counter bill from Find a bill, on a device with no counter screen", () => {
  const presentedCounter = billRow({
    workingOrderId: "wo-presented",
    orderStatus: "placed",
    partyId: null,
    collectionStatus: null,
    state: "unpaid",
    total: "9.90",
    paid: "0.00",
    stillOwed: "9.90",
  });
  const findDialog = (el: TillApp) => el.shadowRoot!.querySelector("till-find-bill-dialog");
  const inFind = (el: TillApp, selector: string) =>
    findDialog(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const stage = (el: TillApp) => (el as unknown as { stage: string }).stage;
  const noCounterTill = {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["z1"])),
  };
  const tableStartTill = {
    getDeviceZones: vi.fn().mockResolvedValue({
      ...deviceZonesFixture(["bar"], ["z1"]),
      startingZoneId: "z1",
    }),
  };

  async function openRow(
    row: BillRow,
    device: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) {
    const { el } = await mountApp({
      ...device,
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage([row])),
      getFindBill: vi.fn().mockResolvedValue(row),
      retrievePlacedOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
      getTabLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
      collectOrder: vi.fn().mockResolvedValue(saleOf("9.90")),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", jobId: "job-1", canRetry: false }),
      getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
      ...overrides,
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(stage(el)).toBe("order");
    emit(shell(el), "find-bill");
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-bill-open", { row });
    await flush(el);
    return el;
  }

  const devices = [
    ["a handheld", onPhone()],
    ["a till with no counter zones", noCounterTill],
  ] as const;

  it.each(devices)(
    "on %s, it opens Find a bill's collecting dialog on what it owes, reads no order into the basket, and cash collects it once",
    async (_, device) => {
      const el = await openRow(presentedCounter, device);
      await vi.waitFor(() => expect(inFind(el, "[data-collect]")).not.toBeNull());
      expect(text(findDialog(el)!.shadowRoot!.querySelector("strong"))).toContain(money("9.90"));
      expect(el.shadowRoot!.querySelector("till-find-bill-screen")!.checkVisibility()).toBe(true);
      expect(api.retrievePlacedOrder).not.toHaveBeenCalled();
      expect(api.retrieveWorkingOrder).not.toHaveBeenCalled();
      expect(api.getTabLines).not.toHaveBeenCalled();
      expect(stage(el)).toBe("order");

      inFind(el, "[data-collect]")!.click();
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      expect(api.collectOrder).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.collectOrder).mock.calls[0]!.slice(0, 2)).toEqual([
        "wo-presented",
        { method: "cash", amount: "9.90" },
      ]);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.retrievePlacedOrder).not.toHaveBeenCalled();
      expect(api.getTabLines).not.toHaveBeenCalled();
      expect(stage(el)).toBe("order");
    },
  );

  it.each([
    ...devices,
    ["a till with counter zones whose starting zone is a table zone", tableStartTill],
    ["a till with counter zones", {}],
  ] as const)("on %s, Find a bill's back button names where it goes", async (name, device) => {
    const { el } = await mountApp({
      ...device,
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage([])),
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    const app = el as unknown as { activeTabKey?: string; drill?: { kind: string } };
    // Away from home first, so the check after Back shows that Back moved the till there.
    if (device === tableStartTill) {
      app.activeTabKey = "counter";
      await flush(el);
    }
    emit(shell(el), "find-bill");
    await flush(el);
    expect(app.drill?.kind).toBe("find-bill");
    const back = el
      .shadowRoot!.querySelector("till-find-bill-screen")!
      .shadowRoot!.querySelector<HTMLElement>("header wt-button")!;
    const toCounter = name === "a till with counter zones";
    expect(text(back)).toBe(toCounter ? "Back to counter" : "Back");
    back.click();
    await flush(el);
    expect(app.drill).toBeUndefined();
    expect(app.activeTabKey).toBe(toCounter ? "counter" : "floor");
  });

  const screens = ["show-station", "show-expo", "show-schedule"] as CapabilityFlag[];
  const onTill = (capabilities: CapabilityFlag[]) => ({
    getTill: vi
      .fn()
      .mockResolvedValue({ ...till, capabilities: [...till.capabilities, ...capabilities] }),
  });
  it.each([
    ["a handheld", "show-schedule", "till-schedule-screen", "wt-button.back"],
    ["a handheld", "show-station", "till-station-screen", "[data-back]"],
    ["a handheld", "show-expo", "till-pass-screen", "[data-back]"],
    ["a till with no counter zones", "show-schedule", "till-schedule-screen", "wt-button.back"],
    ["a till with no counter zones", "show-expo", "till-pass-screen", "[data-back]"],
    ["a till with counter zones", "show-schedule", "till-schedule-screen", "wt-button.back"],
    ["a till with counter zones", "show-expo", "till-pass-screen", "[data-back]"],
    [
      "a till with counter zones whose starting zone is a table zone",
      "show-schedule",
      "till-schedule-screen",
      "wt-button.back",
    ],
    [
      "a till with counter zones whose starting zone is a table zone",
      "show-expo",
      "till-pass-screen",
      "[data-back]",
    ],
  ] as const)("on %s, %s's back button names where it goes", async (name, open, tag, button) => {
    const device =
      name === "a handheld"
        ? onPhone({}, { capabilities: [...phoneCapabilities, ...screens] })
        : name === "a till with no counter zones"
          ? { ...noCounterTill, ...onTill(screens) }
          : name === "a till with counter zones"
            ? onTill(screens)
            : { ...tableStartTill, ...onTill(screens) };
    const { el } = await mountApp(device);
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(shell(el), open);
    await flush(el);
    const back = el.shadowRoot!.querySelector(tag)!.shadowRoot!.querySelector(button);
    expect(text(back)).toBe(name === "a till with counter zones" ? "Back to counter" : "Back");
  });

  it.each(devices)("on %s, a presented TABLE bill still opens its table", async (_, device) => {
    const row = billRow({
      workingOrderId: "wo-4",
      orderStatus: "placed",
      partyId: "v1",
      collectionStatus: null,
      state: "unpaid",
    });
    const el = await openRow(row, device);
    await vi.waitFor(() => expect(tableOrder(el)).not.toBeNull());
    expect(findDialog(el)).toBeNull();
    expect(api.collectOrder).not.toHaveBeenCalled();
  });

  it("on a till with counter zones, it loads into the counter as before, with no collecting dialog", async () => {
    const el = await openRow(presentedCounter, {});
    await vi.waitFor(() => expect(api.retrievePlacedOrder).toHaveBeenCalledTimes(1));
    await flush(el);
    expect(findDialog(el)).toBeNull();
    expect(api.collectOrder).not.toHaveBeenCalled();
  });

  it("a handheld that takes no cash offers only the card on the terminal", async () => {
    const el = await openRow(
      presentedCounter,
      {},
      {
        ...onPhone({}, { capabilities: ["print-receipt", "hand-keyed-card-payment"] }),
      },
    );
    await vi.waitFor(() => expect(inFind(el, "[data-collect]")).not.toBeNull());
    expect(inFind(el, "[data-cash]")).toBeNull();
    expect(inFind(el, "[data-card]")).not.toBeNull();
  });

  it("a departed bill on a handheld that takes no card on a terminal offers only cash", async () => {
    const departed = billRow({
      workingOrderId: "wo-departed",
      collectionStatus: "left_without_paying",
      departedAt: "2026-10-15T14:00:00Z",
    });
    const el = await openRow(
      departed,
      {},
      {
        ...onPhone({}, { capabilities: ["print-receipt", "take-cash"] }),
      },
    );
    await vi.waitFor(() => expect(inFind(el, "[data-collect]")).not.toBeNull());
    expect(inFind(el, "[data-cash]")).not.toBeNull();
    expect(inFind(el, "[data-card]")).toBeNull();
  });

  it.each([
    ["device.cash_not_allowed", "en"],
    ["device.cash_not_allowed", "es"],
    ["device.forbidden_action", "en"],
    ["device.forbidden_action", "es"],
  ] as const)(
    "a collection refused with %s says so in its own words (%s)",
    async (code, locale) => {
      setLocale(locale);
      const el = await openRow(presentedCounter, onPhone(), {
        collectOrder: vi.fn().mockRejectedValue({ code, action: "hand-keyed-card-payment" }),
      });
      await vi.waitFor(() => expect(inFind(el, "[data-collect]")).not.toBeNull());
      inFind(el, "[data-collect]")!.click();
      await vi.waitFor(() => expect(api.collectOrder).toHaveBeenCalledTimes(1));
      await flush(el);
      const actions = inFind(el, "wt-form-actions") as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await actions.updateComplete;
      const shown = actions.shadowRoot!.querySelector("[data-error]")!.textContent!.trim();
      expect(shown).toBe(codeMessage(code));
      expect(shown).not.toBe(t("sale.error"));
    },
  );
});

describe("a parked counter bill from Find a bill, on a device with no counter screen", () => {
  const draughtBeer = {
    id: "cana",
    menuItemId: "offer-cana",
    catalogueId: "cat-default",
    name: "Caña",
    pricingUnit: "each" as const,
    unitPrice: "9.90",
    vatClass: "general",
    category: null,
    allergens: null,
  };
  const parked = billRow({
    workingOrderId: "wo-parked",
    orderStatus: "open",
    partyId: null,
    collectionStatus: null,
    state: "unpaid",
    total: "9.90",
    paid: "0.00",
    stillOwed: "9.90",
  });
  const partPaid = billRow({
    workingOrderId: "wo-parked",
    orderStatus: "open",
    partyId: null,
    collectionStatus: null,
    state: "part-paid",
    total: "9.90",
    paid: "5.00",
    stillOwed: "4.90",
  });
  const stage = (el: TillApp) => (el as unknown as { stage: string }).stage;
  const counterLines = (el: TillApp) => (el as unknown as { counterLines: unknown }).counterLines;
  const noCounterTill = {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["z1"])),
  };
  const counterScreen = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { store: { id: string; lines: unknown[] } }>(
      "till-counter-screen",
    );

  async function openRow(row: BillRow, device: Record<string, unknown>) {
    const { el } = await mountApp({
      ...device,
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage([row])),
      getFindBill: vi.fn().mockResolvedValue(row),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        kitchenNote: {
          scope: { workingOrderId: "wo-parked" },
          note: null,
          revision: 0,
          ownerRevision: 1,
        },
        id: "wo-parked",
        orderNumber: 42,
        label: "Lucía",
        revision: 1,
        lines: [
          {
            workingOrderLineId: "l1",
            menuItemId: "offer-cana",
            quantity: "1.000",
            product: draughtBeer,
          },
        ],
      }),
      getTabLines: vi.fn().mockResolvedValue({
        revision: 1,
        lines: [line({ id: "l1", lineNo: 1, name: "Caña", unitPriceGross: "9.90" })],
      }),
      getBillBalance: vi.fn().mockResolvedValue(
        balanceOf({
          workingOrderId: "wo-parked",
          total: "9.90",
          received: row.paid,
          outstanding: row.stillOwed,
        }),
      ),
      previewBillPayment: vi.fn().mockResolvedValue(cash(row.stillOwed, "0.00")),
      takeBillPayment: vi.fn().mockResolvedValue(
        takenOf(
          { method: "cash", applied: row.stillOwed, tendered: row.stillOwed, change: "0.00" },
          {
            workingOrderId: "wo-parked",
            total: "9.90",
            received: "9.90",
            outstanding: "0.00",
            status: "settled",
          },
          { ...saleOf("9.90"), invoiceNumber: "F-PARKED" },
        ),
      ),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", jobId: "job-1", canRetry: false }),
      getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(shell(el), "find-bill");
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-bill-open", { row });
    await flush(el);
    return el;
  }

  /** Cash for what the bill owes: a handheld picks it, a till types what was handed over. */
  async function payCash(el: TillApp, owed: string) {
    if (inDialog(el, 'input[name="method"][value="cash"]') !== null)
      await press(el, 'input[name="method"][value="cash"]');
    if (inDialog(el, 'wt-input[name="tendered"]') !== null) await type(el, "tendered", owed);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
  }

  /** Signs out and in again; the basket is empty when the sign-in reads the default zone's offers. */
  async function signInAgain(el: TillApp) {
    emit(shell(el), "logout");
    await flush(el);
    vi.mocked(api.listDefaultZoneOffers).mockClear();
    vi.mocked(api.listZoneOffers).mockClear();
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
  }

  function expectEmptied(el: TillApp) {
    expect(stage(el)).toBe("order");
    expect(counterLines(el)).toBeNull();
    expect(floor(el).checkVisibility()).toBe(true);
  }

  const devices = [
    ["a handheld", onPhone()],
    ["a till with no counter zones", noCounterTill],
  ] as const;

  it.each([
    ["a handheld", onPhone(), "whole", ""],
    // A till's pay window offers no whole-bill way; a contribution of what is owed sends the same.
    ["a till with no counter zones", noCounterTill, "contribution", "9.90"],
  ] as const)(
    "on %s, a parked bill opens the pay window on paying all of it, and cash pays it once and shows the ticket",
    async (_, device, way, amount) => {
      const el = await openRow(parked, device);
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", way);
      expect(dialog(el)!.amount).toBe(amount);
      await payCash(el, "9.90");
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      expect(api.takeBillPayment).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.takeBillPayment).mock.calls[0]![0]).toBe("wo-parked");
      expect(sent()[0]).toMatchObject({ method: "cash" });
      expect(documentChoice(el)!.result.invoiceNumber).toBe("F-PARKED");
    },
  );

  it.each(devices)("on %s, a part-paid bill still opens on a contribution", async (_, device) => {
    const el = await openRow(partPaid, device);
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", "contribution");
  });

  it.each([
    ["a handheld", "parked", onPhone(), parked],
    ["a handheld", "part-paid", onPhone(), partPaid],
    ["a till with no counter zones", "parked", noCounterTill, parked],
    ["a till with no counter zones", "part-paid", noCounterTill, partPaid],
  ] as const)(
    "on %s, Close on a %s bill's pay window empties the basket and leaves the Floor showing",
    async (_, __, device, row) => {
      const el = await openRow(row, device);
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      emit(dialog(el)!, "bill-pay-close");
      await flush(el);
      expect(dialog(el)).toBeNull();
      expectEmptied(el);

      await signInAgain(el);
      expect(api.listZoneOffers).not.toHaveBeenCalled();
    },
  );

  it.each(devices)(
    "on %s, paying the bill empties the basket, without waiting for New sale",
    async (_, device) => {
      const el = await openRow(parked, device);
      await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
      await payCash(el, "9.90");
      await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
      expect(stage(el)).toBe("order");
      expect(counterLines(el)).toBeNull();

      await signInAgain(el);
      expect(api.listZoneOffers).not.toHaveBeenCalled();
    },
  );

  it("on a till with counter zones, a parked bill loads into the counter with no pay window", async () => {
    const el = await openRow(parked, {});
    await vi.waitFor(() => expect(counterScreen(el)?.store.id).toBe("wo-parked"));
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(counterScreen(el)!.store.lines).toHaveLength(1);
  });

  it("on a till with counter zones, Close on a part-paid bill's pay window keeps it in the basket", async () => {
    const el = await openRow(partPaid, {});
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    expect(inDialog(el, 'input[name="way"]:checked')).toHaveProperty("value", "contribution");
    emit(dialog(el)!, "bill-pay-close");
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(counterScreen(el)!.store.id).toBe("wo-parked");
    expect(counterScreen(el)!.store.lines).toHaveLength(1);
  });

  it("on a till with counter zones, paying a part-paid bill off keeps it in the basket until New sale", async () => {
    const el = await openRow(partPaid, {});
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await type(el, "amount", "4.90");
    await payCash(el, "4.90");
    await vi.waitFor(() => expect(documentChoice(el)).not.toBeNull());
    expect(api.takeBillPayment).toHaveBeenCalledTimes(1);
    await signInAgain(el);
    expect(api.listZoneOffers).toHaveBeenCalledWith("z1");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { formatEquipmentCode } from "@waitron/shared";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
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
  TillApi,
} from "./api/client.js";
import type { TillPayEquipment } from "./widgets/pay-equipment.js";
import type { PresentedPayDetail, TillPresentedPayDialog } from "./widgets/presented-pay-dialog.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import { FakeNdefReader, installNfc, PRINTER_ID, READER_ID } from "../test/equipment-nfc.js";
import { cameraFilming } from "../test/qr-camera.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  balanceOf,
  BARRA,
  billOf,
  cash,
  dialog,
  discardUnsavedLeave,
  drafts,
  floor,
  emit,
  equipmentItem,
  equipmentWith,
  LECTOR_2,
  lock,
  money,
  paymentOf,
  roleOf,
  shell,
  tableOrder,
  flush,
  inDialog,
  invoiceOf,
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

let api: TillApi;

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

const sent = (): BillPaymentRequest[] =>
  vi.mocked(api.takeBillPayment).mock.calls.map(([, request]) => request);

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
    getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(LECTOR_2)),
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
  it("Cobrar opens the sheet on the whole bill, naming the phone's reader, and reads the equipment again", async () => {
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

  it("a whole-bill card payment, from the dialog's own Cobrar, charges the row's reader", async () => {
    const { el } = await mountApp(onPhone());
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ method: "card", entry: "reader", readerId: "r2" });
  });

  it("Toda la cuenta on a partly paid bill sends what the bill still owes", async () => {
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

  it("a practice venue's phone charges its demo reader, which the row shows fixed", async () => {
    const { el } = await mountApp(
      onPhone(
        { getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(null)) },
        {
          cardProvider: "simulator",
          activeReaders: [{ id: "demo-1", name: "Demo card reader", provider: "simulator" }],
          defaultReaderId: "demo-1",
        },
      ),
    );
    const order = await openPhoneTable(el);
    await pressPaySheet(el, order);
    expect(dialog(el)!.fixedReader).toEqual({ id: "demo-1", name: "Demo card reader" });
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ method: "card", entry: "reader", readerId: "demo-1" });
  });

  it("a partly paid bill keeps its amount lines and bill choices beside one Cobrar", async () => {
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
    expect(inOrder(order, "[data-choose-bill-invoice]")).not.toBeNull();
    expect(order.shadowRoot!.querySelectorAll("[data-pay-sheet]")).toHaveLength(1);
    expect(inOrder(order, "[data-pay-rest]")).toBeNull();
    expect(inOrder(order, "[data-open-bill-pay]")).toBeNull();
  });

  it("a presented bill draws one Cobrar in place of today's pay card", async () => {
    const { el } = await mountApp(
      onPhone({ getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]) }),
    );
    const order = await openPhoneTable(el);

    expect(inOrder(order, "till-tender-pay")).toBeNull();
    expect(order.shadowRoot!.querySelectorAll("[data-pay-sheet]")).toHaveLength(1);
  });
});

describe("a presented bill on a handheld", () => {
  const presented = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillPresentedPayDialog>("till-presented-pay-dialog");
  const inPresented = (el: TillApp, selector: string) =>
    presented(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const placedBill = billOf({ status: "placed", receiptAvailable: true });
  const ticket = () => invoiceOf("120.00");
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

  it("Cobrar opens the presented bill's sheet on its whole amount and reads the equipment again", async () => {
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

  it("a full invoice's presented bill asks for no guests", async () => {
    const { el } = await openPresented({
      getPartyBills: vi.fn().mockResolvedValue([{ ...placedBill, invoiceType: "F1" }]),
    });
    expect(presented(el)!.asksGuests).toBe(false);
    await takeOnReader(el);
    expect(vi.mocked(api.pay).mock.calls[0]![0]).not.toHaveProperty("guests");
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

  it("a card is charged on the row's reader through the integrated payment, then the ticket shows", async () => {
    const { el } = await openPresented();
    await takeOnReader(el);

    expect(vi.mocked(api.pay)).toHaveBeenCalledOnce();
    expect(vi.mocked(api.pay).mock.calls[0]![0]).toEqual({
      expectedEdit: editOfBill,
      id: "wo-4",
      lines: [],
      readerId: "r2",
      guests: 4,
    });
    expect(vi.mocked(api.takeBillPayment)).not.toHaveBeenCalled();
    expect(vi.mocked(api.collectOrder)).not.toHaveBeenCalled();
    expect(presented(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
  });

  it("cash is collected with what was handed over and the guests, then the ticket shows", async () => {
    const { el } = await openPresented();
    await payFromSheet(el, { method: "cash", tendered: "150.00", guests: 3 });

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
    expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
  });

  it("another card machine is collected as a card of the whole amount with its operation number", async () => {
    const { el } = await openPresented();
    await payFromSheet(el, { method: "manual", externalRef: "OP-7", guests: null });

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
      else await payFromSheet(el, { method: "cash", tendered: "150.00", guests: 4 });
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
      { code: "authorization.not_permitted", permission: "sale.take_payment" },
      "take_payment.not_permitted",
    ],
    [{ code: "fiscal.record_invalid" }, "sale.refused"],
    [{ code: "something.else" }, "sale.error"],
  ] as const)("a cash send refused as %o says %s, as the pay card does", async (error, key) => {
    const { el } = await openPresented({ collectOrder: vi.fn().mockRejectedValue(error) });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guests: 4 });

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t(key));
    expect(el.shadowRoot!.textContent).not.toContain(t(key));
  });

  it("a cash send refused as paid meanwhile says so on the sheet and reads the bills again", async () => {
    const { el } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    });
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;
    await payFromSheet(el, { method: "cash", tendered: "150.00", guests: 4 });

    expect(presented(el)!.open).toBe(true);
    expect(await sheetMessage(el)).toBe(t("bill.pay_with_bill_payments"));
    expect(el.shadowRoot!.textContent).not.toContain(t("bill.pay_with_bill_payments"));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads);
  });

  it("a cash send with no answer closes the sheet, leaving the bill's one Pay", async () => {
    const { el, order } = await openPresented({
      collectOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await payFromSheet(el, { method: "cash", tendered: "150.00", guests: 4 });

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
      await page.screenshot({ element: panel, path: `${shot}.png` });
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
  const presented = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillPresentedPayDialog>("till-presented-pay-dialog");
  const inPresented = (el: TillApp, selector: string) =>
    presented(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const placedBill = billOf({ status: "placed", receiptAvailable: true });
  const noAnswer = () => new TypeError("Failed to fetch");
  const asked = {
    cash: { method: "cash", tendered: "150.00", guests: 4 },
    manual: { method: "manual", externalRef: "operation-17", guests: 4 },
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
    expect(sheet.confirmation?.guests).toBe(4);
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
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")?.click();
    await flush(el);
    await showBillFooter(order);
    await pressPaySheet(el, order);
  }

  async function resend(el: TillApp): Promise<void> {
    inPresented(el, "[data-presented-pay-resend]")!.click();
    await flush(el);
  }

  it.each(["cash", "manual"] as const)(
    "a %s payment with no answer reopens the sheet locked on it, and its action sends it again; answered, the ticket shows",
    async (method) => {
      const send = vi
        .fn()
        .mockRejectedValueOnce(noAnswer())
        .mockResolvedValueOnce(invoiceOf("120.00"));
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
      expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
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
        .mockResolvedValueOnce(invoiceOf("120.00"));
      const { el } = await sentWithNoAnswer(method, send);
      emit(presented(el)!, "presented-pay-close");
      await flush(el);

      await signInAgainAndReopen(el);

      await expectLockedOn(el, method);
      await resend(el);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
      expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
    },
  );
  it("a resend carries the original request after another person's draft has changed the bill", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockResolvedValueOnce(invoiceOf("120.00"));
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
    expect(el.shadowRoot!.querySelector("till-ticket-view")).not.toBeNull();
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
  const LECTOR_3 = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });
  const LECTOR_4 = equipmentItem("c45f83b1-3333-4333-8333-333333333333", "Lector 4", {
    portable: true,
    provider: "sumup",
  });

  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BARRA, [BARRA]),
        roleOf("card_terminal", chosen, [LECTOR_2, LECTOR_3, LECTOR_4]),
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
          const chosen = [LECTOR_2, LECTOR_3, LECTOR_4].find((each) => each.id === id)!;
          answers.push(() => resolve(readers(chosen)));
        }),
    );
    return { setDeviceEquipment, answers };
  }

  const row = (el: TillApp) =>
    inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment | null;
  const continueButton = (el: TillApp) => inDialog(el, "[data-pay-continue]")!;
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
      onPhone({ getDeviceEquipment: vi.fn().mockResolvedValue(readers(LECTOR_2)), ...overrides }),
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

  it("a reader pick saves through Equipment and holds Continuar until it is answered", async () => {
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

  it("two picks out at once hold Continuar until the second is answered", async () => {
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

  it("an NFC tap still out holds Continuar too", async () => {
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

  it("a tap queued, then a logout and a sign-in again, leaves Continuar enabled", async () => {
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

  it("a locked confirmation's Comprobar de nuevo is not held while an NFC tap is out", async () => {
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
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_2));
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

    reads[0]!(readers(LECTOR_2));
    await flush(el);
    answers[0]!();
    await flush(el);

    expect(reads).toHaveLength(2);
    expect(continueButton(el).disabled).toBe(true);
    expect(await savingNote(el)).toBe(t("pay_equipment.saving"));
    reads[1]!(readers(LECTOR_3));
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
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_2));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    getDeviceEquipment.mockImplementation(
      () => new Promise<DeviceEquipment>((resolve) => reads.push(resolve)),
    );

    await pickReader(el, "Lector 3");
    changes[0]!.fail({ status: 409, code: "device.equipment_held" });
    await flush(el);
    expect(reads).toHaveLength(1);
    (await nfcReader()).read(`waitron-equipment:reader:${LECTOR_4.id}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
    reads[0]!(readers(LECTOR_2));
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
    const getDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_2));
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
    reads[0]!(readers(LECTOR_2));
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

  it("a card's Cobrar is held while an equipment change is out, and enabled after", async () => {
    installNfc();
    const { setDeviceEquipment, answers } = heldPicks();
    const el = await phoneSheet({ setDeviceEquipment });
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    const cobrar = () => inDialog(el, "[data-pay-confirm]")!;
    expect(cobrar().disabled).toBe(false);

    (await nfcReader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledOnce());
    await flush(el);
    expect(cobrar().disabled).toBe(true);

    answers[0]!();
    await flush(el);
    expect(cobrar().disabled).toBe(false);
  });
});

describe("till-app: a pick from the sheet that fails", () => {
  const LECTOR_3 = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });
  const COCINA = equipmentItem("p2", "Cocina");
  const LECTOR_4 = equipmentItem("c45f83b1-3333-4333-8333-333333333333", "Lector 4", {
    portable: true,
    provider: "sumup",
  });

  function equipmentOf(reader: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BARRA, [BARRA, COCINA]),
        roleOf("card_terminal", reader, [LECTOR_2, LECTOR_3, LECTOR_4]),
      ],
    };
  }

  const row = (el: TillApp) =>
    inDialog(el, "till-pay-equipment") as unknown as TillPayEquipment | null;
  const continueButton = (el: TillApp) => inDialog(el, "[data-pay-continue]")!;
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
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(LECTOR_2)),
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
        .mockResolvedValueOnce(equipmentOf(LECTOR_3));
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
      .mockResolvedValueOnce(equipmentOf(LECTOR_3));
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
    const getDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(LECTOR_2));
    const el = await phoneSheet({ setDeviceEquipment, getDeviceEquipment });
    const readsBefore = getDeviceEquipment.mock.calls.length;
    getDeviceEquipment.mockResolvedValue(equipmentOf(LECTOR_4));

    await pick(el, "cardReaderId", "Lector 3");
    await flush(el);

    expect(getDeviceEquipment).toHaveBeenCalledTimes(readsBefore + 1);
    const reader = await field(el, "cardReaderId");
    expect(reader.value).toBe(LECTOR_4.id);
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
    answers[1]!.ok(equipmentOf(LECTOR_2));
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
        new Promise<DeviceEquipment>((resolve) => (answer = () => resolve(equipmentOf(LECTOR_3)))),
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
  const LECTOR_3 = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });

  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BARRA, [BARRA]),
        roleOf("card_terminal", chosen, [LECTOR_2, LECTOR_3]),
      ],
    };
  }

  const presented = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillPresentedPayDialog>("till-presented-pay-dialog");
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
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(LECTOR_2)),
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
      () => new Promise<DeviceEquipment>((resolve) => (answer = () => resolve(readers(LECTOR_3)))),
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

    vi.mocked(api.getDeviceEquipment).mockResolvedValue(readers(LECTOR_3));
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_3));
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
  const LECTOR_3 = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });
  const PORTABLE = equipmentItem(PRINTER_ID, "Portable printer", { portable: true });

  function equipmentOf(reader: EquipmentItem, printer: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", printer, [BARRA, PORTABLE]),
        roleOf("card_terminal", reader, [LECTOR_2, LECTOR_3]),
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
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(LECTOR_2, BARRA)),
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(LECTOR_3, BARRA));
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(LECTOR_3, BARRA));
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

  it("a reader's sticker still out holds Continuar", async () => {
    film(formatEquipmentCode("reader", READER_ID));
    let answer!: () => void;
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise<DeviceEquipment>(
          (resolve) => (answer = () => resolve(equipmentOf(LECTOR_3, BARRA))),
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(LECTOR_2, PORTABLE));
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOf(LECTOR_3, BARRA));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOf(LECTOR_2, BARRA)),
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
  const LECTOR_3 = equipmentItem(READER_ID, "Lector 3", { portable: true, provider: "sumup" });
  const pickedUp = (name: string) => t("equipment.picked_up").replace("{item}", name);

  function readers(chosen: EquipmentItem): DeviceEquipment {
    return {
      roles: [
        roleOf("receipt", BARRA, [BARRA]),
        roleOf("card_terminal", chosen, [LECTOR_2, LECTOR_3]),
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_3));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(LECTOR_2)),
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

  it("a tap on the confirmation step makes Cobrar send the tapped reader", async () => {
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
        roleOf("receipt", BARRA, [BARRA]),
        roleOf("payment_slip", chosen, [BARRA, PORTABLE]),
        roleOf("card_terminal", LECTOR_2, [LECTOR_2, LECTOR_3]),
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
    const setDeviceEquipment = vi.fn().mockResolvedValue(readers(LECTOR_3));
    const { el } = await mountApp(
      onPhone({
        getDeviceEquipment: vi.fn().mockResolvedValue(readers(LECTOR_2)),
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
    const presented = (el: TillApp) =>
      el.shadowRoot!.querySelector<TillPresentedPayDialog>("till-presented-pay-dialog");
    const { el, order } = await phoneSheet({
      getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
      collectOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    emit(presented(el)!, "presented-pay", { method: "cash", tendered: "150.00", guests: 4 });
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
   * the interval clock faked from just before the send. */
  async function pendingShare(getBillBalance = vi.fn(async () => ownIs("pending"))) {
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
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    await flush(el);
    getBillBalance.mockImplementation(async () => ownIs("pending"));
    const before = getBillBalance.mock.calls.length;
    return { el, order, reads: () => getBillBalance.mock.calls.length - before };
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
    expect(text(inDialog(el, "[data-pay-pending-manager]"))).toBe(
      t("bill_pay.card_pending_manager"),
    );
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
  async function settlingCard(getFiledTicket: ReturnType<typeof vi.fn>) {
    const getBillBalance = vi.fn(async () => balanceOf());
    const whole = { ...own, applied: "120.00" };
    const { el } = await mountApp(
      onPhone({
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
  const ticketView = (el: TillApp) => el.shadowRoot!.querySelector("till-ticket-view");

  it("a received card that settles the bill shows the ticket, as a card answered at once does", async () => {
    const getFiledTicket = vi.fn().mockResolvedValue(invoiceOf("120.00"));
    const el = await settlingCard(getFiledTicket);

    await tick(el);

    await vi.waitFor(() => expect(ticketView(el)).not.toBeNull());
    expect(dialog(el)).toBeNull();
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
  });

  it("a ticket that cannot be read leaves the sheet as it is, and the next tick tries again", async () => {
    const getFiledTicket = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(invoiceOf("120.00"));
    const el = await settlingCard(getFiledTicket);

    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
    expect(ticketView(el)).toBeNull();
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();

    await tick(el);
    await vi.waitFor(() => expect(ticketView(el)).not.toBeNull());
    expect(getFiledTicket).toHaveBeenCalledTimes(2);
  });

  it("a ticket read that fails after another tick has come is tried again, and the ticket then shows", async () => {
    let fail: () => void = () => {};
    const getFiledTicket = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (fail = () => reject(new TypeError("Failed to fetch")))),
      )
      .mockResolvedValue(invoiceOf("120.00"));
    const el = await settlingCard(getFiledTicket);
    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);
    await tick(el);
    expect(getFiledTicket).toHaveBeenCalledTimes(1);

    fail();
    await flush(el);
    expect(ticketView(el)).toBeNull();
    await tick(el);

    expect(getFiledTicket).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(ticketView(el)).not.toBeNull());
    expect(dialog(el)).toBeNull();
  });

  it("a ticket read answered after the sheet closed shows nothing", async () => {
    let answer: () => void = () => {};
    const getFiledTicket = vi.fn(
      () => new Promise((resolve) => (answer = () => resolve(invoiceOf("120.00")))),
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
});

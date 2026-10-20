import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import type { CapabilityFlag } from "./layout.js";
import type { AllocationPreview, BillPaymentRequest, TillApi } from "./api/client.js";
import {
  balanceOf,
  billOf,
  dialog,
  equipmentWith,
  LECTOR_2,
  flush,
  inDialog,
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

  it("a presented bill keeps today's pay card", async () => {
    const { el } = await mountApp(
      onPhone({ getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]) }),
    );
    const order = await openPhoneTable(el);

    expect(inOrder(order, "till-tender-pay")).not.toBeNull();
    expect(inOrder(order, "[data-pay-sheet]")).toBeNull();
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

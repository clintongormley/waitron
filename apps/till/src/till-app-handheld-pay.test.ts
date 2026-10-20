import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import type { CapabilityFlag } from "./layout.js";
import type {
  AllocationPreview,
  BillPaymentRequest,
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  TillApi,
} from "./api/client.js";
import type { TillPayEquipment } from "./widgets/pay-equipment.js";
import { FakeNdefReader, installNfc, READER_ID } from "../test/equipment-nfc.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  balanceOf,
  BARRA,
  billOf,
  dialog,
  emit,
  equipmentItem,
  equipmentWith,
  LECTOR_2,
  lock,
  roleOf,
  shell,
  tableOrder,
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

async function nfcReader(): Promise<FakeNdefReader> {
  await vi.waitFor(() => expect(FakeNdefReader.instances.at(-1)?.signal).toBeDefined());
  return FakeNdefReader.instances.at(-1)!;
}

import { expect, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import {
  adjustmentStubs,
  draftServer,
  servedMenus,
  type DraftServer,
} from "../src/widgets/test-helpers.js";
import { BARRA, LECTOR_2, roleOf } from "./pay-equipment-fixtures.js";
import type { TillApp } from "../src/till-app.js";
import { resized } from "../src/screens/till-table-order-screen.test-helpers.js";
import { currentLocale } from "../src/i18n/t.js";
import type { TillLockScreen } from "../src/screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "../src/screens/till-table-order-screen.js";
import type { TillFloorScreen } from "../src/screens/till-floor-screen.js";
import type { TillBillPayDialog } from "../src/widgets/bill-pay-dialog.js";
import type { FormFactor, CapabilityFlag } from "../src/layout.js";
import type {
  AllocationPreview,
  DeviceEquipment,
  EquipmentItem,
  BillBalance,
  BillPaymentResult,
  BillPaymentView,
  FloorZone,
  PartyBill,
  TabLine,
  TableParty,
  TableState,
  TillApi,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "../src/api/client.js";
import { deviceZonesFixture } from "./device-zones.js";

export { BARRA, LECTOR_2, equipmentItem, roleOf } from "./pay-equipment-fixtures.js";

/** A fresh draft server for each test, holding the bills the payment suites open. */
export function resetBillPayDrafts(): void {
  drafts = draftServer();
  drafts.bills.add("wo-5");
  drafts.bills.add("wo-9");
}

export async function discardUnsavedLeave(el: TillApp): Promise<void> {
  await flush(el);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await flush(el);
}

export const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

export function partyOf(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 4,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "120.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

export function mesa(partyOver: Partial<TableParty> = {}): TableState {
  return {
    id: "t4",
    label: "4",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 4,
    tabTotal: "120.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: partyOf(partyOver),
  };
}

export function billOf(over: Partial<PartyBill> = {}): PartyBill {
  return {
    workingOrderId: "wo-4",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status: "open",
    total: "120.00",
    outstanding: "120.00",
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

export function line(over: Partial<TabLine>): TabLine {
  return {
    stationId: null,
    movable: false,
    id: `line-${over.lineNo}`,
    groupId: null,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: "2026-09-30T19:00:00.000Z",
    firedAt: "2026-09-30T19:00:00.000Z",
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

// The owner's €120.00 bill: Paella, Chuletón, Ensalada, and two items a guest takes onto a bill of
// their own, Tarta and Vino, €30.00 between them.
export const paella = line({ lineNo: 1, name: "Paella", unitPriceGross: "40.00" });
export const chuleton = line({ lineNo: 2, name: "Chuletón", unitPriceGross: "35.00" });
export const ensalada = line({ lineNo: 3, name: "Ensalada", unitPriceGross: "15.00" });
export const tarta = line({ lineNo: 4, name: "Tarta", unitPriceGross: "12.00" });
export const vino = line({ lineNo: 5, name: "Vino", unitPriceGross: "18.00" });
export const bill120 = [paella, chuleton, ensalada, tarta, vino];

export function balanceOf(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "120.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "120.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

export function paymentOf(over: Partial<BillPaymentView> = {}): BillPaymentView {
  return {
    id: "pay-1",
    submissionId: "sub-1",
    kind: "contribution",
    shareOf: null,
    method: "cash",
    entry: null,
    applied: "50.00",
    tip: "0.00",
    tendered: "50.00",
    change: "0.00",
    state: "received",
    createdAt: "2026-09-30T20:00:00.000Z",
    receivedAt: "2026-09-30T20:00:00.000Z",
    lines: [],
    refunds: [],
    ...over,
  };
}

export function takenOf(
  payment: Partial<BillPaymentView>,
  balance: Partial<BillBalance>,
  invoice?: TillSaleResult,
): BillPaymentResult {
  return {
    outcome: "received",
    payment: paymentOf(payment),
    balance: balanceOf(balance),
    ...(invoice === undefined ? {} : { invoice }),
  };
}

export const cash = (applied: string, change: string, tip = "0.00"): AllocationPreview => ({
  kind: "allocated",
  choice: null,
  applied,
  tip,
  change,
  charged: null,
});

export const invoiceOf = (total: string): TillSaleResult => ({
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  orderLabel: "4",
  orderNumber: 7,
  invoiceNumber: "F-0007",
  issuedAt: "2026-09-30T20:30:00.000Z",
  total,
  vatBreakdown: [{ rate: "10", base: "27.27", tax: "2.73" }],
  lines: [{ descriptions: { "es-ES": "Tarta" }, quantity: "1", gross: "12.00" }],
  tender: { method: "cash", change: "0.00" },
  payments: [
    { method: "cash", amount: total, tip: "0.00", tendered: total, change: "0.00", refunds: [] },
  ],
  qr: "https://example.test/vf?nif=B1&num=F-0007&fecha=30-09-2026&total=30.00",
});

export const formFactor: FormFactor = "till";

export const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: true,
  formFactor: formFactor,
  capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

export const offers: ZoneOfferCatalogue = {
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
  context: {
    departmentName: "Restaurant",
    zoneId: zone.id,
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: null,
  menus: servedMenus([{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }], []),
  offers: [],
};

export let drafts: DraftServer;

export function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
    }),
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
    listZoneOffers: vi.fn().mockResolvedValue(offers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa()]),
    listZones: vi.fn().mockResolvedValue([zone]),
    getPartyBills: vi.fn().mockResolvedValue([billOf()]),
    getInvoiceDeliveryOptions: vi.fn().mockResolvedValue({ invoicePrinter: null }),
    getTabLines: vi.fn().mockResolvedValue({ lines: bill120, revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    recordSale: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    collectOrder: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    pay: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    getBillBalance: vi.fn().mockResolvedValue(balanceOf()),
    previewBillPayment: vi.fn().mockResolvedValue(cash("40.00", "10.00")),
    takeBillPayment: vi.fn(),
    reprint: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    ...overrides,
  } as unknown as TillApi;
}

export async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

export function emit(source: Element, type: string, detail?: unknown): void {
  if (
    type === "change-line" &&
    typeof detail === "object" &&
    detail !== null &&
    !Object.hasOwn(detail, "expectedEdit")
  ) {
    detail = { ...detail, expectedEdit: (source as TillTableOrderScreen).billEdit };
  }
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

export const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
export const money = (amount: string) => formatMoney(amount, currentLocale());
export const lock = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
export const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell")!;
export const floor = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen")!;
export const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
export const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillBillPayDialog>("till-bill-pay-dialog");
export const inDialog = (el: TillApp, selector: string) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string; disabled: boolean }>(
    selector,
  );
export const shownBalance = (el: TillApp) => ({
  total: text(inDialog(el, "[data-pay-total] dd")),
  received: text(inDialog(el, "[data-pay-received] dd")),
  reserved: text(inDialog(el, "[data-pay-reserved] dd")),
  outstanding: text(inDialog(el, "[data-pay-outstanding] dd")),
});
export const balanceShows = (
  total: string,
  received: string,
  outstanding: string,
  reserved = "0.00",
) => ({
  total: money(total),
  received: money(received),
  reserved: money(reserved),
  outstanding: money(outstanding),
});

export async function openTable(el: TillApp): Promise<TillTableOrderScreen> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el), "open-table", { tableId: "t4", seated: true });
  await flush(el);
  const order = tableOrder(el);
  order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await flush(el);
  return order;
}

export async function openDialog(el: TillApp, way: "items" | "contribution" | "share" | "rest") {
  const order = tableOrder(el);
  const selector = way === "rest" ? "[data-pay-rest]" : `[data-open-bill-pay="${way}"]`;
  order.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await flush(el);
}

export async function showBillFooter(order: TillTableOrderScreen): Promise<void> {
  await resized(order);
  const review = order.shadowRoot!.querySelector<HTMLElement>("[data-review-open]");
  if (review?.checkVisibility()) {
    await userEvent.click(review);
    await order.updateComplete;
  }
}

export async function type(el: TillApp, name: string, value: string): Promise<void> {
  const input = inDialog(el, `wt-input[name="${name}"]`)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await flush(el);
}

export async function press(el: TillApp, selector: string): Promise<void> {
  inDialog(el, selector)!.click();
  await flush(el);
}

/** A phone's equipment: `reader` chosen as its card reader (none when null), and Barra as its
 * receipt printer. */
export function equipmentWith(reader: EquipmentItem | null): DeviceEquipment {
  return {
    roles: [
      roleOf("receipt", BARRA, [BARRA]),
      roleOf("card_terminal", reader, reader === null ? [LECTOR_2] : [reader]),
    ],
  };
}

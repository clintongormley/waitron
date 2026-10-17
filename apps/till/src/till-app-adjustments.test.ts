import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CancellationRead } from "./api/line-cancel-types.js";
import type { TillCancelItemDialog } from "./widgets/cancel-item-dialog.js";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillAdjustmentDialog } from "./widgets/adjustment-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  AdjustmentCommand,
  AdjustmentPreview,
  AdjustmentReason,
  FloorZone,
  PartyBill,
  TabLine,
  TableParty,
  TableState,
  TillApi,
  ZoneOfferCatalogue,
} from "./api/client.js";

// The till's cancel, give-away and discount flow through the app: reasons, the preview, approval
// and the refusals (service plan Task 11, part B). The API is stubbed at the client boundary.

const zone: FloorZone = {
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

const party: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 3 },
  id: "v1",
  revision: 3,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "30.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const mesa4: TableState = {
  id: "t4",
  label: "4",
  zoneId: "z1",
  state: "open-tab",
  condition: "held",
  hasOpenTab: true,
  tabLineCount: 1,
  tabTotal: "30.00",
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  today: null,
  signals: [],
  party,
};

const bill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  hasPayments: false,
  receiptAvailable: false,
};

const wine: TabLine = {
  stationId: null,
  movable: false,
  id: "line-1",
  name: "Wine",
  groupId: null,
  lineNo: 1,
  productId: "vino",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "30.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-09-30T09:00:00.000Z",
  firedAt: "2026-09-30T09:00:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

const complaint: AdjustmentReason = {
  id: "r-complaint",
  name: "Complaint",
  actions: ["comp", "discount_percent"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "supervisor",
  approverRole: "manager",
};
const mistake: AdjustmentReason = {
  ...complaint,
  id: "r-mistake",
  name: "Mistake",
  actions: ["cancel"],
  noteRequired: true,
};

const formFactor: FormFactor = "till";

const till = {
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
  tipsEnabled: false,
  formFactor: formFactor,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
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
  menus: [],
  offers: [],
};

const preview = (over: Partial<AdjustmentPreview> = {}): AdjustmentPreview => ({
  reduction: "30.00",
  nominalValue: "30.00",
  needsApproval: null,
  overBillDiscountLimit: false,
  lines: [],
  ...over,
});

let drafts: DraftServer;
let api: TillApi;

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
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
    getTablesState: vi.fn().mockResolvedValue([mesa4]),
    listZones: vi.fn().mockResolvedValue([zone]),
    listStatuses: vi.fn().mockResolvedValue([]),
    getPartyBills: vi.fn().mockResolvedValue([bill]),
    getTabLines: vi.fn().mockResolvedValue({ lines: [wine], revision: 6, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    listAdjustmentReasons: vi.fn().mockResolvedValue([complaint, mistake]),
    listAdjustmentApprovers: vi.fn().mockResolvedValue([{ personId: "m-1", displayName: "Marta" }]),
    previewAdjustment: vi.fn().mockResolvedValue(preview()),
    applyAdjustment: vi
      .fn()
      .mockResolvedValue({ adjustmentIds: ["a-1"], revision: 7, party: { id: "v1", revision: 4 } }),
    ...overrides,
  } as unknown as TillApi;
}

function sessionActivityStub() {
  return {
    configure: vi.fn(),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}
async function mountApp(
  overrides: Record<string, unknown> = {},
  activity?: ReturnType<typeof sessionActivityStub>,
) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", {
    api,
    ...(activity ? { sessionActivity: activity as never } : {}),
  });
}
async function discardLeave(el: TillApp) {
  const warning = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => warning.open).toBe(false);
  await flush(el);
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell")!;
const floor = (el: TillApp) => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen")!;
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillAdjustmentDialog>("till-adjustment-dialog");
const approval = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>("till-supervisor-override-dialog");
const inDialog = (el: TillApp, selector: string) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;
const bottomMessage = (el: TillApp) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;

async function openMesa4(el: TillApp): Promise<TillTableOrderScreen> {
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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

async function press(el: TillApp, target: HTMLElement): Promise<void> {
  target.click();
  await flush(el);
}

async function chooseReason(el: TillApp, name: string): Promise<void> {
  const radio = [
    ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
  ].find((candidate) => candidate.closest("label")!.textContent!.trim() === name)!;
  await press(el, radio);
}

/** Opens Give away on the wine, chooses Complaint and presses Continue. */
async function previewComp(el: TillApp, order: TillTableOrderScreen): Promise<void> {
  await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
  await chooseReason(el, "Complaint");
  await press(el, inDialog(el, "[data-adjust-continue]"));
}

const ask = {
  expectedRevision: 6,
  lineId: "line-1",
  reasonId: "r-complaint",
  action: "comp",
  note: null,
};

const applied = () =>
  vi.mocked(api.applyAdjustment).mock.calls.map(([orderId, command]) => ({ orderId, command }));

async function pinPad(el: TillApp, digits: string): Promise<void> {
  const override = approval(el)!;
  override.shadowRoot!.querySelector<HTMLElement>('[data-person="m-1"]')!.click();
  await override.updateComplete;
  for (const digit of digits) {
    override
      .shadowRoot!.querySelector("till-numeric-pad")!
      .shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!
      .click();
    await override.updateComplete;
  }
  await press(el, override.shadowRoot!.querySelector<HTMLElement>(".authorize")!);
}

beforeEach(() => {
  setLocale("en");
  drafts = draftServer();
});
afterEach(cleanupWidgets);

describe("till-app: giving away a dish", () => {
  it("offers only the reasons that allow it, shows what comes off, then applies it and reads the bill again", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [wine], revision: 6, editSentLines: true })
      .mockResolvedValue({
        lines: [{ ...wine, unitPriceGross: "0.00", listUnitPriceGross: "30.00" }],
        revision: 7,
        editSentLines: true,
      });
    const { el } = await mountApp({ getTabLines });
    const order = await openMesa4(el);

    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    expect(api.listAdjustmentReasons).toHaveBeenCalledOnce();
    const names = [
      ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
    ].map((radio) => radio.closest("label")!.textContent!.trim());
    expect(names).toEqual(["Complaint"]);
    await chooseReason(el, "Complaint");
    await press(el, inDialog(el, "[data-adjust-continue]"));

    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", ask);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(inDialog(el, "[data-takes-off]").textContent!.trim()).toBe(
      t("adjust.takes_off").replace("{amount}", formatMoney("30.00", currentLocale())),
    );

    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-4", command: { ...ask, submissionId: expect.any(String) } },
    ]);
    expect(dialog(el)).toBeNull();
    expect(order.revision).toBe(7);
    expect(order.shadowRoot!.querySelector(".pending-line s")!.textContent).toBe(
      formatMoney("30.00", currentLocale()),
    );
    expect(banner(el)).toBeNull();
  });

  it("sends nothing when closed", async () => {
    const { el } = await mountApp();
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-back]"));
    await press(el, inDialog(el, "[data-adjust-close]"));
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    expect(question.open).toBe(true);
    expect(dialog(el)).not.toBeNull();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question.open).toBe(false);
    expect(
      dialog(el)!.shadowRoot!.querySelector<HTMLInputElement>('input[name="reason"]')!.checked,
    ).toBe(true);
    await press(el, inDialog(el, "[data-adjust-close]"));
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("says a manager must add a reason when none allows the action", async () => {
    const { el } = await mountApp({
      listAdjustmentReasons: vi.fn().mockResolvedValue([mistake]),
    });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    expect(inDialog(el, "[data-no-reasons]").textContent!.trim()).toBe(t("adjust.no_reasons"));
  });

  it("says so when the reasons cannot be read, and opens nothing", async () => {
    const { el } = await mountApp({
      listAdjustmentReasons: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("adjust.reasons_error"));
  });

  it("discounts the whole bill", async () => {
    const { el } = await mountApp();
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>("[data-discount-bill]")!);
    await chooseReason(el, "Complaint");
    const input = inDialog(el, 'wt-input[name="percent"]').shadowRoot!.querySelector("input")!;
    input.value = "10";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    await press(el, inDialog(el, "[data-adjust-continue]"));

    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", {
      expectedRevision: 6,
      lineId: null,
      reasonId: "r-complaint",
      action: "discount_percent",
      percentBp: 1000,
      note: null,
    });
  });
});

describe("till-app: an adjustment someone must approve", () => {
  it("asks the approver for their PIN and applies it under the waiter, who stays signed in", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    expect(inDialog(el, "[data-needs-approval]").textContent!.trim()).toBe(
      t("adjust.approval_manager"),
    );

    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith("manager");
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(approval(el)!.authorizers).toEqual([{ personId: "m-1", displayName: "Marta" }]);

    await pinPad(el, "7777");

    expect(applied()).toEqual([
      {
        orderId: "wo-4",
        command: {
          ...ask,
          submissionId: expect.any(String),
          approver: { personId: "m-1", pin: "7777" },
        },
      },
    ]);
    expect(approval(el)).toBeNull();
    expect(dialog(el)).toBeNull();
    // Still the waiter's session: not locked, not signed out, and the drawer override untouched.
    expect(lock(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("keeps the PIN prompt open after a wrong PIN, saying so", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "pin.invalid", status: 401 }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    await pinPad(el, "0000");

    expect(approval(el)).not.toBeNull();
    expect(approval(el)!.error).toBe("pin.invalid");
    expect(approval(el)!.shadowRoot!.querySelector(".error")!.textContent).toBe(t("pin.invalid"));
    expect(dialog(el)).not.toBeNull();
  });

  it("keeps the PIN prompt open after too many wrong PINs, saying to wait", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      applyAdjustment: vi.fn().mockRejectedValue({
        code: "pin.throttled",
        params: { retryAfterSeconds: 2 },
        status: 429,
      }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    await pinPad(el, "7777");

    expect(approval(el)).not.toBeNull();
    expect(approval(el)!.error).toBe("pin.throttled");
    expect(approval(el)!.shadowRoot!.querySelector(".error")!.textContent).toBe(t("pin.throttled"));
    expect(dialog(el)).not.toBeNull();
  });

  it("goes back to the confirm step when the approver prompt is cancelled", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    await press(el, approval(el)!.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
    await expect.poll(() => approval(el)).toBeNull();
    expect(inDialog(el, "[data-adjust-confirm]")).not.toBeNull();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });
});

describe("till-app: a bill changed on another device", () => {
  it("reads the bill again after a refused apply, says what changed, and sends nothing again", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [wine], revision: 6, editSentLines: true })
      .mockResolvedValue({
        lines: [{ ...wine, quantity: "2.000" }],
        revision: 8,
        editSentLines: true,
      });
    const { el } = await mountApp({
      getTabLines,
      applyAdjustment: vi.fn().mockRejectedValue({
        code: "working_order.out_of_date",
        workingOrderId: "wo-4",
        revision: 8,
        status: 409,
      }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    const reads = getTabLines.mock.calls.length;

    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(getTabLines.mock.calls.length).toBeGreaterThan(reads);
    expect(dialog(el)).toBeNull();
    expect(order.revision).toBe(8);
    expect(banner(el)!.textContent).toBe(t("adjust.changed_line").replace("{line}", "Wine"));

    // Acting again starts from the bill as it is now.
    await previewComp(el, order);
    expect(api.previewAdjustment).toHaveBeenLastCalledWith("wo-4", { ...ask, expectedRevision: 8 });
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
  });

  it("says a dish is gone when the bill read again no longer has it, after a refused preview", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [wine], revision: 6, editSentLines: true })
      .mockResolvedValue({ lines: [], revision: 8, editSentLines: true });
    const { el } = await mountApp({
      getTabLines,
      previewAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("adjust.changed_line_gone").replace("{line}", "Wine"));
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("says the bill changed when a whole-bill discount is refused as out of date", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>("[data-discount-bill]")!);
    await chooseReason(el, "Complaint");
    const input = inDialog(el, 'wt-input[name="percent"]').shadowRoot!.querySelector("input")!;
    input.value = "10";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    await press(el, inDialog(el, "[data-adjust-continue]"));
    expect(banner(el)!.textContent).toBe(t("adjust.changed_bill"));
  });
});

describe("till-app: an adjustment with no answer", () => {
  it("sends a request that got no answer again under the same submission id, and a new confirmation under a new one", async () => {
    const applyAdjustment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ adjustmentIds: ["a-1"], revision: 7, party: null });
    const { el } = await mountApp({ applyAdjustment });
    const order = await openMesa4(el);
    await previewComp(el, order);

    inDialog(el, "[data-adjust-confirm]").click();
    await vi.waitFor(() => expect(dialog(el)).toBeNull(), { timeout: 4000, interval: 50 });
    await flush(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    const ids = applyAdjustment.mock.calls.map(
      ([, command]) => (command as AdjustmentCommand).submissionId,
    );
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("reads the bill again and says the change may have been made when no answer ever comes", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ applyAdjustment });
    const order = await openMesa4(el);
    await previewComp(el, order);
    const reads = vi.mocked(api.getTabLines).mock.calls.length;

    inDialog(el, "[data-adjust-confirm]").click();
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toBe(t("adjust.unconfirmed")), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el);

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed"));
    expect(vi.mocked(api.getTabLines).mock.calls.length).toBeGreaterThan(reads);
  });
});

describe("till-app: a refused adjustment", () => {
  it("shows a refusal that names no field above the action, and the action stays usable", async () => {
    const { el } = await mountApp({
      applyAdjustment: vi.fn().mockRejectedValue({ code: "bill.line_paid", status: 409 }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(bottomMessage(el)).toBe(codeMessage("bill.line_paid"));
    expect(
      (inDialog(el, "[data-adjust-confirm]") as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false);
  });

  it("goes back to the form with a refusal naming a field under that field", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockRejectedValue({ code: "adjustment.over_limit", status: 409 }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);

    expect(
      dialog(el)!.shadowRoot!.querySelector('[data-error-for="reason"]')!.textContent!.trim(),
    ).toBe(codeMessage("adjustment.over_limit"));
    expect(bottomMessage(el)).toBe(t("form.fix_fields"));
  });

  it("reads the reasons again when the one chosen is no longer in use", async () => {
    const listAdjustmentReasons = vi
      .fn()
      .mockResolvedValueOnce([complaint, mistake])
      .mockResolvedValue([{ ...complaint, id: "r-other", name: "Guest recovery" }]);
    const { el } = await mountApp({
      listAdjustmentReasons,
      applyAdjustment: vi.fn().mockRejectedValue({ code: "adjustment.reason_inactive" }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(listAdjustmentReasons).toHaveBeenCalledTimes(2);
    expect(
      [...dialog(el)!.shadowRoot!.querySelectorAll('input[name="reason"]')].map((radio) =>
        radio.closest("label")!.textContent!.trim(),
      ),
    ).toEqual(["Guest recovery"]);
    expect(
      dialog(el)!.shadowRoot!.querySelector('[data-error-for="reason"]')!.textContent!.trim(),
    ).toBe(codeMessage("adjustment.reason_inactive"));
  });

  it("shows a preview that got no answer as a failure above the action", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    expect(bottomMessage(el)).toBe(codeMessage("server.internal"));
  });

  it("says so above the action when the approvers cannot be read", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      listAdjustmentApprovers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(approval(el)).toBeNull();
    expect(bottomMessage(el)).toBe(codeMessage("server.internal"));
  });

  it("closes the approver prompt and shows another refusal above the action", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      applyAdjustment: vi
        .fn()
        .mockRejectedValue({ code: "adjustment.approval_required", approverRole: "manager" }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    await pinPad(el, "7777");
    expect(approval(el)).toBeNull();
    expect(bottomMessage(el)).toBe(codeMessage("adjustment.approval_required"));
  });

  // An approver's PIN check answers only `pin.invalid` or `pin.throttled`; the apply route's own
  // `person.not_found` names the operator (`apps/server/src/adjustments-apply.ts`), not the approver.
  it.each(["person.not_found", "person.suspended"])(
    "closes the approver prompt on %s and shows the generic refusal above the action",
    async (code) => {
      const { el } = await mountApp({
        previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
        applyAdjustment: vi.fn().mockRejectedValue({ code, personId: "w-1", status: 404 }),
      });
      const order = await openMesa4(el);
      await previewComp(el, order);
      await press(el, inDialog(el, "[data-adjust-confirm]"));
      await pinPad(el, "7777");
      expect(approval(el)).toBeNull();
      expect(bottomMessage(el)).toBe(codeMessage("server.internal"));
    },
  );
});

describe("till-app: the adjustment flow and the operator's session", () => {
  it("closes the dialog when the till locks", async () => {
    const activity = sessionActivityStub();
    const { el } = await mountApp({}, activity);
    const order = await openMesa4(el);
    await previewComp(el, order);
    (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(dialog(el)).toBeNull();
  });
});

describe("till-app: answers that arrive after the flow moved on", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("reads the reasons once however often Give away is pressed while they load", async () => {
    const reasons = deferred<AdjustmentReason[]>();
    const { el } = await mountApp({ listAdjustmentReasons: vi.fn(() => reasons.promise) });
    const order = await openMesa4(el);
    const comp = order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!;
    await press(el, comp);
    await press(el, comp);
    reasons.resolve([complaint]);
    await flush(el);
    expect(api.listAdjustmentReasons).toHaveBeenCalledOnce();
    expect(dialog(el)).not.toBeNull();
  });

  it("opens nothing when the till locks while the reasons load", async () => {
    const reasons = deferred<AdjustmentReason[]>();
    const { el } = await mountApp({ listAdjustmentReasons: vi.fn(() => reasons.promise) });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    emit(tableOrder(el), "logout");
    await flush(el);
    reasons.resolve([complaint]);
    await flush(el);
    expect(dialog(el)).toBeNull();
  });

  it("sends one preview while one is out, and none of its answer reaches a closed dialog", async () => {
    const answer = deferred<AdjustmentPreview>();
    const { el } = await mountApp({ previewAdjustment: vi.fn(() => answer.promise) });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    await chooseReason(el, "Complaint");
    const choice = { action: "comp", reasonId: "r-complaint", note: null };
    emit(dialog(el)!, "adjust-preview", choice);
    emit(dialog(el)!, "adjust-preview", choice);
    await flush(el);
    expect(api.previewAdjustment).toHaveBeenCalledOnce();

    emit(dialog(el)!, "adjust-close");
    await flush(el);
    answer.resolve(preview());
    await flush(el);
    expect(dialog(el)).toBeNull();
  });

  it("says nothing of a refused preview once the dialog is closed", async () => {
    const answer = deferred<AdjustmentPreview>();
    const { el } = await mountApp({ previewAdjustment: vi.fn(() => answer.promise) });
    const order = await openMesa4(el);
    await previewComp(el, order);
    emit(dialog(el)!, "adjust-close");
    await flush(el);
    answer.reject({ code: "working_order.out_of_date" });
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("opens no PIN prompt when the approvers arrive after the dialog closed", async () => {
    const approvers = deferred<{ personId: string; displayName: string }[]>();
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      listAdjustmentApprovers: vi.fn(() => approvers.promise),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    emit(dialog(el)!, "adjust-close");
    await flush(el);
    approvers.resolve([{ personId: "m-1", displayName: "Marta" }]);
    await flush(el);
    expect(approval(el)).toBeNull();
  });

  it("sends one apply however often the approver authorizes while it is out", async () => {
    const answer = deferred<unknown>();
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      applyAdjustment: vi.fn(() => answer.promise),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    emit(approval(el)!, "override-confirm", { personId: "m-1", pin: "7777" });
    emit(approval(el)!, "override-confirm", { personId: "m-1", pin: "7777" });
    await flush(el);
    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    answer.resolve({ adjustmentIds: ["a-1"], revision: 7, party: null });
    await flush(el);
    expect(dialog(el)).toBeNull();
  });

  it("changes nothing on screen when an apply is answered after the till locked", async () => {
    for (const outcome of ["applied", "refused"] as const) {
      const answer = deferred<unknown>();
      const activity = sessionActivityStub();
      const { el } = await mountApp({ applyAdjustment: vi.fn(() => answer.promise) }, activity);
      const order = await openMesa4(el);
      await previewComp(el, order);
      await press(el, inDialog(el, "[data-adjust-confirm]"));
      (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
      const reads = vi.mocked(api.getTabLines).mock.calls.length;
      if (outcome === "applied")
        answer.resolve({ adjustmentIds: ["a-1"], revision: 7, party: null });
      else answer.reject({ code: "bill.line_paid" });
      await flush(el);
      expect(dialog(el)).toBeNull();
      expect(banner(el)).toBeNull();
      expect(vi.mocked(api.getTabLines).mock.calls.length).toBe(reads);
      cleanupWidgets();
    }
  });

  it("closes the cancel dialog when a finish pressed before it answers and the till leaves the table", async () => {
    const finished = deferred<void>();
    const { el } = await mountApp({ finishTable: vi.fn(() => finished.promise) });
    const order = await openMesa4(el);
    emit(order, "finish-table");
    await flush(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-cancel-line="1"]')!);
    expect(dialog(el)!.kind).toBe("cancel");

    finished.resolve();
    await flush(el);

    expect(tableOrder(el)).toBeNull();
    expect(dialog(el)).toBeNull();
  });

  it("closes a dialog whose apply is out when the till leaves the table, and that apply's answer closes no dialog opened after", async () => {
    const finished = deferred<void>();
    const answer = deferred<unknown>();
    const { el } = await mountApp({
      finishTable: vi.fn(() => finished.promise),
      applyAdjustment: vi.fn(() => answer.promise),
    });
    const order = await openMesa4(el);
    emit(order, "finish-table");
    await flush(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    finished.resolve();
    await flush(el);
    expect(dialog(el)).toBeNull();

    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const reopened = tableOrder(el);
    await press(el, reopened.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!);
    await press(el, reopened.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    answer.resolve({ adjustmentIds: ["a-1"], revision: 7, party: null });
    await flush(el);

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(dialog(el)!.kind).toBe("comp");
  });

  it(
    "reads the floor again when an apply out as the till leaves the table never gets an answer",
    { timeout: 10_000 },
    async () => {
      const answer = deferred<unknown>();
      const landed: TableState = {
        ...mesa4,
        tabTotal: "0.00",
        party: { ...party, revision: 5, outstanding: "0.00" },
      };
      const applyAdjustment = vi
        .fn()
        .mockImplementationOnce(() => answer.promise)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockImplementationOnce(async () => {
          vi.mocked(api.getTablesState).mockResolvedValue([landed]);
          throw new TypeError("Failed to fetch");
        });
      const { el } = await mountApp({ applyAdjustment });
      const order = await openMesa4(el);
      await previewComp(el, order);
      await press(el, inDialog(el, "[data-adjust-confirm]"));
      emit(order, "back-to-floor");
      await discardLeave(el);
      expect(dialog(el)).toBeNull();

      answer.reject(new TypeError("Failed to fetch"));
      // The resends wait real time; the poll returns once the floor is read after the last one.
      await vi.waitFor(() => expect(floor(el).tables).toEqual([landed]), { timeout: 5_000 });

      expect(applyAdjustment).toHaveBeenCalledTimes(3);
      expect(banner(el)).toBeNull();
    },
  );

  it("says the bill changed when the dish it named is as it was", async () => {
    const { el } = await mountApp({
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(banner(el)!.textContent).toBe(t("adjust.changed_bill"));
  });
});

describe("till-app: what is confirmed is what was previewed (review fix I1)", () => {
  it("applies and shows the choice the preview was asked for, even after a field is pressed while it was out", async () => {
    let answer!: (value: AdjustmentPreview) => void;
    const steaks: TabLine = { ...wine, name: "Steak", quantity: "2.000", unitPriceGross: "25.00" };
    const { el } = await mountApp({
      getTabLines: vi.fn().mockResolvedValue({ lines: [steaks], revision: 6, editSentLines: true }),
      previewAdjustment: vi.fn(
        () => new Promise<AdjustmentPreview>((resolve) => (answer = resolve)),
      ),
    });
    const order = await openMesa4(el);
    await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
    await chooseReason(el, "Complaint");
    await press(el, inDialog(el, 'input[name="quantity"][value="1"]'));
    await press(el, inDialog(el, "[data-adjust-continue]"));

    // Pressed while the preview is out: it must change nothing that is confirmed.
    await press(el, inDialog(el, 'input[name="quantity"][value="all"]'));
    answer(preview({ reduction: "25.00" }));
    await flush(el);

    expect(inDialog(el, "[data-quantity-shown]").textContent!.trim()).toBe(
      t("adjust.quantity_shown").replace("{n}", "2"),
    );
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(applied()).toEqual([
      {
        orderId: "wo-4",
        command: { ...ask, quantity: "1", submissionId: expect.any(String) },
      },
    ]);
  });

  it("names the role that must approve in the PIN prompt", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
    });
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(
      approval(el)!.shadowRoot!.querySelector<HTMLElement & { heading: string }>("wt-dialog")!
        .heading,
    ).toBe(t("approval.title_manager"));
  });
});

describe("till-app: cancelling a dish", () => {
  /** Chooses Mistake, whose note is required, types one and presses Continue. */
  async function previewCancel(el: TillApp): Promise<void> {
    await chooseReason(el, "Mistake");
    const note = inDialog(el, 'wt-input[name="note"]').shadowRoot!.querySelector("input")!;
    note.value = "wrong table";
    note.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    await press(el, inDialog(el, "[data-adjust-continue]"));
  }
  const cancelButton = (order: TillTableOrderScreen, lineNo: number) =>
    order.shadowRoot!.querySelector<HTMLElement>(`[data-cancel-line="${lineNo}"]`)!;
  const cancelAsk = {
    expectedRevision: 6,
    lineId: "line-1",
    reasonId: "r-mistake",
    action: "cancel",
    note: "wrong table",
  };

  it("asks for a reason that allows a cancel, records the cancel, then reads the bill, its party and what it owes again", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [wine], revision: 6, editSentLines: true })
      .mockResolvedValue({ lines: [], revision: 7, editSentLines: true });
    const { el } = await mountApp({ getTabLines });
    const order = await openMesa4(el);
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    await press(el, cancelButton(order, 1));
    expect(dialog(el)!.kind).toBe("cancel");
    expect(dialog(el)!.shadowRoot!.textContent).toContain(t("table.cancel_sent"));
    const names = [
      ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
    ].map((radio) => radio.closest("label")!.textContent!.trim());
    expect(names).toEqual(["Mistake"]);
    await previewCancel(el);
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", cancelAsk);
    expect(api.applyAdjustment).not.toHaveBeenCalled();

    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-4", command: { ...cancelAsk, submissionId: expect.any(String) } },
    ]);
    expect(dialog(el)).toBeNull();
    expect(order.revision).toBe(7);
    expect(order.shadowRoot!.querySelector('[data-cancel-line="1"]')).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    expect(vi.mocked(api.getTablesState).mock.calls.length).toBeGreaterThan(floorReads);
    expect(banner(el)).toBeNull();
  });

  it("shows the bill paid once a cancel leaves nothing to pay on it", async () => {
    const server = { cancelled: false };
    const { el } = await mountApp({
      getTabLines: vi.fn(async () => ({
        lines: server.cancelled ? [] : [wine],
        revision: server.cancelled ? 7 : 6,
        editSentLines: true,
      })),
      getPartyBills: vi.fn(async () => [
        server.cancelled
          ? { ...bill, status: "settled", total: "0.00", outstanding: "0.00" }
          : bill,
      ]),
      applyAdjustment: vi.fn(async () => {
        server.cancelled = true;
        return { adjustmentIds: ["a-1"], revision: 7, party: { id: "v1", revision: 4 } };
      }),
    });
    const order = await openMesa4(el);

    await press(el, cancelButton(order, 1));
    await previewCancel(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(tableOrder(el).bills.map((shown) => shown.status)).toEqual(["settled"]);
  });

  it("sends nothing when the cancel dialog is closed", async () => {
    const { el } = await mountApp();
    const order = await openMesa4(el);
    await press(el, cancelButton(order, 1));
    await press(el, inDialog(el, "[data-adjust-close]"));
    await expect.poll(() => dialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(api.previewAdjustment).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("cancels with a reason shaped like the provisioned default: no note sent, and no PIN when the preview needs none", async () => {
    // Shaped as apps/server/src/default-cancel-reason.test.ts pins the provisioned default.
    const defaultReason: AdjustmentReason = {
      id: "r-default",
      name: "Entry error",
      actions: ["cancel"],
      noteRequired: false,
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "staff",
      approverRole: "supervisor",
    };
    const { el } = await mountApp({
      listAdjustmentReasons: vi.fn().mockResolvedValue([defaultReason]),
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: null })),
    });
    const order = await openMesa4(el);

    await press(el, cancelButton(order, 1));
    const names = [
      ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
    ].map((radio) => radio.closest("label")!.textContent!.trim());
    expect(names).toEqual(["Entry error"]);
    await chooseReason(el, "Entry error");
    await press(el, inDialog(el, "[data-adjust-continue]"));
    const defaultAsk = { ...cancelAsk, reasonId: "r-default", note: null };
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", defaultAsk);
    expect(dialog(el)!.shadowRoot!.querySelector("[data-needs-approval]")).toBeNull();

    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-4", command: { ...defaultAsk, submissionId: expect.any(String) } },
    ]);
    expect(api.listAdjustmentApprovers).not.toHaveBeenCalled();
    expect(approval(el)).toBeNull();
    expect(dialog(el)).toBeNull();
  });

  describe("a dish of two, with an extra on each", () => {
    const pair: TabLine = { ...wine, quantity: "2.000", unitPriceGross: "15.00" };
    const extra: TabLine = {
      ...wine,
      id: "line-2",
      lineNo: 2,
      name: "Cheese",
      parentLineNo: 1,
      quantity: "2.000",
      unitPrecision: null,
      unitPriceGross: "1.00",
      state: null,
    };
    const mountPair = () =>
      mountApp({
        getTabLines: vi
          .fn()
          .mockResolvedValue({ lines: [pair, extra], revision: 6, editSentLines: true }),
      });

    it("cancels one of them when One is chosen", async () => {
      const { el } = await mountPair();
      const order = await openMesa4(el);
      await press(el, cancelButton(order, 1));
      await press(el, inDialog(el, 'input[name="quantity"][value="1"]'));
      await previewCancel(el);
      await press(el, inDialog(el, "[data-adjust-confirm]"));

      expect(applied()).toEqual([
        {
          orderId: "wo-4",
          command: { ...cancelAsk, quantity: "1", submissionId: expect.any(String) },
        },
      ]);
    });

    it("gives away one of them, then shows the one given away with its own extra under it", async () => {
      const getTabLines = vi
        .fn()
        .mockResolvedValueOnce({ lines: [pair, extra], revision: 6, editSentLines: true })
        .mockResolvedValue({
          // As the server lists it once split: the part given away and its extra numbered last.
          lines: [
            { ...pair, quantity: "1.000" },
            { ...extra, quantity: "1.000" },
            {
              ...pair,
              id: "line-3",
              lineNo: 3,
              quantity: "1.000",
              unitPriceGross: "0.00",
              listUnitPriceGross: "15.00",
            },
            {
              ...extra,
              id: "line-4",
              lineNo: 4,
              parentLineNo: 3,
              quantity: "1.000",
              unitPriceGross: "0.00",
              listUnitPriceGross: "1.00",
            },
          ],
          revision: 7,
          editSentLines: true,
        });
      const { el } = await mountApp({ getTabLines });
      const order = await openMesa4(el);
      await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="1"]')!);
      await chooseReason(el, "Complaint");
      await press(el, inDialog(el, 'input[name="quantity"][value="1"]'));
      await press(el, inDialog(el, "[data-adjust-continue]"));
      await press(el, inDialog(el, "[data-adjust-confirm]"));

      expect(applied()).toEqual([
        {
          orderId: "wo-4",
          command: { ...ask, quantity: "1", submissionId: expect.any(String) },
        },
      ]);
      const rows = [...order.shadowRoot!.querySelectorAll(".pending-line")];
      expect(rows.map((row) => row.classList.contains("child-line"))).toEqual([
        false,
        true,
        false,
        true,
      ]);
      expect(rows[3]!.querySelector("[data-comp-line]")!.getAttribute("aria-label")).toBe(
        `${t("table.comp_line")} · Cheese (with Wine)`,
      );
      expect(rows[3]!.querySelector(".line-total s")!.textContent).toBe(
        formatMoney("1.00", currentLocale()),
      );
      expect(rows[1]!.querySelector(".line-total s")).toBeNull();
    });

    it("cancels an extra of a dish being made as coming off the bill with the kitchen told, not as binned", async () => {
      const { el } = await mountApp({
        getTabLines: vi.fn().mockResolvedValue({
          lines: [{ ...pair, state: "preparing" }, extra],
          revision: 6,
          editSentLines: true,
        }),
      });
      const order = await openMesa4(el);
      await press(el, cancelButton(order, 2));
      const shown = dialog(el)!.shadowRoot!.textContent!;
      expect(shown).toContain(t("table.cancel_extra_told"));
      expect(shown).not.toContain(t("table.cancel_started"));
    });

    it("gives away an extra on its own, sending no quantity", async () => {
      const { el } = await mountPair();
      const order = await openMesa4(el);
      await press(el, order.shadowRoot!.querySelector<HTMLElement>('[data-comp-line="2"]')!);
      expect(dialog(el)!.shadowRoot!.querySelector("[data-quantity]")).toBeNull();
      await chooseReason(el, "Complaint");
      await press(el, inDialog(el, "[data-adjust-continue]"));
      await press(el, inDialog(el, "[data-adjust-confirm]"));

      expect(applied()).toEqual([
        {
          orderId: "wo-4",
          command: { ...ask, lineId: "line-2", submissionId: expect.any(String) },
        },
      ]);
    });

    it("cancels both, sending no quantity, when All is left chosen", async () => {
      const { el } = await mountPair();
      const order = await openMesa4(el);
      await press(el, cancelButton(order, 1));
      await previewCancel(el);
      await press(el, inDialog(el, "[data-adjust-confirm]"));

      expect(applied()).toEqual([
        { orderId: "wo-4", command: { ...cancelAsk, submissionId: expect.any(String) } },
      ]);
    });
  });

  it("asks the manager for their PIN when the reason needs approval, and cancels under it", async () => {
    const { el } = await mountApp({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
    });
    const order = await openMesa4(el);
    await press(el, cancelButton(order, 1));
    await previewCancel(el);
    expect(inDialog(el, "[data-needs-approval]").textContent!.trim()).toBe(
      t("adjust.approval_manager"),
    );

    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith("manager");
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    await pinPad(el, "7777");

    expect(applied()).toEqual([
      {
        orderId: "wo-4",
        command: {
          ...cancelAsk,
          submissionId: expect.any(String),
          approver: { personId: "m-1", pin: "7777" },
        },
      },
    ]);
    expect(dialog(el)).toBeNull();
  });
});

describe("till-app: a box update while an adjustment still waits for the server", () => {
  it("shows the bar instead of reloading after an idle sign-out", async () => {
    const applyAdjustment = vi.fn(() => new Promise(() => {}));
    const activity = sessionActivityStub();
    const { el } = await mountApp({ applyAdjustment }, activity);
    const reload = vi.fn();
    el.reload = reload;
    const order = await openMesa4(el);
    await previewComp(el, order);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(applyAdjustment).toHaveBeenCalledOnce();

    (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
    await flush(el);
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);

    expect(reload).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-banner[data-test=update-bar]")).not.toBeNull();
  });
});

describe("till-app: service cancellation consent", () => {
  const consent = (
    status: CancellationRead["context"]["billStatus"] = "open",
    stage: CancellationRead["context"]["stage"] = "started",
  ): CancellationRead => ({
    billId: "wo-4",
    revision: 3,
    billRevision: 6,
    context: {
      billStatus: status,
      stage,
      components: [
        {
          id: "kitchen-1",
          lineId: "line-1",
          state: stage === "started" ? "preparing" : "queued",
          firedAt: "2026-10-17T10:00:00Z",
          quantity: "1.000",
          kitchenQuantity: "1.000",
          servedQuantity: "0.000",
          cancelledQuantity: "0.000",
        },
      ],
    },
  });
  const cancelDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillCancelItemDialog>("till-cancel-item-dialog");
  async function openCancel(el: TillApp) {
    emit(tableOrder(el), "cancel-item", { lineId: "line-1" });
    await flush(el);
  }
  async function clickChoice(el: TillApp, selector: string) {
    const widget = cancelDialog(el)!;
    await widget.updateComplete;
    await userEvent.click(
      page.elementLocator(widget.shadowRoot!.querySelector<HTMLElement>(selector)!),
    );
    await flush(el);
  }
  const apiFor = (read: CancellationRead = consent(), more: Record<string, unknown> = {}) => ({
    getCancellation: vi.fn().mockResolvedValue(read),
    cancelItem: vi.fn().mockResolvedValue({ revision: 4 }),
    ...more,
  });

  it("reads the kitchen facts before opening and sends the exact explicit keep-charge consent", async () => {
    const read = consent();
    const methods = apiFor(read);
    const { el } = await mountApp(methods);
    const order = await openMesa4(el);
    await openCancel(el);
    expect(methods.getCancellation).toHaveBeenCalledWith("v1", "line-1", expect.any(Object));
    expect(cancelDialog(el)?.name).toBe("Wine");
    expect(cancelDialog(el)?.consent).toEqual(read);
    expect(methods.cancelItem).not.toHaveBeenCalled();
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(methods.cancelItem).toHaveBeenCalledWith(
      "v1",
      "line-1",
      {
        quantity: "1",
        outcome: "keep_charge",
        expectedPartyRevision: 3,
        expectedBillRevision: 6,
        expectedContext: read.context,
        submissionId: expect.any(String),
      },
      expect.any(Object),
    );
    expect(cancelDialog(el)).toBeNull();
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(api.getTabLines).toHaveBeenCalledTimes(2);
    expect(order.lines[0]!.unitPriceGross).toBe("30.00");
  });

  it("refreshes a raced kitchen context and requires a new explicit choice", async () => {
    const fresh = consent("settled");
    const methods = apiFor(consent(), {
      getCancellation: vi.fn().mockResolvedValueOnce(consent()).mockResolvedValue(fresh),
      cancelItem: vi
        .fn()
        .mockRejectedValueOnce({ code: "tab.cancel_context_changed" })
        .mockResolvedValue({ revision: 4 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)?.consent).toEqual(fresh);
    expect(methods.cancelItem).toHaveBeenCalledTimes(1);
    const widget = cancelDialog(el)!;
    expect(
      widget.shadowRoot!.querySelector<HTMLInputElement>('input[value="keep_charge"]')!.checked,
    ).toBe(false);
    expect(
      widget.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!
        .disabled,
    ).toBe(true);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(methods.cancelItem).toHaveBeenCalledTimes(2);
    expect(methods.cancelItem.mock.calls[1]![2]).toMatchObject({ expectedContext: fresh.context });
  });

  it("drops a context read after leaving the bill and allows a later opening", async () => {
    let answer!: (value: CancellationRead) => void;
    const methods = apiFor(consent(), {
      getCancellation: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<CancellationRead>((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue(consent()),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    answer(consent());
    await flush(el);
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem).not.toHaveBeenCalled();
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await openCancel(el);
    expect(cancelDialog(el)?.name).toBe("Wine");
  });

  it("retains a refusal beside an enabled retry and makes no financial adjustment", async () => {
    const methods = apiFor(consent(), {
      cancelItem: vi
        .fn()
        .mockRejectedValueOnce({ code: "permission.denied" })
        .mockResolvedValue({ revision: 4 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)?.refusal).toBe(codeMessage("permission.denied"));
    expect(
      cancelDialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-confirm]",
      )!.disabled,
    ).toBe(false);
    await clickChoice(el, "[data-confirm]");
    expect(methods.cancelItem).toHaveBeenCalledTimes(2);
    expect(cancelDialog(el)).toBeNull();
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  async function removeCharge(el: TillApp) {
    await clickChoice(el, "[data-confirm]");
    expect(dialog(el)?.kind).toBe("cancel");
    await chooseReason(el, "Mistake");
    const note = inDialog(el, 'wt-input[name="note"]').shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(note), "Wrong dish");
    await flush(el);
    await press(el, inDialog(el, "[data-adjust-continue]"));
  }

  it("removes the charge through the existing reason and note preview but confirms against the kitchen facts", async () => {
    const read = consent("open", "not_started");
    const methods = apiFor(read);
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await removeCharge(el);
    expect(cancelDialog(el)).toBeNull();
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-4", {
      expectedRevision: 6,
      lineId: "line-1",
      action: "cancel",
      reasonId: "r-mistake",
      note: "Wrong dish",
      quantity: "1",
    });
    expect(methods.cancelItem).not.toHaveBeenCalled();
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(methods.cancelItem).toHaveBeenCalledWith(
      "v1",
      "line-1",
      {
        quantity: "1",
        outcome: "remove_charge",
        expectedPartyRevision: 3,
        expectedBillRevision: 6,
        expectedContext: read.context,
        submissionId: expect.any(String),
        reasonId: "r-mistake",
        note: "Wrong dish",
      },
      expect.any(Object),
    );
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
  });

  it("keeps the existing manager PIN retry when off-bill cancellation needs approval", async () => {
    const methods = apiFor(consent("open", "not_started"), {
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
      cancelItem: vi
        .fn()
        .mockRejectedValueOnce({ code: "pin.invalid" })
        .mockResolvedValue({ revision: 4 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await removeCharge(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(approval(el)?.authorizers).toEqual([{ personId: "m-1", displayName: "Marta" }]);
    await pinPad(el, "1234");
    expect(approval(el)?.error).toBe("pin.invalid");
    expect(dialog(el)).not.toBeNull();
    const retry = approval(el)!;
    for (const digit of "5678") {
      await userEvent.click(
        page.elementLocator(
          retry
            .shadowRoot!.querySelector("till-numeric-pad")!
            .shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!,
        ),
      );
      await retry.updateComplete;
    }
    await press(el, retry.shadowRoot!.querySelector<HTMLElement>(".authorize")!);
    expect(methods.cancelItem).toHaveBeenCalledTimes(2);
    expect(methods.cancelItem.mock.calls[1]![2]).toMatchObject({
      approver: { personId: "m-1", pin: "5678" },
    });
    expect(approval(el)).toBeNull();
    expect(dialog(el)).toBeNull();
    expect(lock(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("returns a raced pre-start remove confirmation to the refreshed explicit money choices", async () => {
    const fresh = consent();
    const methods = apiFor(consent("open", "not_started"), {
      getCancellation: vi
        .fn()
        .mockResolvedValueOnce(consent("open", "not_started"))
        .mockResolvedValue(fresh),
      cancelItem: vi.fn().mockRejectedValue({ code: "tab.cancel_context_changed" }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await removeCharge(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();
    expect(cancelDialog(el)?.consent).toEqual(fresh);
    expect(
      cancelDialog(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-confirm]",
      )!.disabled,
    ).toBe(true);
    expect(methods.cancelItem).toHaveBeenCalledTimes(1);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("reads a paid bill's dish from Current orders even when the open-only bill line read is empty", async () => {
    const methods = apiFor(consent("settled"), {
      getPartyBills: vi
        .fn()
        .mockResolvedValue([
          { ...bill, status: "settled", outstanding: "0.00", hasPayments: true },
        ]),
      getTabLines: vi.fn().mockRejectedValue({ code: "working_order.not_open" }),
      readCurrentOrders: vi.fn().mockResolvedValue({
        revision: 3,
        hasGroups: false,
        nextDisplayNumber: 1,
        retainedCourses: [],
        reminder: null,
        groups: [],
        ungrouped: [
          {
            lineId: "line-1",
            workingOrderId: "wo-4",
            lineNo: 1,
            name: "Recorded wine",
            quantity: "1.000",
            unitPrecision: 0,
            courseId: null,
            servedQuantity: "0.000",
            servedAt: null,
            released: true,
            kitchen: null,
            note: null,
            extras: [],
          },
        ],
      }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    expect(cancelDialog(el)?.name).toBe("Recorded wine");
    expect(cancelDialog(el)?.consent?.context.billStatus).toBe("settled");
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem.mock.calls[0]![2]).toMatchObject({
      outcome: "keep_charge",
      expectedContext: { billStatus: "settled" },
    });
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("a successful keep closes before a failed refresh and never offers another confirmation", async () => {
    const methods = apiFor();
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    vi.mocked(api.getPartyBills).mockRejectedValue({ code: "server.internal" });
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)).toBeNull();
    expect(banner(el)?.textContent).toContain(t("table.reread_failed"));
    expect(methods.cancelItem).toHaveBeenCalledOnce();
  });

  it("never revives the old confirmation after disconnect and reconnect", async () => {
    const methods = apiFor();
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    const parent = el.parentElement!;
    el.remove();
    parent.append(el);
    await flush(el);
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem).not.toHaveBeenCalled();
  });

  it("does not open an adjustment behind the active cancellation chooser", async () => {
    const { el } = await mountApp(apiFor());
    await openMesa4(el);
    await openCancel(el);
    emit(tableOrder(el), "adjust", {
      kind: "discount",
      target: {
        lineId: "line-1",
        name: "Wine",
        quantity: "1",
        total: "30.00",
        unitTotal: null,
      },
    });
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    expect(cancelDialog(el)?.name).toBe("Wine");
  });

  it("keeps duplicate clicks inert while the service request waits", async () => {
    let answer!: (value: { revision: number }) => void;
    const methods = apiFor(consent(), {
      cancelItem: vi.fn().mockImplementation(
        () =>
          new Promise<{ revision: number }>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    const widget = cancelDialog(el)!;
    expect(widget.busy).toBe(true);
    widget.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    emit(widget, "cancel-item-choice", {
      lineId: "line-1",
      quantity: "1",
      outcome: "keep_charge",
      consent: consent(),
    });
    await flush(el);
    expect(methods.cancelItem).toHaveBeenCalledOnce();
    answer({ revision: 4 });
    await flush(el);
    expect(cancelDialog(el)).toBeNull();
  });

  it("resends a lost answer with exactly the same kitchen consent and submission identity", async () => {
    const methods = apiFor(consent(), {
      cancelItem: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue({ revision: 4 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    await expect.poll(() => cancelDialog(el), { timeout: 4000 }).toBeNull();
    expect(methods.cancelItem).toHaveBeenCalledTimes(2);
    expect(methods.cancelItem.mock.calls[1]![2]).toEqual(methods.cancelItem.mock.calls[0]![2]);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("closes an unanswered service cancellation and asks the operator to check the reread bill", async () => {
    const methods = apiFor(consent(), {
      cancelItem: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    await expect
      .poll(() => banner(el)?.textContent, { timeout: 4000 })
      .toBe(t("adjust.unconfirmed"));
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem).toHaveBeenCalledTimes(3);
    const commands = methods.cancelItem.mock.calls.map((call) => call[2]);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[2]).toEqual(commands[0]);
    expect(api.getTabLines).toHaveBeenCalledTimes(2);
  });

  it("a context-refresh failure closes the stale choices and reports the changed dish", async () => {
    const methods = apiFor(consent(), {
      getCancellation: vi
        .fn()
        .mockResolvedValueOnce(consent())
        .mockRejectedValue({ code: "server.internal" }),
      cancelItem: vi.fn().mockRejectedValue({ code: "tab.cancel_context_changed" }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)).toBeNull();
    expect(banner(el)?.textContent).toBe(
      "The dish changed. Check its current kitchen state and choose again.",
    );
    expect(methods.cancelItem).toHaveBeenCalledOnce();
  });

  it("never applies a pending read to a replacement API, and can read again", async () => {
    let answer!: (value: CancellationRead) => void;
    const oldRead = vi.fn().mockImplementation(
      () =>
        new Promise<CancellationRead>((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountApp(apiFor(consent(), { getCancellation: oldRead }));
    await openMesa4(el);
    await openCancel(el);
    const replacement = stubApi(apiFor());
    el.api = replacement;
    await flush(el);
    answer(consent());
    await flush(el);
    expect(cancelDialog(el)).toBeNull();
    await openCancel(el);
    expect(cancelDialog(el)?.name).toBe("Wine");
  });

  it("drops a successful old request after leaving and reopening the same bill", async () => {
    let answer!: (value: { revision: number }) => void;
    const methods = apiFor(consent(), {
      cancelItem: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ revision: number }>((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValue({ revision: 5 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, 'input[value="keep_charge"]');
    await clickChoice(el, "[data-confirm]");
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await openCancel(el);
    const later = cancelDialog(el);
    expect(later).not.toBeNull();
    answer({ revision: 4 });
    await flush(el);
    expect(cancelDialog(el)).toBe(later);
    expect(cancelDialog(el)?.busy).toBe(false);
    expect(methods.cancelItem).toHaveBeenCalledOnce();
  });

  it("does not admit a second opening while its context read waits", async () => {
    let answer!: (value: CancellationRead) => void;
    const methods = apiFor(consent(), {
      getCancellation: vi.fn().mockImplementation(
        () =>
          new Promise<CancellationRead>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await openCancel(el);
    expect(methods.getCancellation).toHaveBeenCalledOnce();
    expect(cancelDialog(el)).toBeNull();
    answer(consent());
    await flush(el);
    expect(cancelDialog(el)?.name).toBe("Wine");
  });

  it("reports a refused context read and lets the next press read again", async () => {
    const methods = apiFor(consent(), {
      getCancellation: vi
        .fn()
        .mockRejectedValueOnce({ code: "permission.denied" })
        .mockResolvedValue(consent()),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    expect(cancelDialog(el)).toBeNull();
    expect(banner(el)?.textContent).toBe(codeMessage("permission.denied"));
    await openCancel(el);
    expect(cancelDialog(el)?.name).toBe("Wine");
    expect(banner(el)).toBeNull();
  });

  it("never confirms a dish whose context now belongs to another bill", async () => {
    const methods = apiFor({ ...consent(), billId: "other-bill" });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem).not.toHaveBeenCalled();
  });

  it("preserves the chosen partial quantity through the reason preview and service command", async () => {
    const read = consent("open", "not_started");
    read.context.components[0]!.quantity = "3.000";
    read.context.components[0]!.kitchenQuantity = "3.000";
    const methods = apiFor(read, {
      getTabLines: vi.fn().mockResolvedValue({
        lines: [{ ...wine, quantity: "3.000" }],
        revision: 6,
        editSentLines: true,
      }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    const quantity = cancelDialog(el)!.shadowRoot!.querySelector("wt-number-stepper")!;
    await quantity.updateComplete;
    await userEvent.fill(page.elementLocator(quantity.shadowRoot!.querySelector("input")!), "2");
    await flush(el);
    await removeCharge(el);
    expect(dialog(el)?.target).toMatchObject({ quantity: "2", unitTotal: null, total: "60.00" });
    expect(api.previewAdjustment).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ quantity: "2" }),
    );
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(methods.cancelItem.mock.calls[0]![2]).toMatchObject({
      quantity: "2",
      outcome: "remove_charge",
    });
    expect(dialog(el)).toBeNull();
  });

  it("lets a failed reasons read retry without retaining a busy chooser", async () => {
    const methods = apiFor(consent("open", "not_started"), {
      listAdjustmentReasons: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue([mistake]),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await clickChoice(el, "[data-confirm]");
    expect(cancelDialog(el)?.refusal).toBe(t("adjust.reasons_error"));
    expect(cancelDialog(el)?.busy).toBe(false);
    await removeCharge(el);
    expect(dialog(el)?.preview?.reduction).toBe("30.00");
    expect(methods.cancelItem).not.toHaveBeenCalled();
  });

  it("keeps a reason refusal under its field and returns to the editable form", async () => {
    const methods = apiFor(consent("open", "not_started"), {
      cancelItem: vi
        .fn()
        .mockRejectedValueOnce({ code: "adjustment.note_required" })
        .mockResolvedValue({ revision: 4 }),
    });
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await removeCharge(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)?.refusal).toBe("adjustment.note_required");
    expect(dialog(el)?.preview).toBeNull();
    const note = inDialog(el, 'wt-input[name="note"]');
    expect(note.getAttribute("name")).toBe("note");
    expect(note.shadowRoot!.textContent).toContain(codeMessage("adjustment.note_required"));
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });

  it("closes off-bill consent when the API is replaced before confirmation", async () => {
    const methods = apiFor(consent("open", "not_started"));
    const { el } = await mountApp(methods);
    await openMesa4(el);
    await openCancel(el);
    await removeCharge(el);
    const replacement = stubApi(apiFor());
    el.api = replacement;
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(cancelDialog(el)).toBeNull();
    expect(methods.cancelItem).not.toHaveBeenCalled();
    expect(replacement.cancelItem).not.toHaveBeenCalled();
  });
});

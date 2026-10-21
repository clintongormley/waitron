import { deviceZonesFixture } from "../test/device-zones.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { offer as menuOffer } from "../test/allergy-app-fixture.js";
import { productUnit } from "./widgets/product-name.js";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillBasket } from "./widgets/basket.js";
import type { TillAdjustmentDialog } from "./widgets/adjustment-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import type { FormFactor, CapabilityFlag } from "./layout.js";
import type {
  AdjustmentPreview,
  AdjustmentReason,
  HeldOrder,
  TabLine,
  TabLines,
  TillApi,
  TillProduct,
  ZoneOfferCatalogue,
} from "./api/client.js";

// Give away, Discount and Cancel on a stored counter order, through the app: the dialog is the
// table's, and after an answer the basket is loaded again from the server (B11c).

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
  capabilities: ["print-receipt", "take-orders"] as CapabilityFlag[],
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
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: null,
  menus: servedMenus([{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }], []),
  offers: [],
};

const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  menuItemId: `mi-${id}`,
  catalogueId: "cat-default",
  name,
  pricingUnit: "each",
  unitPrice,
  vatClass: "general",
  category: null,
  allergens: null,
});

const tabLine = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  stationId: null,
  movable: false,
  productId: null,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

/** Croquetas the kitchen has, and a caña at `canaPrice` (given away when not 2.50). */
function heldOrder(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): HeldOrder {
  return {
    kitchenNote: {
      scope: { workingOrderId: "wo-9" },
      note: null,
      revision: 0,
      ownerRevision: revision,
    },
    id: "wo-9",
    orderNumber: 12,
    label: "Mesa 4",
    revision,
    lines: [
      {
        workingOrderLineId: "l-1",
        productId: "croquetas",
        quantity: "1.000",
        product: product("croquetas", "Croquetas", "6.00"),
      },
      {
        workingOrderLineId: "l-2",
        productId: "cana",
        quantity: canaQuantity,
        product: product("cana", "Caña", canaPrice),
      },
    ],
  } as HeldOrder;
}

function listing(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): TabLines {
  return {
    revision,
    editSentLines: true,
    lines: [
      tabLine({
        id: "l-1",
        lineNo: 1,
        name: "Croquetas",
        productId: "croquetas",
        unitPriceGross: "6.00",
        sentAt: "2026-09-30T09:00:00.000Z",
        firedAt: "2026-09-30T09:00:00.000Z",
        state: "queued",
      }),
      tabLine({
        id: "l-2",
        lineNo: 2,
        name: "Caña",
        productId: "cana",
        quantity: canaQuantity,
        unitPriceGross: canaPrice,
        ...(canaPrice === "2.50" ? {} : { listUnitPriceGross: "2.50" }),
      }),
    ],
  };
}

const complaint: AdjustmentReason = {
  id: "r-complaint",
  name: "Complaint",
  kind: "comp",
  actions: ["comp", "discount_percent"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
};
const mistake: AdjustmentReason = {
  id: "r-mistake",
  name: "Mistake",
  kind: "void",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: [],
  approverRoles: [],
};

const preview = (over: Partial<AdjustmentPreview> = {}): AdjustmentPreview => ({
  reduction: "2.50",
  nominalValue: "2.50",
  needsApproval: null,
  lines: [],
  ...over,
});

let api: TillApi;

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
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
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    retrieveWorkingOrder: vi
      .fn()
      .mockResolvedValueOnce(heldOrder(4))
      .mockResolvedValue(heldOrder(5, "0.00")),
    getTabLines: vi.fn().mockResolvedValueOnce(listing(4)).mockResolvedValue(listing(5, "0.00")),
    listAdjustmentReasons: vi.fn().mockResolvedValue([complaint, mistake]),
    listAdjustmentApprovers: vi.fn().mockResolvedValue([{ personId: "m-1", displayName: "Marta" }]),
    previewAdjustment: vi.fn().mockResolvedValue(preview()),
    applyAdjustment: vi
      .fn()
      .mockResolvedValue({ adjustmentIds: ["a-1"], revision: 5, party: null }),
    ...overrides,
  } as unknown as TillApi;
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
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const basket = (el: TillApp) => counter(el).shadowRoot!.querySelector<TillBasket>("till-basket")!;
const inBasket = (el: TillApp, selector: string) =>
  basket(el).shadowRoot!.querySelector<HTMLElement>(selector);
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillAdjustmentDialog>("till-adjustment-dialog");
const approval = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>("till-supervisor-override-dialog");
const inDialog = (el: TillApp, selector: string) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;

async function press(el: TillApp, target: HTMLElement): Promise<void> {
  target.click();
  await flush(el);
}

async function counterMoveAction(el: TillApp): Promise<HTMLElement | null> {
  basket(el).openLineDetails(counter(el).store.lines[0]!);
  await flush(el);
  return inBasket(el, '[data-move-station="0"]');
}

async function openCounterMove(el: TillApp): Promise<void> {
  (await counterMoveAction(el))!.click();
  await flush(el);
}

/** Signs in and retrieves the stored order wo-9 into the counter's basket. */
async function retrieved(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(counter(el), "retrieve-order", { id: "wo-9" });
  await flush(el);
  return el;
}

async function placeCounter(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  const available = heldOrder(4).lines.map((line) => {
    const item = line.product!;
    return {
      ...menuOffer(item.menuItemId!, item.name),
      menuId: item.catalogueId!,
      productId: item.id,
      unitPrice: item.unitPrice,
      grossPrice: item.unitPrice,
      unit: productUnit(item),
    };
  });
  const catalogue: ZoneOfferCatalogue = {
    ...offers,
    context: { ...offers.context, serviceMode: "ticket_then_pay" },
    menus: servedMenus(
      [{ id: "cat-default", name: "Menu", isDefault: true, versionId: "v1" }],
      available,
    ),
    offers: available,
  };
  return retrieved({
    getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    listZoneOffers: vi.fn().mockResolvedValue(catalogue),
    ...overrides,
  });
}

async function chooseReason(el: TillApp, name: string): Promise<void> {
  const radio = [
    ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
  ].find((candidate) => candidate.closest("label")!.textContent!.trim() === name)!;
  await press(el, radio);
}

/** Opens Give away on the caña, chooses Complaint and presses Continue. */
async function previewComp(el: TillApp): Promise<void> {
  await press(el, inBasket(el, '[data-comp-line="1"]')!);
  await chooseReason(el, "Complaint");
  await press(el, inDialog(el, "[data-adjust-continue]"));
}

const ask = {
  expectedEdit: null,
  expectedRevision: 4,
  lineId: "l-2",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const offered = (el: TillApp) =>
  basket(el).shadowRoot!.querySelectorAll(
    "[data-cancel-line], [data-comp-line], [data-discount-bill]",
  ).length;

const stations = [
  {
    id: "bar",
    name: "Bar",
    displayOrder: 1,
    isDefault: false,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "open" as const,
  },
  {
    id: "grill",
    name: "Grill",
    displayOrder: 2,
    isDefault: true,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "default" as const,
  },
];

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

function emitMakeAt(el: TillApp, index: number): void {
  expect(inBasket(el, "[data-make-at]")).toBeNull();
  emit(basket(el), "open-make-at", index);
}

describe("till-app: counter station choice", () => {
  it("lets a new basket choose Make at while the held basket's station read still hangs", async () => {
    const oldRead = deferred<typeof stations>();
    const el = await retrieved({ listStations: vi.fn().mockResolvedValue(stations) });
    vi.mocked(api.listStations).mockImplementationOnce(() => oldRead.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(counter(el), "park-order", {});
    await flush(el);
    expect(counter(el).store.lineCount).toBe(0);
    counter(el).store.addProduct(product("new-cana", "New caña", "2.50"), "1");
    await flush(el);
    emitMakeAt(el, 0);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog");
    expect(chooser?.getAttribute("mode")).toBe("make-at");
    oldRead.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    emit(chooser!, "station-chosen", { stationId: "bar" });
    await flush(el);
    expect(counter(el).store.lines[0]!.makeAt).toBe("bar");
  });

  it("does not show a delayed Make at dialog after switching to the Floor tab", async () => {
    const read = deferred<typeof stations>();
    const floorFormFactor: FormFactor = "till";
    const el = await retrieved({
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor: floorFormFactor }),
      listStations: vi.fn().mockResolvedValue(stations),
    });
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    read.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  });

  it("does not show a delayed counter Move dialog after switching to the Floor tab", async () => {
    const read = deferred<typeof stations>();
    const floorFormFactor: FormFactor = "till";
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor: floorFormFactor }),
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
    });
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    await openCounterMove(el);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    read.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  });

  it("does not show a delayed Make at dialog after opening Schedule", async () => {
    const read = deferred<typeof stations>();
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: ["show-schedule"] }),
    });
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(counter(el), "show-schedule");
    read.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  });

  it("lets the next operator open Make at while the previous session's read still hangs", async () => {
    const oldRead = deferred<typeof stations>();
    const el = await retrieved({ listStations: vi.fn().mockResolvedValue(stations) });
    vi.mocked(api.listStations).mockImplementationOnce(() => oldRead.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", {
      personId: "p2",
      displayName: "Diego",
      permissions: [],
      canConfigureTill: false,
    });
    await flush(el);
    emitMakeAt(el, 1);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog");
    expect(chooser?.getAttribute("mode")).toBe("make-at");
    oldRead.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    emit(chooser!, "station-chosen", { stationId: "bar" });
    await flush(el);
    expect(counter(el).store.lines[1]!.makeAt).toBe("bar");
  });

  it("drops Make at when table navigation overtakes its station read", async () => {
    const read = deferred<typeof stations>();
    const seating = deferred<{ tabId: string; partyId: string; revision: number }>();
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      seatTable: vi.fn(() => seating.promise),
    });
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(counter(el), "open-table", { tableId: "t-1", seated: false, guestCount: 2 });
    read.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  });

  it("allows a table Move after table navigation overtakes a pending Make at", async () => {
    const read = deferred<typeof stations>();
    const seating = deferred<{ tabId: string; partyId: string; revision: number }>();
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      seatTable: vi.fn(() => seating.promise),
      listDrafts: vi.fn().mockResolvedValue({
        drafts: [],
        billEdits: [
          {
            billId: "table-order",
            editorId: null,
            editorName: null,
            editorVersion: 0,
            draftId: null,
            draftRevision: null,
          },
        ],
      }),
      readCurrentOrders: vi.fn().mockResolvedValue({
        revision: 1,
        hasGroups: false,
        nextDisplayNumber: 1,
        retainedCourses: [],
        reminder: null,
        groups: [],
        ungrouped: [],
      }),
      getPartyBills: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    emitMakeAt(el, 1);
    await flush(el);
    emit(counter(el), "open-table", { tableId: "t-1", seated: false, guestCount: 2 });
    seating.resolve({ tabId: "table-order", partyId: "party-1", revision: 1 });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-table-order-screen")!, "move-station", {
      workingOrderId: "table-order",
      lineId: "table-line",
      name: "Bravas",
      stationId: "bar",
    });
    read.resolve(stations);
    await flush(el);
    const dialogs = el.shadowRoot!.querySelectorAll("till-station-choice-dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.getAttribute("mode")).toBe("move");
  });

  it("does not open a counter move after the basket changes during the station read", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      moveDishStation: vi.fn(),
    });
    const read = deferred<typeof stations>();
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    await openCounterMove(el);
    await flush(el);
    counter(el).store.setLineQuantity(1, "2");
    read.resolve(stations);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
    expect(api.moveDishStation).not.toHaveBeenCalled();
  });

  it("refuses to submit a counter move after the basket changed with the dialog open", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      moveDishStation: vi.fn(),
    });
    await openCounterMove(el);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    counter(el).store.setLineQuantity(1, "2");
    emit(chooser, "station-chosen", { stationId: "grill" });
    await flush(el);
    expect(api.moveDishStation).not.toHaveBeenCalled();
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
  });

  it("holds counter edits after Move is submitted and canceled until the server reread completes", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const after = heldOrder(6);
    after.lines[0]!.makeAt = "grill";
    const answer = deferred<{ revision: number }>();
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(lines)
        .mockResolvedValue({ ...lines, revision: 6 }),
      retrieveWorkingOrder: vi.fn().mockResolvedValueOnce(heldOrder(4)).mockResolvedValue(after),
      moveDishStation: vi.fn(() => answer.promise),
    });
    await openCounterMove(el);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    emit(chooser, "station-chosen", { stationId: "grill" });
    await flush(el);
    emit(chooser, "close");
    await flush(el);
    inBasket(el, ".line .step-inc")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.quantity).toBe("1");
    expect(counter(el).store.dirty).toBe(false);
    answer.resolve({ revision: 6 });
    await flush(el);
    expect(counter(el).store.lines[0]!.makeAt).toBe("grill");
    expect(counter(el).store.revision).toBe(6);
    inBasket(el, ".line .step-inc")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.quantity).toBe("2");
  });

  it("lets a retrieved order choose Make at after a canceled Move on another order", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const answer = deferred<{ revision: number }>();
    const other = { ...heldOrder(5), id: "wo-10" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi
        .fn()
        .mockImplementation((id: string) => Promise.resolve(id === "wo-10" ? listing(5) : lines)),
      retrieveWorkingOrder: vi
        .fn()
        .mockImplementation((id: string) => Promise.resolve(id === "wo-10" ? other : heldOrder(4))),
      moveDishStation: vi.fn(() => answer.promise),
    });
    await openCounterMove(el);
    await flush(el);
    const old = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    emit(old, "station-chosen", { stationId: "grill" });
    await flush(el);
    emit(old, "close");
    emit(counter(el), "retrieve-order", { id: "wo-10" });
    await flush(el);
    expect(counter(el).store.id).toBe("wo-10");
    emitMakeAt(el, 1);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog");
    expect(chooser?.getAttribute("mode")).toBe("make-at");
    answer.reject({ code: "ticket.already_started" });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    expect(chooser?.getAttribute("mode")).toBe("make-at");
    emit(chooser!, "station-chosen", { stationId: "bar" });
    await flush(el);
    expect(counter(el).store.lines[1]!.makeAt).toBe("bar");
  });

  it("does not replace an edit made after another read overtakes a submitted move", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const answer = deferred<{ revision: number }>();
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      retrieveWorkingOrder: vi.fn().mockResolvedValue(heldOrder(4)),
      moveDishStation: vi.fn(() => answer.promise),
    });
    await openCounterMove(el);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
      stationId: "grill",
    });
    await flush(el);
    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    inBasket(el, ".line .step-inc")!.click();
    await flush(el);
    expect(counter(el).store.lines[0]!.quantity).toBe("2");
    answer.resolve({ revision: 6 });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.lines[0]!.quantity).toBe("2");
    expect(counter(el).store.dirty).toBe(true);
  });

  it("keeps Make at and Move openings exclusive while station reads finish out of order", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      moveDishStation: vi.fn(),
    });
    const read = deferred<typeof stations>();
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    emitMakeAt(el, 1);
    await flush(el);
    await openCounterMove(el);
    await flush(el);
    read.resolve(stations);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    expect(chooser.getAttribute("mode")).toBe("make-at");
    emit(chooser, "station-chosen", { stationId: "grill" });
    await flush(el);
    expect(counter(el).store.lines[1]!.makeAt).toBe("grill");
    expect(api.moveDishStation).not.toHaveBeenCalled();
  });

  it("keeps a pending Move opening ahead of a later Make at request", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
    });
    const read = deferred<typeof stations>();
    vi.mocked(api.listStations).mockImplementationOnce(() => read.promise);
    await openCounterMove(el);
    await flush(el);
    emitMakeAt(el, 1);
    await flush(el);
    read.resolve(stations);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    expect(chooser.getAttribute("mode")).toBe("move");
  });

  it("does not let a closed Make at dialog submit to a later Move dialog", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      moveDishStation: vi.fn(),
    });
    emitMakeAt(el, 1);
    await flush(el);
    const old = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    emit(old, "close");
    await flush(el);
    await openCounterMove(el);
    await flush(el);
    emit(old, "station-chosen", { stationId: "grill" });
    await flush(el);
    expect(api.moveDishStation).not.toHaveBeenCalled();
    expect(counter(el).store.lines[1]!.makeAt).toBeUndefined();
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")!.getAttribute("mode")).toBe(
      "move",
    );
  });

  it("clears a station absent from the arriving list and sends null on save", async () => {
    const old = heldOrder(4);
    old.lines[1]!.makeAt = "switched-off";
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      retrieveWorkingOrder: vi.fn().mockResolvedValue(old),
      updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 5 }),
    });
    expect(counter(el).store.lines[1]!.makeAt).toBeUndefined();
    emit(counter(el), "park-order", {});
    await flush(el);
    expect(vi.mocked(api.updateWorkingOrder).mock.calls[0]![1].lines[1]!.makeAt).toBeNull();
  });

  it("keeps a move refusal at the bottom of the choice dialog", async () => {
    const lines = listing(4);
    lines.lines[0] = { ...lines.lines[0]!, movable: true, stationId: "bar" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi.fn().mockResolvedValue(lines),
      moveDishStation: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    await openCounterMove(el);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
      stationId: "grill",
    });
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    expect(chooser.shadowRoot!.querySelector(".body > :last-child")!.getAttribute("role")).toBe(
      "alert",
    );
    expect(chooser.shadowRoot!.querySelector(".refusal")!.textContent).toContain("started");
  });
  it("saves Make at on an unsent line with the next pay request", async () => {
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 5 }),
      recordSale: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    emitMakeAt(el, 1);
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("till-station-choice-dialog")!;
    expect(chooser.getAttribute("mode")).toBe("make-at");
    emit(chooser, "station-chosen", { stationId: "bar" });
    await flush(el);
    expect(counter(el).store.lines[1]!.makeAt).toBe("bar");
    emit(counter(el), "confirm-payment", { method: "cash", amount: "10" });
    await flush(el);
    expect(vi.mocked(api.updateWorkingOrder).mock.calls[0]![1].lines[1]!.makeAt).toBe("bar");
    expect(vi.mocked(api.recordSale).mock.calls[0]![0][1]!.makeAt).toBe("bar");
  });

  it("rereads a moved counter dish and another till's line before the next save", async () => {
    const before = heldOrder(4);
    before.lines[0]!.makeAt = "bar";
    const after = heldOrder(6);
    after.lines[0]!.makeAt = "grill";
    after.lines.push({
      workingOrderLineId: "l-3",
      productId: "toast",
      quantity: "1.000",
      product: product("toast", "Toast", "3.00"),
    });
    const moved = listing(6);
    moved.lines[0] = { ...moved.lines[0]!, movable: true, stationId: "grill" };
    const el = await retrieved({
      listStations: vi.fn().mockResolvedValue(stations),
      retrieveWorkingOrder: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after),
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce({
          ...listing(4),
          lines: [
            { ...listing(4).lines[0]!, movable: true, stationId: "bar" },
            ...listing(4).lines.slice(1),
          ],
        })
        .mockResolvedValue(moved),
      moveDishStation: vi.fn().mockResolvedValue({ revision: 6 }),
      updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 7 }),
    });
    await openCounterMove(el);
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
      stationId: "grill",
    });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.lines.map((line) => line.makeAt)).toEqual([
      "grill",
      undefined,
      undefined,
    ]);
    expect(counter(el).store.lines).toHaveLength(3);
    expect(inBasket(el, '[data-cancel-line="0"]')).not.toBeNull();
    expect(await counterMoveAction(el)).not.toBeNull();
    emit(inBasket(el, "till-modifier-picker")!, "wt-modifier-cancel");
    await flush(el);
    inBasket(el, ".line .step-inc")!.click();
    await flush(el);
    emit(counter(el), "park-order", {});
    await flush(el);
    const sent = vi.mocked(api.updateWorkingOrder).mock.calls[0]![1];
    expect(sent.revision).toBe(6);
    expect(sent.lines.map((line) => [line.workingOrderLineId, line.makeAt])).toEqual([
      ["l-1", "grill"],
      ["l-2", null],
      ["l-3", null],
    ]);
  });
});

describe("till-app: giving away a dish on a stored counter order", () => {
  it.each([false, true])(
    "identifies a counter Hold as having no table editor, changed lines=%s",
    async (changed) => {
      const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 5 });
      const setWorkingOrderLabel = vi.fn().mockResolvedValue({ revision: 5 });
      const el = await retrieved({ updateWorkingOrder, setWorkingOrderLabel });
      if (changed) counter(el).store.addProduct(product("cana", "Caña", "2.50"), "1");
      emit(counter(el), "park-order", { label: "Ana" });
      await flush(el);
      const sent = changed ? updateWorkingOrder : setWorkingOrderLabel;
      expect(sent).toHaveBeenCalledOnce();
      expect(sent.mock.calls[0]![1]).toHaveProperty("expectedEdit", null);
    },
  );

  it("identifies a counter adjustment as having no table editor in preview and apply", async () => {
    const el = await retrieved();
    await previewComp(el);
    expect(vi.mocked(api.previewAdjustment).mock.calls[0]![1]).toHaveProperty("expectedEdit", null);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(vi.mocked(api.applyAdjustment).mock.calls[0]![1]).toHaveProperty("expectedEdit", null);
  });

  it("offers the adjustments once the order's lines are read, Cancel only on what the kitchen has", async () => {
    const el = await retrieved();

    expect(api.getTabLines).toHaveBeenCalledWith("wo-9", { signal: undefined });
    expect(inBasket(el, '[data-cancel-line="0"]')).not.toBeNull();
    expect(inBasket(el, '[data-cancel-line="1"]')).toBeNull();
    expect(inBasket(el, '[data-comp-line="1"]')).not.toBeNull();
    expect(inBasket(el, "[data-discount-bill]")).not.toBeNull();
  });

  it("offers none, and keeps remove on every line, when the order's lines cannot be read", async () => {
    const el = await retrieved({
      getTabLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
    });

    expect(counter(el).store.lines).toHaveLength(2);
    expect(offered(el)).toBe(0);
    expect(basket(el).shadowRoot!.querySelectorAll(".line .remove")).toHaveLength(2);
    expect(banner(el)).toBeNull();
  });

  it("offers none once the order is placed", async () => {
    const el = await retrieved({ placeOrder: vi.fn().mockResolvedValue(undefined) });
    expect(offered(el)).toBeGreaterThan(0);

    emit(counter(el), "place-order");
    await flush(el);

    expect(api.placeOrder).toHaveBeenCalledWith("wo-9", null);
    expect(offered(el)).toBe(0);
  });

  it("moves on as placed when an unchanged retry answers the original placement", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const el = await placeCounter({ placeOrder });
    emit(counter(el), "place-order");
    await flush(el);
    expect(counter(el).stage).toBe("order");
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));

    emit(counter(el), "place-order");
    await flush(el);

    expect(placeOrder.mock.calls).toEqual([
      ["wo-9", null],
      ["wo-9", null],
    ]);
    expect(counter(el).stage).toBe("collect");
    expect(banner(el)).toBeNull();
  });

  it("keeps an edited second attempt when its save says the order was already placed", async () => {
    const placeOrder = vi.fn().mockResolvedValue({ id: "wo-9", status: "placed" });
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
    const el = await placeCounter({ placeOrder, updateWorkingOrder });
    const store = counter(el).store;
    store.addProduct(store.lines[1]!.product, "1");
    const quantity = store.lines[1]!.quantity.toString();

    emit(counter(el), "place-order");
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(counter(el).stage).toBe("order");
    expect(banner(el)?.textContent).toContain(t("place.error"));
    expect(store.lines[1]!.quantity.toString()).toBe(quantity);
  });

  it("replays a lost placing reply without saving the confirmed recipient again", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const setOrderInvoiceChoice = vi
      .fn()
      .mockResolvedValueOnce({ revision: 5 })
      .mockRejectedValue({ code: "working_order.not_open" });
    const el = await placeCounter({
      placeOrder,
      setOrderInvoiceChoice,
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, orderFlow: "ticket_then_pay", fullInvoices: true }),
      getInvoiceDeliveryOptions: vi
        .fn()
        .mockResolvedValue({ invoicePrinter: null, emailAvailable: false }),
    });
    emit(counter(el), "choose-invoice");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Example Guest",
          address: "1 Main Street",
          countryCode: "ES",
        },
        delivery: { medium: "receipt" },
      },
    );
    await flush(el);
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
    expect(setOrderInvoiceChoice).toHaveBeenCalledOnce();

    emit(counter(el), "place-order");
    await flush(el);

    expect(setOrderInvoiceChoice).toHaveBeenCalledOnce();
    expect(placeOrder.mock.calls).toEqual([
      ["wo-9", null],
      ["wo-9", null],
    ]);
    expect(counter(el).stage).toBe("collect");
    expect(banner(el)).toBeNull();
  });

  it("does not replay an uncertain placement after the basket changes", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
    const el = await placeCounter({ placeOrder, updateWorkingOrder });
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
    const store = counter(el).store;
    store.addProduct(store.lines[1]!.product, "1");

    emit(counter(el), "place-order");
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(counter(el).stage).toBe("order");
    expect(banner(el)?.textContent).toContain(t("place.error"));
  });

  it.each(["same values", "new recipient", "new delivery"] as const)(
    "checks %s after a lost placing reply",
    async (change) => {
      const placeOrder = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Network reply lost"))
        .mockResolvedValue({ id: "wo-9", status: "placed" });
      const setOrderInvoiceChoice = vi
        .fn()
        .mockResolvedValueOnce({ revision: 5 })
        .mockRejectedValue({ code: "working_order.not_open" });
      const el = await placeCounter({
        placeOrder,
        setOrderInvoiceChoice,
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, orderFlow: "ticket_then_pay", fullInvoices: true }),
        getInvoiceDeliveryOptions: vi
          .fn()
          .mockResolvedValue({ invoicePrinter: null, emailAvailable: true }),
      });
      async function confirm(changed = false) {
        emit(counter(el), "choose-invoice");
        await flush(el);
        emit(
          el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
          "invoice-recipient-confirm",
          {
            delivery:
              changed && change === "new delivery"
                ? { medium: "email", recipient: "guest@example.test" }
                : { medium: "receipt" },
            recipient: {
              countryCode: "ES",
              address: "1 Main Street",
              legalName: changed && change === "new recipient" ? "Another Guest" : "Example Guest",
              taxId: "12345678Z",
            },
            invoiceType: "F1",
          },
        );
        await flush(el);
      }
      await confirm();
      emit(counter(el), "place-order");
      await flush(el);
      expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
      await confirm(true);

      emit(counter(el), "place-order");
      await flush(el);

      if (change === "same values") {
        expect(setOrderInvoiceChoice).toHaveBeenCalledOnce();
        expect(placeOrder).toHaveBeenCalledTimes(2);
        expect(counter(el).stage).toBe("collect");
        expect(banner(el)).toBeNull();
      } else {
        expect(setOrderInvoiceChoice).toHaveBeenCalledTimes(2);
        expect(placeOrder).toHaveBeenCalledOnce();
        expect(counter(el).stage).toBe("order");
        expect(banner(el)?.textContent).toContain(t("place.error"));
      }
    },
  );

  it("prepares a fresh attempt after an uncertain placement receives a definite refusal", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockRejectedValueOnce({ code: "working_order.not_open" })
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const updateWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce({ revision: 5 })
      .mockRejectedValue({ code: "working_order.not_open" });
    const el = await placeCounter({ placeOrder, updateWorkingOrder });
    const store = counter(el).store;
    store.addProduct(store.lines[1]!.product, "1");
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("place.error"));
    expect(updateWorkingOrder).toHaveBeenCalledOnce();

    emit(counter(el), "place-order");
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(placeOrder).toHaveBeenCalledTimes(3);
    expect(counter(el).stage).toBe("collect");
  });

  it("saves a new receipt language before retrying an uncertain placement", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network reply lost"))
      .mockResolvedValue({ id: "wo-9", status: "placed" });
    const setOrderReceiptLanguage = vi.fn().mockResolvedValue({ revision: 5 });
    const el = await placeCounter({
      placeOrder,
      setOrderReceiptLanguage,
      getTill: vi.fn().mockResolvedValue({
        ...till,
        orderFlow: "ticket_then_pay",
        receiptLanguages: ["en", "es-ES"],
      }),
    });
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
    emit(counter(el), "choose-receipt-language");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-reprint-language-dialog")!,
      "reprint-language-confirm",
      {
        language: "es-ES",
      },
    );
    await flush(el);
    expect(setOrderReceiptLanguage).toHaveBeenCalledWith("wo-9", {
      revision: 4,
      expectedEdit: null,
      language: "es-ES",
    });

    emit(counter(el), "place-order");
    await flush(el);

    expect(setOrderReceiptLanguage).toHaveBeenCalledOnce();
    expect(placeOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).stage).toBe("collect");
  });

  it("saves an edited basket to a replacement server before placing there", async () => {
    const placeOrder = vi.fn().mockRejectedValue(new TypeError("Network reply lost"));
    const el = await placeCounter({ placeOrder });
    emit(counter(el), "place-order");
    await flush(el);
    expect(banner(el)?.textContent).toContain(t("sale.unconfirmed"));
    const replacement = {
      ...api,
      updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 5 }),
      placeOrder: vi.fn().mockResolvedValue({ id: "wo-9", status: "placed" }),
    };
    el.api = replacement as unknown as TillApi;
    const store = counter(el).store;
    store.addProduct(store.lines[1]!.product, "1");
    await flush(el);

    emit(counter(el), "place-order");
    await flush(el);

    expect(replacement.updateWorkingOrder).toHaveBeenCalledOnce();
    expect(replacement.placeOrder).toHaveBeenCalledWith("wo-9", null);
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(counter(el).stage).toBe("collect");
  });

  it("places edited lines after their save succeeds", async () => {
    const placeOrder = vi.fn().mockResolvedValue({ id: "wo-9", status: "placed" });
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 5 });
    const el = await placeCounter({ placeOrder, updateWorkingOrder });
    const store = counter(el).store;
    store.addProduct(store.lines[1]!.product, "1");

    emit(counter(el), "place-order");
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    expect(placeOrder).toHaveBeenCalledWith("wo-9", null);
    expect(counter(el).stage).toBe("collect");
    expect(banner(el)).toBeNull();
  });

  for (const language of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`shows the lost-reply retry and placed result in ${language}/${theme}/${width}`, async () => {
          const previous = currentLocale();
          await page.viewport(width, 900);
          const placeOrder = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("Network reply lost"))
            .mockResolvedValue({ id: "wo-9", status: "placed" });
          const el = await placeCounter({
            placeOrder,
            getTill: vi
              .fn()
              .mockResolvedValue({ ...till, orderFlow: "ticket_then_pay", locale: language }),
          });
          const host = el.parentElement!;
          host.setAttribute("data-theme", theme);
          try {
            setLocale(language);
            el.requestUpdate();
            await flush(el);
            const send = () =>
              counter(el)
                .shadowRoot!.querySelector("till-tender-pay")!
                .shadowRoot!.querySelector("wt-button.place")!
                .shadowRoot!.querySelector<HTMLButtonElement>("button")!;
            expect(send().disabled).toBe(false);
            await userEvent.click(send());
            await vi.waitFor(() =>
              expect(banner(el)?.textContent).toContain(t("sale.unconfirmed")),
            );
            await flush(el);
            expect(el.shadowRoot!.textContent).toContain(t("sale.unconfirmed", language));
            await page.screenshot({
              path: `__screenshots__/a983-place-replay/lost-${language}-${theme}-${width}.png`,
            });

            await userEvent.click(send());
            await vi.waitFor(() => expect(counter(el).stage).toBe("collect"));
            await flush(el);
            expect(banner(el)).toBeNull();
            expect(el.shadowRoot!.textContent).not.toContain(t("place.error", language));
            await page.screenshot({
              path: `__screenshots__/a983-place-replay/placed-${language}-${theme}-${width}.png`,
            });
          } finally {
            setLocale(previous);
            await page.viewport(1280, 900);
          }
        });

  it("applies it to the counter order at the basket's revision, then loads the order again", async () => {
    const el = await retrieved();

    await previewComp(el);
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-9", ask);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-9", command: { ...ask, submissionId: expect.any(String) } },
    ]);
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.revision).toBe(5);
    const cana = basket(el).shadowRoot!.querySelectorAll(".line")[1]!;
    expect(cana.querySelector(".line-total s")!.textContent).toBe(
      formatMoney("2.50", currentLocale()),
    );
    expect(cana.querySelector(".line-total")!.textContent).toContain(
      formatMoney("0.00", currentLocale()),
    );
    expect(banner(el)).toBeNull();
    // Acting again starts from the order as it is now.
    await previewComp(el);
    expect(api.previewAdjustment).toHaveBeenLastCalledWith("wo-9", {
      ...ask,
      expectedRevision: 5,
      expectedEdit: null,
    });
  });

  it("cancels a dish the kitchen has with a reason", async () => {
    const el = await retrieved();

    await press(el, inBasket(el, '[data-cancel-line="0"]')!);
    await chooseReason(el, "Mistake");
    await press(el, inDialog(el, "[data-adjust-continue]"));

    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-9", {
      expectedRevision: 4,
      lineId: "l-1",
      reasonId: "r-mistake",
      action: "cancel",
      note: null,
      expectedEdit: null,
    });
  });

  it("asks an approver for their PIN when the reason needs one", async () => {
    const el = await retrieved({
      previewAdjustment: vi
        .fn()
        .mockResolvedValue(
          preview({ needsApproval: { by: "reason", roles: ["manager", "admin"] } }),
        ),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith(["manager", "admin"]);
    await pinPad(el, "7777");

    expect(applied()).toEqual([
      {
        orderId: "wo-9",
        command: {
          ...ask,
          submissionId: expect.any(String),
          approver: { personId: "m-1", pin: "7777" },
        },
      },
    ]);
    expect(approval(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
  });
});

describe("till-app: a stored counter order changed elsewhere", () => {
  it("loads the order again after an out-of-date refusal, says what changed, and sends nothing again", async () => {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockResolvedValue(heldOrder(6, "2.50", "2.000")),
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(listing(4))
        .mockResolvedValue(listing(6, "2.50", "2.000")),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.revision).toBe(6);
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
    expect(banner(el)!.textContent).toBe(t("adjust.changed_line").replace("{line}", "Caña"));
  });

  it("says the order could not be read again, rather than what changed, when its lines cannot be", async () => {
    const el = await retrieved({
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(listing(4))
        .mockRejectedValue(new TypeError("Failed to fetch")),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(offered(el)).toBe(0);
    expect(banner(el)!.textContent).toBe(t("held.reread_failed"));
  });

  it("says the order is no longer available when it has gone by the time it is loaded again", async () => {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockRejectedValue({ code: "working_order.not_found", status: 404 }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.revision).toBe(4);
    expect(banner(el)!.textContent).toBe(t("held.stale"));
  });

  it("loads the order again and says the change may have been made when no answer ever comes", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({ applyAdjustment });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toBe(t("adjust.unconfirmed")), {
      timeout: 4000,
      interval: 50,
    });

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed"));
  });

  it("says the change may have been made and to check the order, when no answer comes and the read fails", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({
      applyAdjustment,
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    await vi.waitFor(() => expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el, 6);

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed_unread"));
  });

  it("says the order is no longer available when no answer comes and it has gone by the time it is read again", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({
      applyAdjustment,
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockRejectedValue({ code: "working_order.not_found", status: 404 }),
    });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    await vi.waitFor(() => expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2), {
      timeout: 4000,
      interval: 50,
    });
    await flush(el, 6);

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("held.stale"));
  });

  it("still says the change may have been made when another order, which has gone, is retrieved while it is read again", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      applyAdjustment,
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementationOnce(() => reload.promise)
        .mockRejectedValue({ code: "working_order.not_found", status: 404 }),
    });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    await vi.waitFor(() => expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2), {
      timeout: 4000,
      interval: 50,
    });
    emit(counter(el), "retrieve-order", { id: "wo-gone" });
    await flush(el);
    expect(banner(el)!.textContent).toBe(t("held.stale"));
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el, 6);

    expect(counter(el).store.revision).toBe(5);
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed"));
  });

  it("says the change may have been made when no answer comes and the same order is retrieved while it is read again", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      applyAdjustment,
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementationOnce(() => reload.promise)
        .mockResolvedValue(heldOrder(5, "0.00")),
    });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    await vi.waitFor(() => expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2), {
      timeout: 4000,
      interval: 50,
    });
    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el, 6);

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed_unread"));
  });
});

describe("till-app: an answer after the basket moved on", () => {
  it("leaves a cleared basket alone when the answer comes", async () => {
    const answer = deferred<{ adjustmentIds: string[]; revision: number; party: null }>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    counter(el).store.clear();
    await flush(el);
    answer.resolve({ adjustmentIds: ["a-1"], revision: 5, party: null });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(counter(el).store.lines).toHaveLength(0);
    expect(banner(el)).toBeNull();
  });

  it("says nothing of a refusal that comes after the basket was cleared", async () => {
    const answer = deferred<never>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    counter(el).store.clear();
    await flush(el);
    answer.reject({ code: "adjustment.action_not_allowed" });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });

  it("does not load the order again for an answer that comes after the till locked", async () => {
    const answer = deferred<{ adjustmentIds: string[]; revision: number; party: null }>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    emit(counter(el), "logout");
    await discardBasketChanges(el);
    answer.resolve({ adjustmentIds: ["a-1"], revision: 5, party: null });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not put the order back into a basket cleared while it was being loaded again", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);

    counter(el).store.clear();
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);

    expect(counter(el).store.lines).toHaveLength(0);
    expect(counter(el).store.persisted).toBe(false);
  });

  it("closes the dialog when another order is retrieved into the basket", async () => {
    const el = await retrieved();
    await previewComp(el);

    vi.mocked(api.retrieveWorkingOrder).mockResolvedValue({ ...heldOrder(2), id: "wo-10" });
    emit(counter(el), "retrieve-order", { id: "wo-10" });
    await flush(el);

    expect(dialog(el)).toBeNull();
  });
});

describe("till-app: no adjustment while the order is being paid, placed or held", () => {
  const adjustByHand = (el: TillApp) =>
    emit(basket(el), "adjust", {
      kind: "comp",
      counter: true,
      target: { lineId: "l-2", name: "Caña", quantity: "1", total: "2.50", unitTotal: null },
    });

  /** Presses Give away on the caña and holds the reasons' answer until `reasons` resolves. */
  async function pressedWhileReasonsLoad(
    overrides: Record<string, unknown>,
  ): Promise<{ el: TillApp; reasons: ReturnType<typeof deferred<AdjustmentReason[]>> }> {
    const reasons = deferred<AdjustmentReason[]>();
    const el = await retrieved({
      listAdjustmentReasons: vi.fn(() => reasons.promise),
      ...overrides,
    });
    await press(el, inBasket(el, '[data-comp-line="1"]')!);
    expect(api.listAdjustmentReasons).toHaveBeenCalledOnce();
    return { el, reasons };
  }

  it("opens nothing when a card payment of the order starts while the reasons are read", async () => {
    const payment = deferred<{ outcome: "declined" }>();
    const { el, reasons } = await pressedWhileReasonsLoad({ pay: vi.fn(() => payment.promise) });

    emit(counter(el), "collect-card", {});
    await flush(el);
    expect(api.pay).toHaveBeenCalledOnce();
    reasons.resolve([complaint]);
    await flush(el);

    expect(dialog(el)).toBeNull();
    payment.resolve({ outcome: "declined" });
    await flush(el);
  });

  it("opens nothing when the order is placed while the reasons are read", async () => {
    const placing = deferred<void>();
    const { el, reasons } = await pressedWhileReasonsLoad({
      placeOrder: vi.fn(() => placing.promise),
    });

    emit(counter(el), "place-order");
    await flush(el);
    expect(api.placeOrder).toHaveBeenCalledOnce();
    reasons.resolve([complaint]);
    await flush(el);

    expect(dialog(el)).toBeNull();
    placing.resolve();
    await flush(el);
  });

  it("opens nothing when the basket is changed while the reasons are read", async () => {
    const { el, reasons } = await pressedWhileReasonsLoad({});

    counter(el).store.setLineQuantity(1, "2");
    await flush(el);
    reasons.resolve([complaint]);
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
  });

  it("opens nothing when the same order is retrieved at a new revision while the reasons are read", async () => {
    const { el, reasons } = await pressedWhileReasonsLoad({});

    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    reasons.resolve([complaint]);
    await flush(el);

    expect(dialog(el)).toBeNull();
  });

  it("sends nothing, and says so, when the same order lands at a new revision while the dialog is open", async () => {
    const retrieving = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementationOnce(() => retrieving.promise),
    });

    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    await previewComp(el);
    retrieving.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
    expect(banner(el)!.textContent).toBe(t("adjust.basket_changed"));
  });

  it("sends nothing, and says so, when the basket changed while the dialog was open", async () => {
    const el = await retrieved();
    await previewComp(el);
    const store = counter(el).store;

    // A menu check adopts a dish's new version into the basket without asking, dialog or not.
    store.adoptLines(new Map([[1, { ...store.lines[1]! }]]));
    await flush(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
    expect(store.dirty).toBe(true);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toBe(t("adjust.basket_changed"));
  });

  it("still sends when the same order, at the same revision, is loaded again while the dialog is open", async () => {
    const retrieving = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementationOnce(() => retrieving.promise)
        .mockResolvedValue(heldOrder(5, "0.00")),
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(listing(4))
        .mockResolvedValueOnce(listing(4))
        .mockResolvedValue(listing(5, "0.00")),
    });

    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    await previewComp(el);
    retrieving.resolve(heldOrder(4));
    await flush(el);
    expect(dialog(el)).not.toBeNull();
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-9", command: { ...ask, submissionId: expect.any(String) } },
    ]);
    expect(banner(el)).toBeNull();
    expect(counter(el).store.revision).toBe(5);
  });

  it("offers none, and opens nothing, while a card payment of the order is out", async () => {
    const payment = deferred<{ outcome: "declined" }>();
    const el = await retrieved({ pay: vi.fn(() => payment.promise) });

    emit(counter(el), "collect-card", {});
    await flush(el);

    expect(api.pay).toHaveBeenCalledOnce();
    expect(offered(el)).toBe(0);
    expect(inBasket(el, '[data-cancel-line="0"]')).toBeNull();
    expect(
      basket(el).shadowRoot!.querySelectorAll(".line")[0]!.querySelector(".remove"),
    ).toBeNull();
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();

    payment.resolve({ outcome: "declined" });
    await flush(el);
    expect(offered(el)).toBeGreaterThan(0);
  });

  it("offers none, and opens nothing, while the order is being placed", async () => {
    const placing = deferred<void>();
    const el = await retrieved({ placeOrder: vi.fn(() => placing.promise) });

    emit(counter(el), "place-order");
    await flush(el);

    expect(api.placeOrder).toHaveBeenCalledOnce();
    expect(offered(el)).toBe(0);
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    placing.resolve();
    await flush(el);
  });

  it("opens nothing while a changed order is being saved to be held", async () => {
    const saving = deferred<{ revision: number }>();
    const el = await retrieved({ updateWorkingOrder: vi.fn(() => saving.promise) });
    counter(el).store.setLineQuantity(1, "2");
    await flush(el);

    emit(counter(el), "park-order", {});
    await flush(el);

    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    saving.resolve({ revision: 5 });
    await flush(el);
  });

  it("does not reload a changed counter order after its operator signs out", async () => {
    const saving = deferred<{ revision: number }>();
    const el = await retrieved({ updateWorkingOrder: vi.fn(() => saving.promise) });
    counter(el).store.setLineQuantity(1, "2");
    emit(counter(el), "park-order", {});
    await flush(el);
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();

    emit(counter(el), "logout");
    await flush(el);
    const orderReads = vi.mocked(api.retrieveWorkingOrder).mock.calls.length;
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    saving.reject({ code: "working_order.out_of_date" });
    await flush(el);

    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(orderReads);
    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not pay a changed order after the save answers for a signed-out operator", async () => {
    const saving = deferred<{ revision: number }>();
    const recordSale = vi.fn();
    const el = await retrieved({
      updateWorkingOrder: vi.fn(() => saving.promise),
      recordSale,
    });
    counter(el).store.setLineQuantity(1, "2");
    emit(counter(el), "confirm-payment", { method: "cash", amount: "20" });
    await flush(el);
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();

    emit(counter(el), "logout");
    await flush(el);
    saving.resolve({ revision: 5 });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
  });

  it("does not refresh held orders when a changed-order reread outlives sign-out", async () => {
    const reread = deferred<HeldOrder>();
    const el = await retrieved({
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reread.promise),
    });
    counter(el).store.setLineQuantity(1, "2");
    emit(counter(el), "park-order", {});
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);

    emit(counter(el), "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    reread.resolve(heldOrder(5));
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });
});

describe("till-app: the basket while the order is loaded again", () => {
  const plus = (el: TillApp, index: number) =>
    basket(el)
      .shadowRoot!.querySelectorAll<HTMLElement>(".line")
      [index]!.querySelector<HTMLElement>(".step-inc")!;

  it("takes no edit until the order given away is loaded again, and takes edits after", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();

    await press(el, plus(el, 1));
    expect(counter(el).store.lines[1]!.quantity).toBe("1");
    expect(counter(el).store.dirty).toBe(false);
    expect(offered(el)).toBe(0);

    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    await press(el, plus(el, 1));
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
  });

  it("takes no edit until the order is loaded again after an out-of-date refusal", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();

    await press(el, plus(el, 1));
    expect(counter(el).store.dirty).toBe(false);

    reload.resolve(heldOrder(6));
    await flush(el);
    expect(counter(el).store.revision).toBe(6);
    await press(el, plus(el, 1));
    expect(counter(el).store.dirty).toBe(true);
  });

  it("keeps an edit made after the same order was retrieved again while it was being read again", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementationOnce(() => reload.promise)
        .mockResolvedValue(heldOrder(5, "0.00")),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);

    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    await press(el, plus(el, 1));
    expect(counter(el).store.lines[1]!.quantity).toBe("2");

    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
    expect(counter(el).store.dirty).toBe(true);
  });
});

describe("till-app: the basket's lock while the order is loaded again", () => {
  const cafe = product("cafe", "Café", "1.50");

  async function givenAway(reload: Promise<HeldOrder>): Promise<TillApp> {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();
    return el;
  }

  it("ends when the order is held, so the next basket takes products", async () => {
    const reload = deferred<HeldOrder>();
    const el = await givenAway(reload.promise);

    emit(counter(el), "park-order", {});
    await flush(el);
    expect(counter(el).store.lineCount).toBe(0);
    counter(el).store.addProduct(cafe, "1");

    expect(counter(el).store.lineCount).toBe(1);
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(counter(el).store.lines.map((line) => line.product.id)).toEqual(["cafe"]);
  });

  it("ends on New sale, so the next basket takes products", async () => {
    const reload = deferred<HeldOrder>();
    const el = await givenAway(reload.promise);

    emit(counter(el), "new-sale");
    await flush(el);
    counter(el).store.addProduct(cafe, "1");

    expect(counter(el).store.lineCount).toBe(1);
  });

  it("ends when the till locks, so the next operator can edit the basket", async () => {
    const reload = deferred<HeldOrder>();
    const el = await givenAway(reload.promise);
    const store = counter(el).store;

    emit(counter(el), "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    store.addProduct(cafe, "1");

    expect(store.lineCount).toBe(3);
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(store.lineCount).toBe(3);
    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("says the order could not be read again when the reload gets no answer", async () => {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(banner(el)!.textContent).toBe(t("held.reread_failed"));
    counter(el).store.addProduct(cafe, "1");
    expect(counter(el).store.lineCount).toBe(3);
  });

  it("ends at the request limit when the reload never answers, and a late answer changes nothing", async () => {
    const reload = deferred<HeldOrder>();
    let signal: AbortSignal | undefined;
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation((_id: string, options?: { signal?: AbortSignal }) => {
          signal = options?.signal;
          return reload.promise;
        }),
    });
    await previewComp(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const settle = async () => {
        await vi.advanceTimersByTimeAsync(0);
        await el.updateComplete;
      };
      inDialog(el, "[data-adjust-confirm]").click();
      await settle();
      await settle();
      counter(el).store.addProduct(cafe, "1");
      expect(counter(el).store.lineCount).toBe(2);

      await vi.advanceTimersByTimeAsync(150_000);
      await settle();
      expect(signal?.aborted).toBe(true);
      counter(el).store.addProduct(cafe, "1");
      expect(counter(el).store.lineCount).toBe(3);

      reload.resolve(heldOrder(5, "0.00"));
      await settle();
      await settle();
      expect(counter(el).store.lineCount).toBe(3);
      expect(counter(el).store.revision).toBe(4);
      expect(banner(el)!.textContent).toBe(t("held.reread_failed"));
    } finally {
      vi.useRealTimers();
    }
  });
});

it("station-choice Keep and Discard leave the counter basket and server writes alone", async () => {
  const moveDishStation = vi.fn();
  const el = await retrieved({
    listStations: vi.fn().mockResolvedValue(stations),
    moveDishStation,
  });
  const store = counter(el).store;
  const before = store.lines.map((line) => ({ ...line }));
  const movesBefore = moveDishStation.mock.calls.length;
  emitMakeAt(el, 1);
  await flush(el);
  const form = el.shadowRoot!.querySelector<HTMLElement>("till-station-choice-dialog")!;
  const field =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!;
  await field.updateComplete;
  field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await field.updateComplete;
  const option = Array.from(field.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")).find(
    (o) => o.textContent?.trim() === "Bar",
  )!;
  option.click();
  await flush(el);
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
  await flush(el);
  const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBe(form);
  expect(field.value).toBe("bar");
  expect(store.lines).toEqual(before);
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
  await flush(el);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  expect(store.lines).toEqual(before);
  expect(moveDishStation.mock.calls.length).toBe(movesBefore);
});

describe("till-app: unsaved adjustment inputs", () => {
  function unload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  async function question(el: TillApp) {
    await flush(el);
    const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await q.updateComplete;
    return q;
  }
  it("Cancel preserves the stored counter basket and pending reason until Discard", async () => {
    const el = await retrieved();
    await press(el, inBasket(el, '[data-comp-line="1"]')!);
    await chooseReason(el, "Complaint");
    await press(el, inDialog(el, "[data-adjust-close]"));
    const q = await question(el);
    expect(q.open).toBe(true);
    expect(dialog(el)).not.toBeNull();
    expect(counter(el).store.lines.map((line) => line.workingOrderLineId)).toEqual(["l-1", "l-2"]);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(
      dialog(el)!.shadowRoot!.querySelector<HTMLInputElement>('input[name="reason"]')!.checked,
    ).toBe(true);
    await press(el, inDialog(el, "[data-adjust-close]"));
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(counter(el).store.lines.map((line) => line.workingOrderLineId)).toEqual(["l-1", "l-2"]);
    expect(counter(el).store.total).toBe("8.50");
    expect(api.applyAdjustment).not.toHaveBeenCalled();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
  });
  it("an accepted adjustment retires its input scope before the first basket refresh", async () => {
    const el = await retrieved();
    await previewComp(el);
    expect(unload()).toBe(true);
    const observations: boolean[] = [];
    vi.mocked(api.retrieveWorkingOrder).mockImplementation(async () => {
      observations.push(unload());
      return heldOrder(5, "0.00");
    });
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(observations).toEqual([false]);
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.total).toBe("6.00");
    expect(applied()[0]).toEqual({
      orderId: "wo-9",
      command: { ...ask, submissionId: expect.any(String) },
    });
    expect((await question(el)).open).toBe(false);
  });
  it("discarding nested approval leaves the adjustment reason intact and applies nothing", async () => {
    const el = await retrieved({
      previewAdjustment: vi
        .fn()
        .mockResolvedValue(
          preview({ needsApproval: { by: "reason", roles: ["manager", "admin"] } }),
        ),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    const proof = approval(el)!;
    proof.shadowRoot!.querySelector<HTMLElement>('[data-person="m-1"]')!.click();
    await proof.updateComplete;
    proof
      .shadowRoot!.querySelector("till-numeric-pad")!
      .shadowRoot!.querySelector<HTMLElement>('[data-key="0"]')!
      .click();
    await proof.updateComplete;
    proof.shadowRoot!.querySelector<HTMLElement>(".back")!.click();
    const q = await question(el);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => q.open).toBe(false);
    await proof.updateComplete;
    proof.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await expect.poll(() => approval(el)).toBeNull();
    expect(dialog(el)).not.toBeNull();
    await press(el, inDialog(el, "[data-adjust-back]"));
    expect(
      dialog(el)!.shadowRoot!.querySelector<HTMLInputElement>('input[name="reason"]')!.checked,
    ).toBe(true);
    expect(unload()).toBe(true);
    expect(api.applyAdjustment).not.toHaveBeenCalled();
  });
});

async function discardBasketChanges(el: TillApp): Promise<void> {
  await flush(el);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await flush(el);
}

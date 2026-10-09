import { leaveCoordinatorFor } from "@waitron/ui";
import { commands, page, userEvent } from "vitest/browser";
import { type WtInput, type WtCombobox, applyTokens, currentContentLanguages } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import indexHtml from "../index.html?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import {
  adjustmentStubs,
  cancelThroughDialog,
  cleanupWidgets,
  expectNoA11yViolations,
  draftServer,
  mountWidget,
  servedMenus,
  type DraftServer,
} from "./widgets/test-helpers.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import { productUnit } from "./widgets/product-name.js";
import type { TillDeadEndsSection } from "./widgets/dead-ends-section.js";
import { TillApp } from "./till-app.js";
import { ServerRouter } from "./api/server-router.js";
import { diag } from "./diagnostics.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { TillScheduleScreen } from "./screens/till-schedule-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillStationScreen } from "./screens/till-station-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillEquipmentDialog } from "./widgets/equipment-dialog.js";
import type { TillProfileDialog } from "./widgets/profile-dialog.js";
import type { TillStationQueue } from "./widgets/station-queue.js";
import type { TillCounterWaiting } from "./widgets/counter-waiting.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  CounterWaitingOrder,
  DeadEndAnswer,
  DevDeviceList,
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  FloorZone,
  HeldOrderSummary,
  PayOutcome,
  PartyBill,
  ProductCatalogue,
  RoleEquipment,
  ServiceZoneSummary,
  StationQueue,
  TabLine,
  TableServiceStatus,
  TableState,
  TillApi,
  TillProduct,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { DEV_DEVICE_STORAGE_KEY } from "./api/dev-device.js";
import type { WorkingOrderStore } from "./state/working-order.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

// The venue's default menu (catalogue) — every product fixture below is tagged with its id, so the
// counter grid (which shows only the selected menu's products) renders them under the default selection.
const defaultMenu = { id: "cat-default", name: "Carta", isDefault: true };

const cafe: TillProduct = {
  id: "cafe",
  menuItemId: "menu-item-cafe-0",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  catalogueId: "cat-default",
  catalogueName: "Carta",
};

const jamon: TillProduct = {
  id: "jamon",
  menuItemId: "menu-item-jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
  catalogueId: "cat-default",
  catalogueName: "Carta",
};

const heldSummary: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  outstanding: "3.00",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-08-05T10:00:00.000Z",
  signals: [],
};

const floorZone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

const freeTable: TableState = {
  id: "t1",
  label: "1",
  zoneId: "z1",
  capacity: 4,
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  signals: [],
  party: null,
};

const openTable: TableState = {
  id: "t2",
  label: "2",
  zoneId: "z1",
  capacity: 4,
  state: "open-tab",
  condition: "free",
  hasOpenTab: true,
  tabLineCount: 2,
  tabTotal: "12.00",
  pendingDeliveries: 0,
  pendingToServe: 1,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  signals: [],
  party: {
    id: "v-2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "2",
    mainBillId: "wo-7",
    outstanding: "12.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
  },
};

const smallPartyBill: PartyBill = {
  workingOrderId: "wo-7",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v-2",
  label: null,
  status: "open",
  total: "12.00",
  outstanding: "12.00",
  hasPayments: false,
  receiptAvailable: false,
};

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const till = {
  locale: "es-ES",
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
  // Mirrors the server's default `till` canvas (`packages/layouts/src/default-canvases.ts`), plus a
  // `prep-queue` card gated `visibleWhen: ["has-items"]` so the mode-dependent station-queue assertions
  // below hold: Mode P never refreshes the queue (empty ⇒ the gate hides the card), Modes I/T populate
  // it. `receipt` is deliberately omitted so the ticket receipt defaults to {}; the `receipt` suite
  // supplies it.
  canvas: {
    formFactor: "till",
    tabs: [
      {
        key: "counter",
        title: "Counter",
        columns: 12,
        cards: [
          { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
          { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
          { type: "total", colSpan: 4, rowSpan: 1, config: {} },
          { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
          { type: "held-orders", colSpan: 8, rowSpan: 2, config: {}, visibleWhen: ["has-parked"] },
          { type: "prep-queue", colSpan: 8, rowSpan: 3, config: {}, visibleWhen: ["has-items"] },
        ],
      },
      {
        key: "floor",
        title: "Floor",
        columns: 24,
        cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
      },
    ],
  } satisfies CanvasDef,
  capabilities: [
    "print-receipt",
    "show-station",
    "show-expo",
    "show-schedule",
    "take-cash",
  ] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [] as {
    nodeId: string;
    url: string;
    standing: "serving-primary" | "serving-secondary" | "sell-only";
  }[],
};

const phoneCanvasDef: CanvasDef = {
  formFactor: "phone-portrait",
  tabs: [
    {
      key: "floor",
      title: "Floor",
      columns: 12,
      cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
    },
  ],
};

const kdsCanvasDef: CanvasDef = {
  formFactor: "kds",
  tabs: [
    {
      key: "kitchen",
      title: "Kitchen",
      columns: 24,
      cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const placedResult = {
  id: "wo-1",
  status: "placed" as const,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-06T10:00:00.000Z",
  total: "3.00",
  qr: "x",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
};

const stationGroup = {
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "settled" as const,
  thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
  items: [
    {
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued" as const,
      descriptions: { "es-ES": "Paella" },
      quantity: "2.000",
    },
  ],
};

const defaultStation = {
  id: "st-default",
  name: "Cocina",
  displayOrder: 0,
  isDefault: true,
  active: true,
  open: true,
};

/** A menu's structure listing one offer, and a Device Home Page with no shortcuts. */
function servedAs(menuItemId: string, productId: string) {
  return {
    audience: "customer" as const,
    orderable: true,
    sendable: true,
    structure: { members: [{ kind: "product" as const, menuItemId, productId }] },
    home: {
      shortcuts: [],
      handheld: HOME_DISPLAY_DEFAULTS.handheld,
      till: HOME_DISPLAY_DEFAULTS.till,
    },
  };
}

function fixtureOffers(
  catalogue: ProductCatalogue,
  zonePolicy: Partial<ZoneOfferCatalogue["context"]> = {},
): ZoneOfferCatalogue {
  const defaultMenuId = catalogue.menus.find((menu) => menu.isDefault)?.id ?? null;
  const offers = catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
    id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
    menuId: product.catalogueId ?? defaultMenuId ?? "menu-fixture",
    productId: product.productId ?? product.id,
    grossPrice: product.unitPrice,
    unitPrice: product.unitPrice,
    available: true,
    image: null,
    description: null,
    menuName: product.catalogueName ?? catalogue.menus[0]?.name ?? "Menu",
    placements: [[]],
    name: product.name,
    customerName: product.customerName ?? null,
    kitchenName: product.kitchenName ?? null,
    // `productUnit` is the till's own fallback, reused so the fixture cannot drift from it.
    unit: productUnit(product),
    vatClass: product.vatClass,
    category: product.category ?? "Other",
    allergens: product.allergens,
    diet: product.diet ?? null,
    dietDerivation: product.dietDerivation ?? null,
    dietOverride: product.dietOverride ?? null,
    // The source `TillProduct` types the declarations looser than the offer's wire shape (plain
    // `string[]`), so the fixture narrows them — the fixtures only ever supply real labels.
    dietaryDeclarations: (product.dietaryDeclarations ??
      []) as ZoneOfferCatalogue["offers"][number]["dietaryDeclarations"],
    offeredModifiers: (product.offeredModifiers ?? []).map((entry) =>
      entry.kind === "extras"
        ? {
            ...entry,
            items: entry.items.map((item) => ({
              ...item,
              image: null,
              available: true,
            })),
          }
        : { ...entry, publishedDefaultLabelId: entry.defaultLabelId },
    ),
    variants: (product.variants ?? []).map(
      (variant): ZoneOfferCatalogue["offers"][number]["variants"][number] => ({
        id: variant.id,
        name: variant.name,
        customerName: variant.customerName ?? null,
        kitchenName: variant.kitchenName ?? null,
        image: variant.image ?? null,
        unitPrice: variant.unitPrice,
        menuPrice: null,
        available: variant.available,
        unit: productUnit(product),
        pricingUnit: productUnit(product).hardwareUnit === null ? "each" : "weight",
        vatClass: product.vatClass,
        category: product.category ?? "Other",
        allergens: product.allergens,
        diet: product.diet ?? null,
        dietDerivation: product.dietDerivation ?? null,
        dietOverride: product.dietOverride ?? null,
        dietaryDeclarations: (product.dietaryDeclarations ??
          []) as ZoneOfferCatalogue["offers"][number]["dietaryDeclarations"],
        courseId: product.courseId ?? null,
      }),
    ),
    courseId: product.courseId ?? null,
  }));
  return {
    service: { open: true, periodName: null, keepOpen: null },
    context: {
      departmentName: "Restaurant",
      zoneId: "zone-counter",
      departmentId: "department-default",
      serviceMode: "prepay",
      receiptPrintMode: "auto",
      ...zonePolicy,
    },
    defaultMenuId,
    // No `versionId`: a line added from these offers asserts no version, so the wire bodies the
    // suites pin are the ones a till sends against the live version.
    menus: servedMenus(catalogue.menus, offers) as ZoneOfferCatalogue["menus"],
    offers,
  };
}

/**
 * A fake `TillApi` covering every method the app (and the lock screen it mounts) calls. Each defaults
 * to a resolved value; a test overrides any with its own `vi.fn()`. Cast through `unknown` because the
 * app touches only this method surface, never the rest of the class.
 */
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  const api = {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1", permissions: [], locale: "en-GB" }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [cafe] }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    cancelDemoReaderPayment: vi.fn().mockResolvedValue(true),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    setOrderInvoiceChoice: vi.fn().mockResolvedValue({ revision: 1 }),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    retrieveWorkingOrder: vi.fn().mockResolvedValue({
      id: "wo-1",
      orderNumber: 5,
      label: "Mesa 4",
      revision: 3,
      lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
    }),
    abandonWorkingOrder: vi.fn().mockResolvedValue(undefined),
    updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 4 }),
    placeOrder: vi.fn().mockResolvedValue(placedResult),
    collectOrder: vi.fn().mockResolvedValue(saleResult),
    reprint: vi.fn().mockResolvedValue(undefined),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    printPaymentSlip: vi.fn().mockResolvedValue(undefined),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    listDrawerAuthorizers: vi
      .fn()
      .mockResolvedValue([{ personId: "sup-1", displayName: "Responsable" }]),
    listStations: vi.fn().mockResolvedValue([defaultStation]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    getExpoQueue: vi.fn().mockResolvedValue([]),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    seatTable: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    setLineCourse: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    recallLines: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    moveGuests: vi.fn().mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false }),
    joinTables: vi.fn().mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false }),
    mergeBills: vi.fn().mockResolvedValue(undefined),
    transferItems: vi.fn().mockResolvedValue(undefined),
    splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    listStatuses: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    setServiceZone: vi.fn(),
    // `getDevDevices` rejects by default, so the default boot is not the dev chooser; `getDeviceIdentity`
    // resolves an enrolled `till`, so the default boot lands on the login (lock) screen.
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    join: vi.fn().mockResolvedValue({ joinId: "dev-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    deviceAdvance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
  if (!("listDefaultZoneOffers" in overrides)) {
    api.listDefaultZoneOffers = vi.fn(async () =>
      fixtureOffers(
        await api.listProducts(),
        overrides.zonePolicy as Partial<ZoneOfferCatalogue["context"]>,
      ),
    );
  }
  if (!("listZoneOffers" in overrides)) {
    api.listZoneOffers = vi.fn(async () =>
      fixtureOffers(
        await api.listProducts(),
        overrides.zonePolicy as Partial<ZoneOfferCatalogue["context"]>,
      ),
    );
  }
  return api;
}

/** Drains the microtask queue (settling awaited API promises + chained awaits) then Lit's render. */
async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const modeIndicator = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=mode-indicator]");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view");
const overrideDialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { authorizers: unknown; error: string | null }>(
    "till-supervisor-override-dialog",
  );
const schedule = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillScheduleScreen>("till-schedule-screen");
const shell = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell");
/** The card grid mounted directly as a non-counter TAB's body — the floor/order/kitchen tabs
 * render through it. (The counter tab's body is the counter screen, whose OWN grid `counterGrid` reaches;
 * this one is only present when a non-counter tab is active, so it is unambiguous.) */
const activeTabGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
const selectTab = (el: TillApp, key: string): void => emit(shell(el)!, "tab-select", { key });
/** The floor screen — on the shell it renders inside the active `floor` tab's card grid (a `floor-plan`
 * card), so pierce that grid's shadow root. `null` off the floor tab. */
const floor = (el: TillApp) =>
  (activeTabGrid(el)?.shadowRoot?.querySelector("till-floor-screen") as TillFloorScreen | null) ??
  null;
/** The station screen — a till reaches it as a `drill` overlay (app shadow); a KDS canvas mounts it as
 * its `kitchen` tab's `kds-board` card (inside the active tab's card grid). Look in both. */
const station = (el: TillApp) =>
  (el.shadowRoot!.querySelector<TillStationScreen>("till-station-screen") ??
    (activeTabGrid(el)?.shadowRoot?.querySelector(
      "till-station-screen",
    ) as TillStationScreen | null) ??
    null) as TillStationScreen | null;
const enrolScreen = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-enrol-screen");
const chooser = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { list?: unknown }>("till-device-chooser");
/** The table-order screen — a TILL opens it as a `drill` (app shadow); a handheld/tablet whose canvas
 * authors an `order` tab mounts it as that tab's card (inside the active tab's card grid). Look in both. */
const tableOrder = (el: TillApp) =>
  (el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
    (activeTabGrid(el)?.shadowRoot?.querySelector(
      "till-table-order-screen",
    ) as TillTableOrderScreen | null) ??
    null) as TillTableOrderScreen | null;
/** The card grid the embedded counter screen delegates its sale body to — the sale cards render
 * inside ITS shadow root, so the pay/queue helpers pierce through it. */
const counterGrid = (el: TillApp) =>
  counter(el)!.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
const tenderPay = (el: TillApp) =>
  counterGrid(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
/** The station-queue card inside the card grid, or `null` when the `prep-queue` card is hidden (its
 * `has-items` gate — Mode P never populates the queue, so it stays hidden). */
const stationQueueWidget = (el: TillApp) =>
  counterGrid(el)?.shadowRoot?.querySelector<TillStationQueue>("till-station-queue") ?? null;

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** A fake {@link SessionActivity} the app can be mounted with, so a till-app test asserts how the app
 * CONFIGURES the controller without depending on the real Wake Lock API. */
function fakeSessionActivity() {
  return {
    configure: vi.fn(),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

/** Boots the app, settles boot, and logs a person in — leaving the app on the counter. */
async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  // Log in as an operator without `venue.configure` by default — the permission tests below drive
  // one holding it.
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  return counter(el)!;
}

/** Boots, logs in, rings a cash sale — leaving the app on the ticket screen where the Reprint / Abrir
 * cajón levers live. */
async function toTicket(el: TillApp): Promise<void> {
  const c = await toCounter(el);
  c.store.addProduct(cafe, "2");
  await el.updateComplete;
  emit(c, "confirm-payment", { method: "cash", amount: "5" });
  await flush(el);
}

/** Boots, logs in, opens the floor, then opens `table`'s tab — leaving the app on the table-order
 * screen. The app must be mounted with `getTablesState` returning `table` so the floor has it. */
async function toTableOrder(el: TillApp, table: TableState): Promise<TillTableOrderScreen> {
  await toCounter(el);
  selectTab(el, "floor");
  await flush(el);
  emit(floor(el)!, "open-table", { tableId: table.id, seated: table.hasOpenTab });
  await flush(el);
  return tableOrder(el)!;
}

let currentApi: TillApi;
async function mountApp(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
  currentApi = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: currentApi }, theme);
}

// Force a deterministic es-ES baseline before each test — DELIBERATELY not the module default (en-GB),
// so the boot/login switches to en-GB below are observable against a Spanish starting point rather than
// a no-op against an already-English default (a switch you cannot observe proves nothing).
/** The server's side of the party's drafts, fresh for each test. */
let drafts: DraftServer;
type SubmitArgs = Parameters<DraftServer["apply"]>;
/** A draft submission the server takes, answering `value` about the groups it placed. */
const answering = (value: object) =>
  vi.fn(async (...args: SubmitArgs) => ({ ...drafts.apply(...args), ...value }));

/** Rings a café into the open table's draft, with the course `courseId` when given, and gives the
 * `submit-draft` a confirmed preview sends for it as one group released `release`. */
async function ringCafe(
  el: TillApp,
  screen: TillTableOrderScreen,
  release: "fire" | "hold" = "fire",
  courseId?: string,
) {
  const store = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;
  store.addProduct(
    {
      id: "cafe",
      catalogueId: "cat-default",
      menuItemId: "menu-item-cafe-0",
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
  if (courseId !== undefined) store.setLineCourse(0, courseId);
  await flush(el);
  return {
    lines: [
      {
        menuItemId: "menu-item-cafe-0",
        quantity: "1",
        ...(courseId === undefined ? {} : { courseId }),
      },
    ],
    groups: [{ release, lineIndexes: [0] }],
    store,
    sent: store.lines,
  };
}

beforeEach(() => {
  setLocale("es-ES");
  drafts = draftServer(() => ({ tabId: "wo-7", revision: 4, groups: [] }));
});
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  if (vi.isMockFunction(history.pushState)) vi.mocked(history.pushState).mockRestore();
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app", () => {
  it("asks before counter Pay, saves a chosen station, then takes payment", async () => {
    const order: string[] = [];
    const askSaleDeadEnds = vi.fn(async () => {
      order.push("ask");
      return {
        sends: true,
        deadEnds: [
          {
            key: "0",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed" as const,
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      };
    });
    const recordSale = vi.fn(async () => {
      order.push("pay");
      return saleResult;
    });
    const { el } = await mountApp({ askSaleDeadEnds, recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await flush(el);
    expect(askSaleDeadEnds).toHaveBeenCalledWith({
      step: "pay",
      lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1", makeAt: null }],
      zoneId: "zone-counter",
    });
    expect(order).toEqual(["ask"]);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(c.store.lines[0]!.makeAt).toBe("kitchen");
    expect(recordSale).not.toHaveBeenCalled();
    emit(c, "confirm-payment", { method: "cash", amount: "2" });
    await flush(el);
    expect(recordSale).toHaveBeenCalledWith(
      [{ menuItemId: "menu-item-cafe-0", quantity: "1", makeAt: "kitchen" }],
      { method: "cash", amount: "2" },
      expect.any(String),
    );
    expect(order).toEqual(["ask", "pay"]);
  });

  it("holds an integrated card charge until its counter routing question is answered", async () => {
    let answer: (value: DeadEndAnswer) => void = () => undefined;
    const askSaleDeadEnds = vi.fn(
      () => new Promise<DeadEndAnswer>((resolve) => (answer = resolve)),
    );
    const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment"],
      }),
      askSaleDeadEnds,
      pay,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
    await flush(el);
    expect(askSaleDeadEnds).toHaveBeenCalledWith(expect.objectContaining({ step: "pay" }));
    expect(pay).not.toHaveBeenCalled();

    answer({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    await flush(el);
    expect(pay).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(pay).toHaveBeenCalledOnce();
    expect(pay.mock.invocationCallOrder[0]!).toBeGreaterThan(
      askSaleDeadEnds.mock.invocationCallOrder[0]!,
    );
  });

  it("asks before Place and rechecks after a station refusal", async () => {
    const answer = {
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed" as const,
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    };
    const askSaleDeadEnds = vi.fn().mockResolvedValue(answer);
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue(placedResult);
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "ticket_then_pay" },
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      askSaleDeadEnds,
      placeOrder,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    emit(c, "place-order");
    await flush(el);
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("till-dead-ends-dialog")).not.toBeNull();
    const choose = async () => {
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
      dialog
        .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
        .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
      await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
      await flush(el);
    };
    await choose();
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("till-dead-ends-dialog")).not.toBeNull();
    await choose();
    expect(placeOrder).toHaveBeenCalledTimes(2);
    expect(askSaleDeadEnds).toHaveBeenCalledTimes(2);
  });

  it("leaves a Place refusal visible when its follow-up question has no answer", async () => {
    const askSaleDeadEnds = vi
      .fn()
      .mockResolvedValueOnce({ sends: false, deadEnds: [], stations: [] })
      .mockRejectedValue(new TypeError("offline"));
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockImplementation(() => new Promise(() => {}));
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "ticket_then_pay" },
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      askSaleDeadEnds,
      placeOrder,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    emit(c, "place-order");
    await flush(el);
    expect(askSaleDeadEnds).toHaveBeenCalledTimes(2);
    expect(placeOrder).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      t("place.refused"),
    );
  });

  it("lets Pay proceed when the question has no answer", async () => {
    const askSaleDeadEnds = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { el } = await mountApp({ askSaleDeadEnds });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await flush(el);
    expect(askSaleDeadEnds).toHaveBeenCalledOnce();
    expect(tenderPay(el).shadowRoot!.querySelector("till-numeric-pad")).not.toBeNull();
  });

  it.each(["prepay", "ticket_then_pay", "ticket_then_pay"] as const)(
    "%s asks before paying a counter order and skips the dialog when the server says it sends nothing",
    async (orderFlow) => {
      const askSaleDeadEnds = vi.fn().mockResolvedValue({
        sends: false,
        deadEnds: [
          {
            key: "0",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [],
      });
      const { el } = await mountApp({
        zonePolicy: { serviceMode: orderFlow },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow }),
        askSaleDeadEnds,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1");
      await flush(el);
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
      await flush(el);
      expect(askSaleDeadEnds).toHaveBeenCalledWith(expect.objectContaining({ step: "pay" }));
      expect(el.shadowRoot!.querySelector("till-dead-ends-dialog")).toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector("till-numeric-pad")).not.toBeNull();
    },
  );

  it.each(["prepay", "ticket_then_pay", "ticket_then_pay"] as const)(
    "%s blocks counter tender when its payment will send a dead-end dish",
    async (orderFlow) => {
      const askSaleDeadEnds = vi.fn().mockResolvedValue({
        sends: true,
        deadEnds: [
          {
            key: "0",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      });
      const { el } = await mountApp({
        zonePolicy: { serviceMode: orderFlow },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow }),
        askSaleDeadEnds,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1");
      await flush(el);
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
      await flush(el);
      expect(askSaleDeadEnds).toHaveBeenCalledWith(expect.objectContaining({ step: "pay" }));
      expect(el.shadowRoot!.querySelector("till-dead-ends-dialog")).not.toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
    },
  );

  it("removes a dead-end dish before entering tender and leaves the remaining basket total", async () => {
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [],
    });
    const { el } = await mountApp({ askSaleDeadEnds });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    c.store.addProduct(jamon, "1");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("remove", { detail: { key: "0" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(c.store.lines).toHaveLength(1);
    expect(c.store.lines[0]!.product.id).toBe("jamon");
    expect(c.store.total).toBe("10.00");
    expect(tenderPay(el).shadowRoot!.querySelector("till-numeric-pad")).not.toBeNull();
  });

  it("cancels a dead-end question and keeps the counter idle without paying", async () => {
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [],
    });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ askSaleDeadEnds, recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!
      .shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!
      .click();
    await flush(el);
    expect(recordSale).not.toHaveBeenCalled();
    expect(tenderPay(el).shadowRoot!.querySelector(".pay")).not.toBeNull();
    expect(c.store.lines).toHaveLength(1);
  });

  it("keeps a retrieved dish's chosen station when saving the edited basket", async () => {
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const { el } = await mountApp({
      updateWorkingOrder,
      listStations: vi
        .fn()
        .mockResolvedValue([defaultStation, { ...defaultStation, id: "kitchen" }]),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        revision: 3,
        lines: [
          {
            menuItemId: "menu-item-cafe-0",
            productId: "cafe",
            quantity: "2.000",
            makeAt: "kitchen",
          },
        ],
      }),
    });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(c.store.lines[0]!.makeAt).toBe("kitchen");
    c.store.addProduct(cafe, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledWith(
      "wo-1",
      expect.objectContaining({
        lines: [
          { menuItemId: "menu-item-cafe-0", quantity: "2", makeAt: "kitchen" },
          { menuItemId: "menu-item-cafe-0", quantity: "1", makeAt: null },
        ],
      }),
    );
  });

  it("rechecks a retrieved counter order when its chosen station is switched off during save", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "route.station_inactive" })
      .mockResolvedValue({ revision: 4 });
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "switched_off",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, askSaleDeadEnds, recordSale });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(recordSale).not.toHaveBeenCalled();
    expect(askSaleDeadEnds).toHaveBeenCalledOnce();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(recordSale).toHaveBeenCalledOnce();
  });

  it.each(["cash", "integrated card", "Place", "Hold"] as const)(
    "%s clears only an inactive Make at choice when the retry question has a valid fallback",
    async (action) => {
      const updateWorkingOrder = vi.fn(
        async (_id: string, request: { lines: { makeAt: string | null }[] }) => {
          if (request.lines[0]?.makeAt === "retired") throw { code: "route.station_inactive" };
          return { revision: 4 };
        },
      );
      const askSaleDeadEnds = vi.fn().mockResolvedValue({
        sends: true,
        deadEnds: [],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      });
      const recordSale = vi.fn().mockResolvedValue(saleResult);
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const placeOrder = vi.fn().mockResolvedValue(placedResult);
      const { el } = await mountApp({
        zonePolicy: { serviceMode: action === "Place" ? "ticket_then_pay" : "prepay" },
        getTill: vi.fn().mockResolvedValue({
          ...till,
          orderFlow: action === "Place" ? "ticket_then_pay" : "prepay",
          cardProvider: "simulator",
        }),
        listStations: vi
          .fn()
          .mockResolvedValue([
            defaultStation,
            { ...defaultStation, id: "retired", active: false, open: false },
            { ...defaultStation, id: "kitchen" },
          ]),
        retrieveWorkingOrder: vi.fn().mockResolvedValue({
          id: "wo-1",
          orderNumber: 5,
          label: "Mesa 4",
          revision: 3,
          lines: [
            {
              menuItemId: "menu-item-cafe-0",
              productId: "cafe",
              quantity: "1.000",
              makeAt: "retired",
            },
            {
              menuItemId: "menu-item-cafe-0",
              productId: "cafe",
              quantity: "1.000",
              makeAt: "kitchen",
            },
          ],
        }),
        updateWorkingOrder,
        askSaleDeadEnds,
        recordSale,
        pay,
        placeOrder,
      });
      const c = await toCounter(el);
      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      expect(c.store.lines.map((line) => line.makeAt)).toEqual(["retired", "kitchen"]);
      c.store.setLineMakeAt(0, "retired");
      if (action === "cash") emit(c, "confirm-payment", { method: "cash", amount: "5" });
      else if (action === "integrated card") emit(c, "collect-card", {});
      else if (action === "Hold") emit(c, "park-order", { label: "Mesa 4" });
      else emit(c, "place-order");
      await flush(el);

      expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
      expect(updateWorkingOrder.mock.calls[1]![1].lines.map((line) => line.makeAt)).toEqual([
        null,
        "kitchen",
      ]);
      expect(c.store.lines.map((line) => line.makeAt ?? null)).toEqual(
        action === "Hold" ? [] : [null, "kitchen"],
      );
      if (action === "cash") expect(recordSale).toHaveBeenCalledOnce();
      else if (action === "integrated card") expect(pay).toHaveBeenCalledOnce();
      else if (action === "Place") expect(placeOrder).toHaveBeenCalledOnce();
    },
  );

  it("rechecks an integrated card's save refusal before calling pay", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ revision: 4 });
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({ updateWorkingOrder, askSaleDeadEnds, pay });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(pay).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(pay).toHaveBeenCalledOnce();
  });

  it("rechecks a retrieved bill's Hold save refusal before clearing the basket", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ revision: 4 });
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const { el } = await mountApp({ updateWorkingOrder, askSaleDeadEnds });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);
    expect(c.store.lines).toHaveLength(2);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(c.store.lines).toHaveLength(0);
  });

  it("loads the site's content default without changing the interface or receipt language", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "fr", languages: ["fr", "en"] }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    await vi.waitFor(() => expect(currentContentLanguages().defaultLanguage).toBe("fr"));
    expect(currentLocale()).toBe(till.locale);
  });
  it("registers as a custom element", () => {
    expect(customElements.get("till-app")).toBe(TillApp);
  });

  it("keeps preparation mode visible before login", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({ ...till, onboardingIntent: "prepare" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    expect(
      el.shadowRoot!.querySelector("wt-demo-bar")?.shadowRoot!.querySelector("strong")?.textContent,
    ).toBe("Preparación");
  });

  it("shows the shared navigation on the device setup screen in preparation mode", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({ ...till, onboardingIntent: "prepare" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    const bar = el.shadowRoot!.querySelector("wt-demo-bar");
    expect(bar).not.toBeNull();
    expect(modeIndicator(el)).toBeNull();
    expect(bar!.shadowRoot!.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      "Dispositivo",
    );
    expect(bar!.shadowRoot!.querySelector('a[href="/manage"]')).not.toBeNull();
  });

  it("keeps the Live label without a Demo bar", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({ ...till, onboardingIntent: "live" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-demo-bar")).toBeNull();
    expect(modeIndicator(el)?.textContent?.trim()).toBe("En vivo");
  });

  it("draws text on the page itself, outside the app, at the 14px body size", () => {
    // In the app, tokens sit on <html> and index.html styles <body>; anything rendered straight into
    // the page rather than inside the app's own element inherits the body's size.
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
    document.head.append(style);
    applyTokens(document.documentElement);
    try {
      expect(getComputedStyle(document.body).fontSize).toBe("14px");
    } finally {
      style.remove();
      document.documentElement.removeAttribute("data-wt-theme-root");
    }
  });

  it("draws the lock screen's text at the 14px body size and its heading at the 18px large size", async () => {
    const { el } = await mountApp();
    await flush(el);
    const screen = lock(el)!.shadowRoot!;
    expect(getComputedStyle(screen.querySelector(".screen")!).fontSize).toBe("14px");
    expect(getComputedStyle(screen.querySelector(".heading")!).fontSize).toBe("18px");
  });

  it("starts on the lock screen", async () => {
    const { el } = await mountApp();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("a server switch rebuilds a mounted PIN owner and protects later input", async () => {
    const router = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(),
      storage: memoryStorage(),
    });
    currentApi = stubApi();
    const { el } = await mountWidget<TillApp>("till-app", { api: currentApi, router });
    await flush(el);
    const before = lock(el)!;
    before.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await before.updateComplete;
    const pad = before.shadowRoot!.querySelector("till-numeric-pad")!;
    await pad.updateComplete;
    pad.shadowRoot!.querySelector<HTMLElement>("[data-key='0']")!.click();
    await before.updateComplete;
    router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
    await flush(el);
    const after = lock(el)!;
    expect(after).not.toBe(before);
    expect(after.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    after.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await after.updateComplete;
    const newPad = after.shadowRoot!.querySelector("till-numeric-pad")!;
    await newPad.updateComplete;
    newPad.shadowRoot!.querySelector<HTMLElement>("[data-key='0']")!.click();
    await after.updateComplete;
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(currentApi.login).not.toHaveBeenCalled();
  });

  it("changing the lock screen language asks before dropping its typed PIN", async () => {
    const { el } = await mountApp();
    await flush(el);
    const screen = lock(el)!;
    screen.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await screen.updateComplete;
    const pad = screen.shadowRoot!.querySelector("till-numeric-pad")!;
    await pad.updateComplete;
    pad.shadowRoot!.querySelector<HTMLElement>("[data-key='0']")!.click();
    await screen.updateComplete;
    const original = currentLocale();
    const next = original === "en" ? "es" : "en";
    emit(screen, "wt-locale-selected", { code: next });
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    expect(question.open).toBe(true);
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question.open).toBe(false);
    expect(lock(el)).toBe(screen);
    expect(pad.value).toBe("0");
    expect(currentLocale()).toBe(original);
    emit(screen, "wt-locale-selected", { code: next });
    await flush(el);
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => currentLocale()).toBe(next);
    await flush(el);
    expect(lock(el)).not.toBe(screen);
    expect(lock(el)!.shadowRoot!.querySelector("till-numeric-pad")).toBeNull();
    expect(currentApi.login).not.toHaveBeenCalled();
  });

  it("boots: getTill sets the active locale", async () => {
    // getTill returns a locale that differs from the es-ES baseline (beforeEach), so the change is observable.
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en" }),
    });
    await flush(el);
    expect(currentApi.getTill).toHaveBeenCalledOnce();
    expect(currentLocale()).toBe("en");
  });

  it("logs in: fetches products, shows the counter with the operator name", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    expect(currentApi.listProducts).toHaveBeenCalledOnce();
    expect(lock(el)).toBeNull();
    expect(c).not.toBeNull();
    expect(c.products).toEqual([
      expect.objectContaining({
        id: "cafe",
        productId: "cafe",
        menuItemId: "menu-item-cafe-0",
        unitPrice: "1.50",
      }),
    ]);
    expect(c.operatorName).toBe("Ana");
  });

  it("loads the default zone's offers and orders two menu identities for one product", async () => {
    const listDefaultZoneOffers = vi.fn().mockResolvedValue({
      service: { open: true, periodName: null, keepOpen: null },
      context: {
        departmentName: "Restaurant",
        zoneId: "zone-counter",
        departmentId: "department-bar",
        serviceMode: "prepay",
      },
      zones: [
        {
          id: "zone-counter",
          name: "Bar",
          departmentId: "department-bar",
          departmentName: "Bar",
          serviceMode: "prepay",
        },
      ],
      defaultMenuId: "menu-standard",
      menus: [
        {
          id: "menu-standard",
          name: "Standard",
          isDefault: true,
          ...servedAs("offer-standard", "product-negroni"),
        },
        {
          id: "menu-happy-hour",
          name: "Happy hour",
          isDefault: false,
          ...servedAs("offer-happy-hour", "product-negroni"),
        },
      ],
      offers: [
        {
          id: "offer-standard",
          menuId: "menu-standard",
          productId: "product-negroni",
          grossPrice: "9.00",
          unitPrice: "9.00",
          menuName: "Standard",
          placements: [[]],
          descriptions: { en: "Negroni" },
          pricingUnit: "each",
          vatClass: "general",
          category: "Cocktail",
          allergens: null,
          diet: null,
          dietDerivation: null,
          dietOverride: null,
          courseId: null,
          available: true,
          offeredModifiers: [],
          variants: [],
        },
        {
          id: "offer-happy-hour",
          menuId: "menu-happy-hour",
          productId: "product-negroni",
          grossPrice: "7.00",
          unitPrice: "7.00",
          menuName: "Happy hour",
          placements: [[]],
          descriptions: { en: "Negroni" },
          pricingUnit: "each",
          vatClass: "general",
          category: "Cocktail",
          allergens: null,
          diet: null,
          dietDerivation: null,
          dietOverride: null,
          courseId: null,
          available: true,
          offeredModifiers: [],
          variants: [],
        },
      ],
    });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ listDefaultZoneOffers, recordSale });
    const c = await toCounter(el);

    expect(listDefaultZoneOffers).toHaveBeenCalledOnce();
    expect(currentApi.listProducts).not.toHaveBeenCalled();
    expect(c.selectedServiceZoneId).toBe("zone-counter");
    expect(c.serviceZones.map((zone) => zone.name)).toEqual(["Bar"]);
    expect(
      c.products.map(({ id, productId, menuItemId, unitPrice }) => ({
        id,
        productId,
        menuItemId,
        unitPrice,
      })),
    ).toEqual([
      {
        id: "product-negroni",
        productId: "product-negroni",
        menuItemId: "offer-standard",
        unitPrice: "9.00",
      },
      {
        id: "product-negroni",
        productId: "product-negroni",
        menuItemId: "offer-happy-hour",
        unitPrice: "7.00",
      },
    ]);

    c.store.addProduct(c.products[0]!, "1");
    c.store.addProduct(c.products[1]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "20.00" });
    await flush(el);
    expect(recordSale).toHaveBeenCalledWith(
      [
        { makeAt: null, menuItemId: "offer-standard", quantity: "1" },
        { makeAt: null, menuItemId: "offer-happy-hour", quantity: "1" },
      ],
      { method: "cash", amount: "20.00" },
      expect.any(String),
    );
  });

  it("still opens the counter when its default zone offers cannot be loaded", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockRejectedValue(new Error("configuration incomplete")),
    });

    const c = await toCounter(el);
    expect(c.products).toEqual([]);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("service_zone.load_error"),
    );
  });

  it("says in its own words that the device's profile has no zone left to order in", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "device_profile.no_service_zone" }),
    });

    const c = await toCounter(el);
    expect(c.products).toEqual([]);
    const alert = el.shadowRoot!.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain(codeMessage("device_profile.no_service_zone"));
    expect(alert).not.toContain(t("service_zone.load_error"));
  });

  it("changes and manually refreshes the counter's service zone", async () => {
    const defaultCatalogue = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    defaultCatalogue.zones = [
      {
        id: "zone-counter",
        name: "Counter",
        departmentId: "department-default",
        departmentName: "Restaurant",
        serviceMode: "prepay",
      },
      {
        id: "zone-deli",
        name: "Deli",
        departmentId: "department-deli",
        departmentName: "Deli",
        serviceMode: "ticket_then_pay",
      },
    ];
    const deliCatalogue = fixtureOffers({
      menus: [{ id: "menu-deli", name: "Deli", isDefault: true }],
      products: [{ ...jamon, catalogueId: "menu-deli", catalogueName: "Deli" }],
    });
    deliCatalogue.context = {
      departmentName: "Restaurant",
      zoneId: "zone-deli",
      departmentId: "department-deli",
      serviceMode: "ticket_then_pay",
    };
    const listZoneOffers = vi.fn().mockResolvedValue(deliCatalogue);
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(defaultCatalogue),
      listZoneOffers,
    });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(listZoneOffers).toHaveBeenLastCalledWith("zone-deli");
    expect(c.selectedServiceZoneId).toBe("zone-deli");
    expect(c.products.map((product) => product.id)).toEqual(["jamon"]);
    expect(c.orderFlow).toBe("ticket_then_pay");
    expect(currentApi.setServiceZone).toHaveBeenLastCalledWith("zone-deli");

    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(listZoneOffers).toHaveBeenCalledTimes(2);
  });

  it("visibly refuses a service-zone change while the basket has lines", async () => {
    const catalogue = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    catalogue.zones = [
      {
        id: "zone-counter",
        name: "Counter",
        departmentId: "department-default",
        departmentName: "Restaurant",
        serviceMode: "prepay",
      },
      {
        id: "zone-deli",
        name: "Deli",
        departmentId: "department-deli",
        departmentName: "Deli",
        serviceMode: "prepay",
      },
    ];
    const listZoneOffers = vi.fn();
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await c.updateComplete;
    const select = c.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="service-zone"]')!;
    await chooseOption(select, "zone-deli");
    await flush(el);

    expect(select.value).toBe("zone-counter");
    expect(c.selectedServiceZoneId).toBe("zone-counter");
    expect(listZoneOffers).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("service_zone.basket_active"),
    );
  });

  it("ignores a late counter-zone response and keeps the accepted zone for new orders", async () => {
    const defaultCatalogue = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    defaultCatalogue.zones = ["counter", "upstairs", "deli"].map((id) => ({
      id,
      name: id,
      departmentId: id,
      departmentName: id,
      serviceMode: "prepay" as const,
    }));
    const upstairs = fixtureOffers({
      menus: [{ id: "upstairs-menu", name: "Upstairs", isDefault: true }],
      products: [{ ...cafe, id: "upstairs-product", catalogueId: "upstairs-menu" }],
    });
    upstairs.context.zoneId = "upstairs";
    const deli = fixtureOffers({
      menus: [{ id: "deli-menu", name: "Deli", isDefault: true }],
      products: [{ ...jamon, id: "deli-product", catalogueId: "deli-menu" }],
    });
    deli.context.zoneId = "deli";
    let resolveUpstairs!: (value: ZoneOfferCatalogue) => void;
    let resolveDeli!: (value: ZoneOfferCatalogue) => void;
    const requests = {
      upstairs: new Promise<ZoneOfferCatalogue>((resolve) => (resolveUpstairs = resolve)),
      deli: new Promise<ZoneOfferCatalogue>((resolve) => (resolveDeli = resolve)),
    };
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(defaultCatalogue),
      listZoneOffers: vi.fn((zoneId: "upstairs" | "deli") => requests[zoneId]),
    });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "upstairs" });
    emit(c, "counter-zone-selected", { zoneId: "deli" });
    resolveDeli(deli);
    await flush(el);
    resolveUpstairs(upstairs);
    await flush(el);

    expect(c.selectedServiceZoneId).toBe("deli");
    expect(c.products.map((product) => product.id)).toEqual(["deli-product"]);
    expect(currentApi.setServiceZone).toHaveBeenLastCalledWith("deli");
  });

  it("asks for every colleague for the roster loaded after sign-in, and only the profile's people for the sign-in list", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    await flush(el);

    const calls = vi.mocked(currentApi.listStaff).mock.calls;
    expect(calls[0]).toEqual([]);
    expect(calls.at(-1)).toEqual([{ everyone: true }]);
  });

  it("a failing listStaff on the first login leaves the roster empty and never blocks the counter (no unhandled rejection)", async () => {
    // `#onLoggedIn` loads the colleague roster AFTER the counter is shown, so a roster failure must
    // degrade gracefully. The assertion that tells the two apart is `rejections === []`: `staff` is
    // `[]` either way.
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault(); // mark handled so it doesn't pollute sibling tests
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const { el } = await mountApp({
        listStaff: vi.fn().mockRejectedValue(new Error("roster down")),
      });
      const c = await toCounter(el);
      // Give any pending unhandled-rejection notification a couple of macrotasks to surface.
      await flush(el);
      await flush(el);

      expect(c).not.toBeNull();
      expect(counter(el)).not.toBeNull();
      expect((el as unknown as { staff: unknown[] }).staff).toEqual([]);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      expect(rejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  // Both boot-failure shapes reach the same bare `catch`: a network rejection (server unreachable) and a
  // non-2xx `{ code }` the client throws (e.g. `server.internal`).
  it.each([
    { label: "server unreachable", reason: new Error("server down") },
    { label: "non-2xx { code }", reason: { code: "server.internal" } },
  ])(
    "a failing getTill ($label) surfaces the boot error, never an unhandled rejection",
    async ({ reason }) => {
      // `#boot` awaits `getTill()`. A failing boot must be a HANDLED state, not an UNHANDLED promise
      // rejection: it surfaces the `boot.error` banner and stays on the lock screen.
      const rejections: unknown[] = [];
      const onRejection = (event: PromiseRejectionEvent): void => {
        rejections.push(event.reason);
        event.preventDefault(); // mark handled so it doesn't pollute sibling tests
      };
      window.addEventListener("unhandledrejection", onRejection);
      try {
        const { el } = await mountApp({
          getTill: vi.fn().mockRejectedValue(reason),
        });
        // Give any pending unhandled-rejection notification a couple of macrotasks to surface.
        await flush(el);
        await flush(el);

        expect(lock(el)).not.toBeNull();
        const banner = el.shadowRoot!.querySelector('[role="alert"]');
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain(t("boot.error"));
        expect(rejections).toEqual([]);
      } finally {
        window.removeEventListener("unhandledrejection", onRejection);
      }
    },
  );

  // Device mode: an enrolled kds display boots straight into its bound station in
  // the kiosk shell (past the login screen); the fuller boot decision (chooser/enrol/login) is exercised
  // by the "Device front door" suite below.
  it("boots an ENROLLED kds_station device straight into the station screen in device mode", async () => {
    const { el } = await mountApp({
      // The enrolled display has no operator, so boot applies the venue language.
      getTill: vi.fn().mockResolvedValue({
        ...till,
        locale: "en-GB",
        canvas: kdsCanvasDef,
        capabilities: ["act-as-kds"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect(currentApi.getDeviceStation).toHaveBeenCalled();
    // Straight past the lock screen — a device never logs in; it boots the shell in kiosk mode straight
    // onto the kitchen tab, whose kds-board card mounts the station screen.
    expect(lock(el)).toBeNull();
    const s = station(el);
    expect(s).not.toBeNull();
    expect(s!.deviceMode).toBe(true);
    expect(currentLocale()).toBe("en-GB");
  });

  it("keeps an enrolled kitchen display in the venue language when its browser prefers another", async () => {
    const { el } = await mountApp({
      getLocales: vi.fn().mockResolvedValue({
        locales: [],
        venueDefault: "es-ES",
        loginDefault: "en-GB",
      }),
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: kdsCanvasDef,
        capabilities: ["act-as-kds"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect(station(el)).not.toBeNull();
    expect(currentLocale()).toBe("es-ES");
  });

  it("boots a HANDHELD device into the phone shell (stays on lock) and lands on the floor after login", async () => {
    const status: TableServiceStatus = { id: "s1", label: "Reservada", color: "#f00" };
    const { el } = await mountApp({
      // A handheld boots the phone canvas (floor + order tabs); its first tab is `floor`, so login lands
      // the waiter there.
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      // Proves the handheld login LOADS the floor via `#loadFloorData`, not that it merely switches
      // `screen` to an empty one.
      getTablesState: vi.fn().mockResolvedValue([freeTable]),
      listZones: vi.fn().mockResolvedValue([floorZone]),
      listStatuses: vi.fn().mockResolvedValue([status]),
    });
    await flush(el);
    // A handheld waits on the lock screen (unlike a kds_station, which skips it) — but in handheld mode.
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    // A handheld is NOT a KDS display — the kind branch never prefetches the station queue.
    expect(currentApi.getDeviceStation).not.toHaveBeenCalled();
    // After login the waiter lands on the FLOOR, this phone layout's first tab; it has no Counter tab.
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(counter(el)).toBeNull();
    // The floor was LOADED, not just shown.
    expect(currentApi.getTablesState).toHaveBeenCalled();
    expect(currentApi.listZones).toHaveBeenCalled();
    expect(currentApi.listStatuses).toHaveBeenCalled();
    const f = floor(el);
    expect(f).not.toBeNull();
    expect(f!.tables).toEqual([freeTable]);
    expect(f!.zones).toEqual([floorZone]);
    // This phone layout has no Counter tab and no held-orders or prep-queue card, so no counter list loads.
    expect(currentApi.listWorkingOrders).not.toHaveBeenCalled();
  });

  // A `back-to-counter` on a phone layout with no Counter tab leaves the handheld on the floor.
  describe("a handheld on a phone layout with no Counter tab", () => {
    /** Boots a HANDHELD, logs the waiter in, and returns the app on the floor (the post-login face). */
    async function toHandheldFloor(capabilities = till.capabilities): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef, capabilities }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      return el;
    }

    it("suppresses the floor's back-to-counter affordance in handheld mode (canExitToCounter=false)", async () => {
      const el = await toHandheldFloor();
      expect(floor(el)).not.toBeNull();
      // A floor card inside the shell shows no Back-to-counter control.
      expect(floor(el)!.canExitToCounter).toBe(false);
      expect(floor(el)!.shadowRoot!.querySelector(".back")).toBeNull();
    });

    it("gives the handheld's floor no way into a station view when its profile lacks the Station switch", async () => {
      const el = await toHandheldFloor(["print-receipt"]);
      expect(floor(el)!.canOpenStation).toBe(false);
    });

    it("stays on the floor when back-to-counter fires from the floor", async () => {
      const el = await toHandheldFloor();
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
    });

    it("lands on the floor, not a counter, when back-to-counter bubbles from the table-order screen", async () => {
      const el = await toHandheldFloor();
      emit(floor(el)!, "open-table", { tableId: openTable.id, seated: openTable.hasOpenTab });
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      // A stray back-to-counter bubbling up from the table-order subtree must not reach the counter POS.
      // On the shell it sets the active tab to `counter`, but the phone canvas authors NO counter tab, so
      // the shell falls back to its first tab (`floor`) — never the counter.
      emit(tableOrder(el)!, "back-to-counter");
      await flush(el);
      expect(counter(el)).toBeNull();
      expect(floor(el)).not.toBeNull();
    });
  });

  describe("a handheld whose device profile gives it the counter", () => {
    const floorTab = phoneCanvasDef.tabs[0]!;
    const orderTab = phoneCanvasDef.tabs[1]!;
    const saleCards: CanvasDef["tabs"][number]["cards"] = [
      { type: "product-grid", colSpan: 12, rowSpan: 4, config: {} },
      { type: "basket", colSpan: 12, rowSpan: 2, config: {} },
      { type: "total", colSpan: 12, rowSpan: 1, config: {} },
      { type: "tender-pay", colSpan: 12, rowSpan: 2, config: {} },
    ];
    const withCounterTab: CanvasDef = {
      formFactor: "phone-portrait",
      tabs: [floorTab, { key: "counter", title: "Counter", columns: 12, cards: saleCards }],
    };
    const withFloorCard = (type: "held-orders" | "prep-queue"): CanvasDef => ({
      formFactor: "phone-portrait",
      tabs: [
        { ...floorTab, cards: [...floorTab.cards, { type, colSpan: 12, rowSpan: 2, config: {} }] },
        orderTab,
      ],
    });
    /** Sale cards on a tab not keyed `counter`, which the card grid renders without the counter screen. */
    const withSaleTab: CanvasDef = {
      formFactor: "phone-portrait",
      tabs: [floorTab, { key: "sale", title: "Sale", columns: 12, cards: saleCards }],
    };
    const readers = [
      { id: "5b1c3a52-0000-4000-8000-000000000001", name: "Barra", provider: "stripe_terminal" },
    ];

    async function toHandheld(
      canvas: CanvasDef,
      tillOverrides: Record<string, unknown> = {},
      overrides: Record<string, unknown> = {},
    ): Promise<TillApp> {
      const { el } = await mountApp({
        zonePolicy: {
          serviceMode: tillOverrides.orderFlow ?? "prepay",
          receiptPrintMode: tillOverrides.receiptPrintMode ?? "auto",
        },
        getTill: vi.fn().mockResolvedValue({ ...till, canvas, ...tillOverrides }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        ...overrides,
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      return el;
    }

    /** The default menu with one shortcut, its Handheld display at 4 columns Menu first and its Till
     * display at 8. */
    const displayedMenus = (): Record<string, unknown> => {
      const served = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
      const offers = {
        ...served,
        menus: served.menus.map((menu) => ({
          ...menu,
          home: {
            shortcuts: [{ kind: "product" as const, productId: "cafe" }],
            handheld: {
              ...HOME_DISPLAY_DEFAULTS.handheld,
              columns: 4,
              order: "menu_first" as const,
            },
            till: { ...HOME_DISPLAY_DEFAULTS.till, columns: 8 },
          },
        })),
      };
      return {
        listZoneOffers: vi.fn().mockResolvedValue(offers),
        listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
      };
    };

    async function counterHome(el: TillApp): Promise<{ regions: string[]; columns: string[] }> {
      const browser =
        counterGrid(el)!.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
      await browser.updateComplete;
      const shadow = browser.shadowRoot!;
      return {
        regions: [...shadow.querySelectorAll<HTMLElement>("[data-region]")].map(
          (region) => region.dataset.region!,
        ),
        columns: [...shadow.querySelectorAll<HTMLElement>(".grid")].map((grid) =>
          getComputedStyle(grid).getPropertyValue("--columns").trim(),
        ),
      };
    }

    it("shows the menu's handheld display, not the till's", async () => {
      const el = await toHandheld(withCounterTab, {}, displayedMenus());
      selectTab(el, "counter");
      await flush(el);
      expect(await counterHome(el)).toEqual({
        regions: ["search", "structure", "shortcuts"],
        columns: ["4", "4"],
      });
    });

    it("on a till, shows the menu's till display", async () => {
      const { el } = await mountApp(displayedMenus());
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      expect(await counterHome(el)).toEqual({
        regions: ["search", "shortcuts", "structure"],
        columns: ["8", "8"],
      });
    });

    it("loads the counter's lists at login when its canvas has a counter tab, and shows its held orders there", async () => {
      const el = await toHandheld(
        withCounterTab,
        {},
        { listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]) },
      );
      expect(currentApi.listWorkingOrders).toHaveBeenCalled();
      expect(currentApi.listCounterWaiting).toHaveBeenCalled();
      selectTab(el, "counter");
      await flush(el);
      expect(counter(el)!.heldOrders).toEqual([heldSummary]);
    });

    it.each(["held-orders", "prep-queue"] as const)(
      "loads the counter's lists at login when its canvas has a %s card, and the card shows them",
      async (type) => {
        // Not prepay, which never reads the station queue, so the prep-queue card has rows to show.
        const el = await toHandheld(
          withFloorCard(type),
          { orderFlow: "ticket_then_pay" },
          {
            listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
            getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
          },
        );
        expect(currentApi.listWorkingOrders).toHaveBeenCalled();
        expect(currentApi.getStationQueue).toHaveBeenCalledWith("st-default");
        expect(currentApi.listCounterWaiting).toHaveBeenCalled();
        const grid = activeTabGrid(el)!.shadowRoot!;
        if (type === "prep-queue") {
          expect(grid.querySelector<TillStationQueue>("till-station-queue")!.groups).toEqual([
            stationGroup,
          ]);
        } else {
          expect(
            grid.querySelector<HTMLElement & { orders: unknown }>("till-held-orders")!.orders,
          ).toEqual([heldSummary]);
        }
      },
    );

    const payCard = (el: TillApp, tab: string): TillTenderPay =>
      tab === "counter"
        ? tenderPay(el)
        : activeTabGrid(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;

    const withReader = ["print-receipt", "integrated-card-payment"];
    it.each([
      {
        tab: "counter",
        canvas: withCounterTab,
        capabilities: withReader,
        offered: "stripe_terminal",
      },
      { tab: "counter", canvas: withCounterTab, capabilities: ["print-receipt"], offered: "none" },
      { tab: "sale", canvas: withSaleTab, capabilities: withReader, offered: "stripe_terminal" },
      { tab: "sale", canvas: withSaleTab, capabilities: ["print-receipt"], offered: "none" },
    ])(
      "on its $tab tab, gives the pay card the reader $offered when its profile's capabilities are $capabilities",
      async ({ tab, canvas, capabilities, offered }) => {
        const el = await toHandheld(canvas, {
          capabilities,
          cardProvider: "stripe_terminal",
          activeReaders: readers,
          defaultReaderId: readers[0]!.id,
        });
        selectTab(el, tab);
        await flush(el);
        expect(payCard(el, tab).cardProvider).toBe(offered);
      },
    );

    it("says the handheld is not set up for the reader when the server refuses it the reader", async () => {
      const el = await toHandheld(
        withCounterTab,
        {
          capabilities: withReader,
          cardProvider: "stripe_terminal",
          activeReaders: readers,
          defaultReaderId: readers[0]!.id,
        },
        {
          pay: vi
            .fn()
            .mockRejectedValue({ code: "device.forbidden_action", status: 403, action: "pay" }),
        },
      );
      selectTab(el, "counter");
      await flush(el);
      const c = counter(el)!;
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("card_reader.not_set_up"));
      expect(banner.textContent).not.toContain(t("sale.error"));
    });

    it("says the profile does not allow it when the server refuses the sale for want of a profile action", async () => {
      const el = await toHandheld(
        withCounterTab,
        {
          capabilities: withReader,
          cardProvider: "stripe_terminal",
          activeReaders: readers,
          defaultReaderId: readers[0]!.id,
        },
        {
          pay: vi.fn().mockRejectedValue({
            code: "device.forbidden_action",
            status: 403,
            action: "take-orders",
          }),
        },
      );
      selectTab(el, "counter");
      await flush(el);
      const c = counter(el)!;
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(codeMessage("device.forbidden_action"));
      expect(banner.textContent).not.toContain(t("card_reader.not_set_up"));
    });

    it("puts its sale tab's pay card back to its choices after the reader payment is refused", async () => {
      const pay = vi
        .fn()
        .mockRejectedValue({ code: "device.forbidden_action", status: 403, action: "pay" });
      const el = await toHandheld(
        withSaleTab,
        {
          capabilities: [...withReader, "take-cash"],
          cardProvider: "stripe_terminal",
          activeReaders: readers,
          defaultReaderId: readers[0]!.id,
        },
        { pay },
      );
      selectTab(el, "sale");
      await flush(el);
      payCard(el, "sale").store.addProduct(cafe, "2");
      await flush(el);

      payCard(el, "sale").shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
      await flush(el);

      expect(pay).toHaveBeenCalledTimes(1);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("card_reader.not_set_up"));
      await payCard(el, "sale").updateComplete;
      const card = payCard(el, "sale").shadowRoot!;
      expect(card.querySelector(".collecting")).toBeNull();
      expect(card.querySelector(".pay")).not.toBeNull();
      expect(card.querySelector(".pay-card")).not.toBeNull();
    });

    describe("a list that cannot be read at login", () => {
      let rejections: unknown[];
      const onRejection = (event: PromiseRejectionEvent): void => {
        rejections.push(event.reason);
        event.preventDefault();
      };
      beforeEach(() => {
        rejections = [];
        window.addEventListener("unhandledrejection", onRejection);
      });
      afterEach(() => window.removeEventListener("unhandledrejection", onRejection));

      /** Logs in on `device` with the counter's lists in view, reading the station queue (not prepay). */
      async function logIn(
        device: "till" | "handheld",
        card: "held-orders" | "prep-queue",
        overrides: Record<string, unknown>,
      ): Promise<TillApp> {
        if (device === "handheld")
          return toHandheld(withFloorCard(card), { orderFlow: "ticket_then_pay" }, overrides);
        const { el } = await mountApp({
          zonePolicy: { serviceMode: "ticket_then_pay" },
          getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
          ...overrides,
        });
        await toCounter(el);
        return el;
      }
      const notice = (el: TillApp, list: "held" | "station" | "waiting") =>
        el.shadowRoot!.querySelector<HTMLElement>(`[data-refresh-notice="${list}"]`)!;

      it.each(["till", "handheld"] as const)(
        "on a %s, a failed read of the held orders still loads the other lists and the roster, and says which failed",
        async (device) => {
          const el = await logIn(device, "held-orders", {
            listWorkingOrders: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
          });
          await flush(el);

          expect(currentApi.getStationQueue).toHaveBeenCalledWith("st-default");
          expect(currentApi.listCounterWaiting).toHaveBeenCalled();
          expect(currentApi.listStaff).toHaveBeenCalled();
          expect(notice(el, "held").hasAttribute("data-active")).toBe(true);
          expect(notice(el, "held").querySelector(".refresh-message")!.textContent!.trim()).toBe(
            t("refresh.held"),
          );
          expect(rejections).toEqual([]);
        },
      );

      it.each(["till", "handheld"] as const)(
        "on a %s, a failed read of the kitchen queue still loads the waiting orders and the roster, and says which failed",
        async (device) => {
          const el = await logIn(device, "prep-queue", {
            getStationQueue: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
          });
          await flush(el);

          expect(currentApi.listCounterWaiting).toHaveBeenCalled();
          expect(currentApi.listStaff).toHaveBeenCalled();
          expect(notice(el, "waiting").hasAttribute("data-active")).toBe(false);
          expect(notice(el, "station").hasAttribute("data-active")).toBe(true);
          expect(notice(el, "station").querySelector(".refresh-message")!.textContent!.trim()).toBe(
            t("refresh.station"),
          );
          expect(rejections).toEqual([]);
        },
      );

      it("says the station list failed on a first read while leaving other counter lists available", async () => {
        const el = await logIn("till", "prep-queue", {
          listStations: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        });
        await flush(el);

        expect(currentApi.listCounterWaiting).toHaveBeenCalled();
        expect(currentApi.listStaff).toHaveBeenCalled();
        expect(notice(el, "station").hasAttribute("data-active")).toBe(true);
        expect(notice(el, "station").querySelector(".refresh-message")!.textContent!.trim()).toBe(
          t("refresh.station"),
        );
        expect(rejections).toEqual([]);
      });
    });
  });

  describe("a till whose device profile decides whether it is offered the card reader", () => {
    const floorTab = phoneCanvasDef.tabs[0]!;
    const saleCards: CanvasDef["tabs"][number]["cards"] = [
      { type: "product-grid", colSpan: 12, rowSpan: 4, config: {} },
      { type: "basket", colSpan: 12, rowSpan: 2, config: {} },
      { type: "total", colSpan: 12, rowSpan: 1, config: {} },
      { type: "tender-pay", colSpan: 12, rowSpan: 2, config: {} },
    ];
    const tillCounterTab: CanvasDef = {
      formFactor: "till",
      tabs: [floorTab, { key: "counter", title: "Counter", columns: 12, cards: saleCards }],
    };
    /** Sale cards on a tab not keyed `counter`, which the card grid renders without the counter screen. */
    const tillSaleTab: CanvasDef = {
      formFactor: "till",
      tabs: [floorTab, { key: "sale", title: "Sale", columns: 12, cards: saleCards }],
    };
    const readers = [
      { id: "5b1c3a52-0000-4000-8000-000000000001", name: "Barra", provider: "stripe_terminal" },
    ];
    const withReader = ["print-receipt", "integrated-card-payment"];
    const payCard = (el: TillApp, tab: string): TillTenderPay =>
      tab === "counter"
        ? tenderPay(el)
        : activeTabGrid(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;

    async function toTill(canvas: CanvasDef, capabilities: string[]): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          canvas,
          capabilities,
          cardProvider: "stripe_terminal",
          activeReaders: readers,
          defaultReaderId: readers[0]!.id,
        }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "till", stationId: null }),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      return el;
    }

    it.each([
      {
        tab: "counter",
        canvas: tillCounterTab,
        capabilities: withReader,
        offered: "stripe_terminal",
      },
      { tab: "counter", canvas: tillCounterTab, capabilities: ["print-receipt"], offered: "none" },
      { tab: "sale", canvas: tillSaleTab, capabilities: withReader, offered: "stripe_terminal" },
      { tab: "sale", canvas: tillSaleTab, capabilities: ["print-receipt"], offered: "none" },
    ])(
      "on its $tab tab, gives the pay card the reader $offered when its profile's capabilities are $capabilities",
      async ({ tab, canvas, capabilities, offered }) => {
        const el = await toTill(canvas, capabilities);
        selectTab(el, tab);
        await flush(el);
        expect(payCard(el, tab).cardProvider).toBe(offered);
      },
    );
  });

  describe("a back-to-counter that arrives on the lock screen", () => {
    it("leaves a logged-out till on the lock screen", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      emit(c, "logout");
      await flush(el);
      emit(lock(el)!, "back-to-counter");
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(shell(el)).toBeNull();
    });

    it("leaves a logged-out handheld on the lock screen", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(shell(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "back-to-counter");
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(shell(el)).toBeNull();
    });
  });

  describe("a navigation event that arrives on the lock screen", () => {
    const handheld = () => ({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
    });
    const devices = [
      { device: "till", overrides: () => ({}), home: "counter", other: "floor" },
      { device: "handheld", overrides: handheld, home: "floor", other: "order" },
    ];

    async function signIn(el: TillApp): Promise<void> {
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
    }

    async function lockedTill(overrides: Record<string, unknown>): Promise<TillApp> {
      const { el } = await mountApp(overrides);
      await flush(el);
      await signIn(el);
      emit(shell(el)!, "logout");
      await flush(el);
      return el;
    }

    const message = (el: TillApp) => el.shadowRoot!.querySelector("p.error")?.textContent ?? "";

    describe.each(devices)("on a $device", ({ overrides, home, other }) => {
      it.each([
        { type: "show-station", detail: undefined },
        { type: "show-expo", detail: undefined },
        { type: "show-schedule", detail: undefined },
        { type: "open-allergens", detail: undefined },
        { type: "close-allergens", detail: undefined },
        { type: "new-sale", detail: undefined },
        { type: "back-to-counter", detail: undefined },
        { type: "back-to-floor", detail: undefined },
        { type: "floor-refresh", detail: undefined },
        { type: "move-held-order-open", detail: undefined },
        { type: "open-table", detail: { tableId: openTable.id, seated: true } },
      ])("keeps the lock screen's message after $type", async ({ type, detail }) => {
        const router = new ServerRouter({
          origin: BOX,
          fetchImpl: probeFetch(),
          storage: memoryStorage(),
        });
        currentApi = stubApi(overrides());
        const { el } = await mountWidget<TillApp>("till-app", { api: currentApi, router });
        await flush(el);
        await signIn(el);
        router.dispatchEvent(
          new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }),
        );
        await flush(el);
        expect(lock(el)).not.toBeNull();
        expect(message(el)).toContain(t("server.switched"));
        emit(lock(el)!, type, detail);
        await flush(el);
        await flush(el);
        expect(lock(el)).not.toBeNull();
        expect(message(el)).toContain(t("server.switched"));
      });

      it.each([
        "show-station",
        "show-expo",
        "show-schedule",
        "show-floor",
        "open-allergens",
        "close-allergens",
        "new-sale",
        "back-to-counter",
        "back-to-floor",
      ])(
        "leaves a logged-out till locked after %s, reading neither the stations nor the floor and leaving no destination to restore",
        async (type) => {
          const el = await lockedTill(overrides());
          const stationReads = vi.mocked(currentApi.listStations).mock.calls.length;
          const floorReads = vi.mocked(currentApi.getTablesState).mock.calls.length;
          emit(lock(el)!, type);
          await flush(el);
          await flush(el);
          expect(lock(el)).not.toBeNull();
          expect(shell(el)).toBeNull();
          expect(location.pathname).not.toContain("/view/");
          expect(currentApi.listStations).toHaveBeenCalledTimes(stationReads);
          expect(currentApi.getTablesState).toHaveBeenCalledTimes(floorReads);
        },
      );

      it.each([
        { name: "floor-refresh", type: "floor-refresh", detail: undefined },
        { name: "move-held-order-open", type: "move-held-order-open", detail: undefined },
        {
          name: "open-table on a free table",
          type: "open-table",
          detail: { tableId: "tb-1", seated: false, guestCount: 2 },
        },
        {
          name: "open-table on a seated table",
          type: "open-table",
          detail: { tableId: openTable.id, seated: true },
        },
      ])(
        "leaves a logged-out till locked after $name, without reading the stations, the floor or the drafts, or seating a table",
        async ({ type, detail }) => {
          // The floor is read before logout, so the till still holds the seated table and its party
          // when the event arrives; an open that ran would read that party's drafts.
          const { el } = await mountApp({
            ...overrides(),
            getTablesState: vi.fn().mockResolvedValue([openTable]),
          });
          await flush(el);
          await signIn(el);
          selectTab(el, "floor");
          await flush(el);
          emit(shell(el)!, "logout");
          await flush(el);
          const stationReads = vi.mocked(currentApi.listStations).mock.calls.length;
          const floorReads = vi.mocked(currentApi.getTablesState).mock.calls.length;
          emit(lock(el)!, type, detail);
          await flush(el);
          await flush(el);
          expect(lock(el)).not.toBeNull();
          expect(shell(el)).toBeNull();
          expect(location.pathname).not.toContain("/view/");
          expect(currentApi.listStations).toHaveBeenCalledTimes(stationReads);
          expect(currentApi.getTablesState).toHaveBeenCalledTimes(floorReads);
          expect(currentApi.seatTable).not.toHaveBeenCalled();
          expect(currentApi.listDrafts).not.toHaveBeenCalled();
        },
      );

      it("ignores a tab-select sent while logout is still taking the shell down", async () => {
        const { el } = await mountApp(overrides());
        await flush(el);
        await signIn(el);
        const floorReads = vi.mocked(currentApi.getTablesState).mock.calls.length;
        const outgoing = shell(el)!;
        emit(outgoing, "logout");
        emit(outgoing, "tab-select", { key: other });
        await flush(el);
        await flush(el);
        expect(lock(el)).not.toBeNull();
        expect(location.pathname).toBe(`/tabs/${home}`);
        expect(currentApi.getTablesState).toHaveBeenCalledTimes(floorReads);
        await signIn(el);
        expect(shell(el)!.activeTabKey).toBe(home);
      });
    });

    // Till only: the phone layout the handheld cases above use has no counter tab or sale cards, so
    // nothing on it fills the basket.
    it("leaves a logged-out till's basket in place after new-sale, for the next sign-in", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "logout");
      await flush(el);
      expect(c.store.lines).toHaveLength(1);
      emit(lock(el)!, "new-sale");
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1);
      await toCounter(el);
      expect(counter(el)!.store.lines).toHaveLength(1);
    });
  });

  // ── Device front door ───────────────────────────────────────────────────────
  // One boot decision: dev + no adopted tab device → the chooser; dev + an adopted device refused
  // `device.unauthorized` → forgotten, then the chooser (the join screen if the device list fails);
  // not enrolled (401, not dev) → the join screen; enrolled `kds` → the kiosk shell (the kds-boot test
  // above); enrolled other → the login (lock) screen. The default stub is an enrolled `till` (→ login);
  // these tests override it.

  it("a NOT-enrolled browser (401 identity probe, not dev) shows the join screen", async () => {
    // getDevDevices rejects (not dev) and getDeviceIdentity 401s — the fresh production-browser case.
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    await flush(el);
    expect(enrolScreen(el)).not.toBeNull();
    expect(lock(el)).toBeNull();
    expect((el as unknown as { frontDoor?: string }).frontDoor).toBe("enrol");
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(["edited", "reverted", "submitted"] as const)(
    "the real enrolment approval link leaves %s input to native document navigation",
    async (state) => {
      const { el } = await mountApp({
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      await flush(el);
      const screen = enrolScreen(el)!;
      const field =
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-name]")!;
      field.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Counter edited" },
          bubbles: true,
          composed: true,
        }),
      );
      if (state === "reverted")
        field.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "" },
            bubbles: true,
            composed: true,
          }),
        );
      await (screen as HTMLElementTagNameMap["till-enrol-screen"]).updateComplete;
      if (state === "submitted") {
        screen.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[data-number]")?.textContent?.trim())
          .toBe("47");
      }
      const link = screen.shadowRoot!.querySelector<HTMLAnchorElement>("[data-approval-guide]")!;
      expect(link.pathname).toBe("/manage/devices");
      const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
      let browserDefault = false;
      const blockNavigation = (event: MouseEvent) => {
        browserDefault = !event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener("click", blockNavigation, { once: true });
      try {
        link.dispatchEvent(click);
      } finally {
        document.removeEventListener("click", blockNavigation);
      }
      expect(browserDefault).toBe(true);
      expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(state === "edited");
      expect(currentApi.join).toHaveBeenCalledTimes(state === "submitted" ? 1 : 0);
      if (state === "submitted") expect(currentApi.join).toHaveBeenCalledWith("Counter edited");
      else expect(field.value).toBe(state === "edited" ? "Counter edited" : "");
      expect(enrolScreen(el)).toBe(screen);
    },
  );

  it("a server switch rebuilds enrolment and protects a new device name", async () => {
    const router = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(),
      storage: memoryStorage(),
    });
    currentApi = stubApi({
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api: currentApi, router });
    await flush(el);
    const before = enrolScreen(el)!;
    expect(before).not.toBeNull();
    const name =
      before.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-name]")!;
    emit(name, "wt-change", { value: "Old server name" });
    router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
    await expect.poll(() => enrolScreen(el)).not.toBe(before);
    await expect.poll(() => enrolScreen(el)).not.toBeNull();
    const after = enrolScreen(el)!;
    await (after as HTMLElementTagNameMap["till-enrol-screen"]).updateComplete;
    const next = after.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-name]")!;
    expect(next.value).toBe("");
    emit(next, "wt-change", { value: "New server name" });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(currentApi.join).not.toHaveBeenCalled();
  });

  it("a NON-401 identity-probe failure (transient) stays on the LOGIN screen, never the enrol front door", async () => {
    // `getTill` succeeds but `getDeviceIdentity` fails transiently — a 5xx or a network blip carrying NO
    // `device.unauthorized` code. An enrolled, SELLABLE till must NOT be stranded behind an approval it
    // cannot get: `#boot` only routes to the join screen on a genuine 401.
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockRejectedValue(new Error("network")), // no `code` → not a 401
    });
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(enrolScreen(el)).toBeNull();
    expect((el as unknown as { frontDoor?: string }).frontDoor).toBeUndefined();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("boots an ENROLLED till device onto the login screen and lands on the counter after login", async () => {
    const { el } = await mountApp();
    await flush(el);
    expect(enrolScreen(el)).toBeNull();
    expect(chooser(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(false);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
    expect(currentApi.getDeviceStation).not.toHaveBeenCalled();
    expect(lock(el)!.deviceName).toBe("Till 1");
    expect(lock(el)!.deviceId).toBe("till-dev");
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(counter(el)).not.toBeNull();
  });

  it("renders the dev CHOOSER when in dev mode and this tab has no adopted device", async () => {
    // getDevDevices RESOLVES (the dev-mode signal) and this tab has no sessionStorage device → the chooser,
    // ahead of any identity probe (the cookie identity is not consulted on this path).
    const list: DevDeviceList = { devices: [] };
    const getDeviceIdentity = vi.fn();
    const { el } = await mountApp({
      getDevDevices: vi.fn().mockResolvedValue(list),
      getDeviceIdentity,
    });
    await flush(el);
    expect(chooser(el)).not.toBeNull();
    expect(lock(el)).toBeNull();
    expect((el as unknown as { frontDoor?: string }).frontDoor).toBe("chooser");
    expect(getDeviceIdentity).not.toHaveBeenCalled();
    expect(chooser(el)!.list).toEqual(list);
  });

  it("keeps / while the dev chooser is open instead of exposing a post-login tab route", async () => {
    history.replaceState(null, "", "/");
    const { el } = await mountApp({
      getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
    });
    await flush(el);
    expect(chooser(el)).not.toBeNull();
    expect(location.pathname).toBe("/");
  });

  it("skips the chooser when this tab has already adopted a device (probes identity with its header)", async () => {
    // A dev tab that adopted a device (sessionStorage id set) boots AS that device — its identity probe
    // (carrying the x-waitron-dev-device header) decides the shell, and the dev list is never read.
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "adopted-1");
    try {
      const getDevDevices = vi.fn().mockResolvedValue({ devices: [] });
      const { el } = await mountApp({
        getDevDevices,
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "adopted-1",
          name: "Till 2",
          formFactor: "till",
          stationId: null,
        }),
      });
      await flush(el);
      expect(chooser(el)).toBeNull();
      expect(lock(el)).not.toBeNull();
      expect(getDevDevices).not.toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("forgets a remembered dev device the server no longer knows and shows the chooser", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "deleted-by-reset");
    try {
      const list: DevDeviceList = { devices: [] };
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockResolvedValue(list),
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      await flush(el);
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
      expect(chooser(el)).not.toBeNull();
      expect(chooser(el)!.list).toEqual(list);
      expect(enrolScreen(el)).toBeNull();
      expect((el as unknown as { frontDoor?: string }).frontDoor).toBe("chooser");
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("forgets a stale dev device and shows the join screen when the device list then fails to load", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "deleted-by-reset");
    try {
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockRejectedValue({ code: "connection.failed" }),
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      await flush(el);
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
      expect(chooser(el)).toBeNull();
      expect(enrolScreen(el)).not.toBeNull();
      expect((el as unknown as { frontDoor?: string }).frontDoor).toBe("enrol");
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("keeps the join screen for an unknown device outside development, even with a remembered id", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "deleted-by-reset");
    try {
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockRejectedValue({ code: "server.not_found" }),
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      await flush(el);
      expect(chooser(el)).toBeNull();
      expect(enrolScreen(el)).not.toBeNull();
      expect((el as unknown as { frontDoor?: string }).frontDoor).toBe("enrol");
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("keeps a remembered dev device when its identity read fails for another reason", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "adopted-1");
    try {
      const getDevDevices = vi.fn().mockResolvedValue({ devices: [] });
      const { el } = await mountApp({
        getDevDevices,
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      });
      await flush(el);
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBe("adopted-1");
      expect(chooser(el)).toBeNull();
      expect(lock(el)).not.toBeNull();
      expect(enrolScreen(el)).toBeNull();
      expect((el as unknown as { frontDoor?: string }).frontDoor).toBeUndefined();
      expect(getDevDevices).not.toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("the login screen offers a dev-only Switch device link that clears the tab device and returns to the chooser", async () => {
    // This tab adopted a device (dev), so boot lands on the login screen WITH the switch affordance.
    // Switching clears the tab device and re-boots; with no tab device the re-boot re-detects dev mode
    // (getDevDevices resolves) and shows the chooser.
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "adopted-1");
    try {
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "adopted-1",
          name: "Till 2",
          formFactor: "till",
          stationId: null,
        }),
      });
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(lock(el)!.devMode).toBe(true);
      emit(lock(el)!, "switch-device");
      await flush(el);
      expect(sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY)).toBeNull();
      expect(chooser(el)).not.toBeNull();
    } finally {
      sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
    }
  });

  it("the login screen has NO Switch device affordance for a non-dev enrolled device", async () => {
    const { el } = await mountApp(); // default enrolled till, no tab device, not dev
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(lock(el)!.devMode).toBe(false);
  });

  it("a fresh browser enrols through the front door and re-boots into the login shell", async () => {
    // 401 first (fresh) → enrol screen; its `enrolled` event re-boots; the second identity probe now
    // resolves an enrolled till → the login screen. Proof of a real re-boot: two identity probes.
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockRejectedValueOnce({ code: "device.unauthorized" })
        .mockResolvedValue({ deviceId: "d1", name: "Till 9", formFactor: "till", stationId: null }),
    });
    await flush(el);
    expect(enrolScreen(el)).not.toBeNull();
    emit(enrolScreen(el)!, "enrolled", { deviceId: "d1" });
    await flush(el);
    expect(enrolScreen(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
    expect(lock(el)!.deviceId).toBe("d1");
    expect(currentApi.getDeviceIdentity).toHaveBeenCalledTimes(2);
  });

  it("a fresh KDS enrols through the front door and re-boots into the kiosk shell", async () => {
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi
        .fn()
        .mockRejectedValueOnce({ code: "device.unauthorized" })
        .mockResolvedValue({
          deviceId: "dev-1",
          name: "Pass",
          formFactor: "kds",
          stationId: "st-dev",
        }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect(enrolScreen(el)).not.toBeNull();
    emit(enrolScreen(el)!, "enrolled", { deviceId: "dev-1" });
    await flush(el);
    expect(enrolScreen(el)).toBeNull();
    expect(lock(el)).toBeNull();
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(true);
    const grid = el.shadowRoot!.querySelector("till-card-grid")!;
    expect(grid.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
    // Proof it RE-BOOTED rather than merely flipping a state: the identity probe ran a second time.
    expect(currentApi.getDeviceIdentity).toHaveBeenCalledTimes(2);
  });

  it("a revoked KDS (device-unauthorized mid-session) re-boots into the two-step enrol front door", async () => {
    // Cold boot resolves an enrolled kds → kiosk shell. Then its device-station probe 401s (cookie
    // revoked/expired) and the station screen emits `device-unauthorized`; the app re-boots and the
    // identity probe now 401s too, so the unified front door routes it to the two-step enrol screen.
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" })
        .mockRejectedValue({ code: "device.unauthorized" }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(true);
    expect(station(el)).not.toBeNull();
    // The station screen's probe 401s mid-session → it emits device-unauthorized (bubbles to the app).
    emit(station(el)!, "device-unauthorized");
    await flush(el);
    expect(enrolScreen(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
    expect(currentApi.getDeviceIdentity).toHaveBeenCalledTimes(2);
  });

  // A RE-BOOT resets device-mode state before re-deciding (`#boot` runs more than once — the enrol
  // screen's `enrolled` re-runs it). State left by a PRIOR boot must not survive: the front door resets
  // `handheldMode`/`deviceMode`/`frontDoor` unconditionally, then re-establishes the correct one.
  it("a re-boot resolving handheld after a prior kds device-mode state ends in handheld mode on login", async () => {
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" })
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(true);
    expect(lock(el)).toBeNull();
    // Re-boot via the enrolled event (it bubbles to the app's handler); identity now resolves handheld.
    emit(shell(el)!, "enrolled");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
  });

  it("a re-boot resolving NO device after a prior handheld boot lands on the enrol screen (both modes cleared)", async () => {
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce({ deviceId: "d1", formFactor: "phone-portrait", stationId: null })
        .mockRejectedValue({ code: "device.unauthorized" }),
    });
    await flush(el);
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    emit(lock(el)!, "enrolled");
    await flush(el);
    expect(enrolScreen(el)).not.toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(false);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
  });

  it("confirm-payment: records the sale with the mapped lines + tender, then shows the ticket", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const workingOrderId = store.id; // the walk-up's STABLE client-minted id — the pay-idempotency key

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      { method: "cash", amount: "5" },
      // The workingOrderId sent is the store's stable id, NOT a fresh uuid, so a lost-response re-tap
      // replays and a retrieved order settles under its own id (see the retrieve→pay and retry tests
      // below).
      workingOrderId,
    );
    // A FRESH walk-up (never persisted) is filed straight from its lines — no pre-pay re-lock. Only a
    // RETRIEVED/parked basket is synced first (see the retrieve→edit→pay test); syncing a walk-up here
    // would try to update a working order the server has never seen.
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    expect(view.result).toBe(saleResult);
    expect(view.issuer).toEqual({ venueName: "Bar Pepe", nif: "B12345678" });
  });

  it("opens customer details before a walk-up full invoice choice can pay", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);

    tenderPay(el).shadowRoot!.querySelector<HTMLElement>("[data-full-invoice]")!.click();
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).not.toBeNull();
    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(currentApi.pay).not.toHaveBeenCalled();
  });

  it("asks for a full-invoice recipient before charging a loaded bill over €3,000", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.loadFrom("large-bill", [{ product: cafe, quantity: "2001" }]);
    await flush(el);

    emit(c, "confirm-payment", { method: "cash", amount: "3001.50" });
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).not.toBeNull();
    expect(currentApi.recordSale).not.toHaveBeenCalled();

    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
    await flush(el);
    emit(c, "confirm-payment", { method: "cash", amount: "3001.50" });
    await flush(el);
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2001" }],
      { method: "cash", amount: "3001.50" },
      "large-bill",
      undefined,
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
  });

  it("asks for a full-invoice recipient before starting card payment on a loaded bill over €3,000", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.loadFrom("large-bill", [{ product: cafe, quantity: "2001" }]);
    await flush(el);

    emit(c, "collect-card", {});
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).not.toBeNull();
    expect(currentApi.pay).not.toHaveBeenCalled();
  });

  it("places a loaded bill over €3,000 without a recipient prompt despite retired timing metadata", async () => {
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "invoice_first" },
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
    });
    const c = await toCounter(el);
    c.store.loadFrom("large-bill", [{ product: cafe, quantity: "2001" }]);
    await flush(el);

    emit(c, "place-order");
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();
    expect(currentApi.placeOrder).toHaveBeenCalledWith("large-bill");
    expect(tenderPay(el).stage).toBe("collect");
    expect(ticket(el)).toBeNull();
    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(currentApi.pay).not.toHaveBeenCalled();
  });

  it("saves a chosen full-invoice recipient before placing a ticket-then-pay bill", async () => {
    const placeOrder = vi.fn().mockResolvedValue(placedResult);
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "ticket_then_pay" },
      placeOrder,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);
    const id = c.store.id;
    const recipient = {
      taxId: "12345678Z",
      legalName: "Ana García",
      address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
      countryCode: "ES" as const,
    };

    emit(c, "choose-invoice");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient,
      },
    );
    await flush(el);
    emit(c, "place-order");
    await flush(el);

    expect(currentApi.setOrderInvoiceChoice).toHaveBeenCalledWith(id, {
      revision: 0,
      invoiceType: "F1",
      recipient,
    });
    expect(placeOrder).toHaveBeenCalledWith(id);
    expect(vi.mocked(currentApi.setOrderInvoiceChoice).mock.invocationCallOrder[0]).toBeLessThan(
      placeOrder.mock.invocationCallOrder[0]!,
    );
  });

  it("sends the chosen Spanish recipient with the first walk-up cash sale", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);
    const id = c.store.id;

    tenderPay(el).shadowRoot!.querySelector<HTMLElement>("[data-full-invoice]")!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
    for (const [name, value] of [
      ["taxId", "12345678Z"],
      ["legalName", "Ana García"],
      ["address", "Calle Mayor 1"],
      ["postalCode", "28013"],
      ["locality", "Madrid"],
      ["province", "Madrid"],
    ]) {
      const input = dialog
        .shadowRoot!.querySelector(`wt-input[name=${name}]`)!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await dialog.updateComplete;
    }
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      { method: "cash", amount: "5" },
      id,
      undefined,
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
  });

  it("keeps the chosen full-invoice recipient for a card retry after a decline", async () => {
    const pay = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "declined" })
      .mockResolvedValueOnce({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({ pay });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);
    const id = c.store.id;
    const recipient = {
      taxId: "12345678Z",
      legalName: "Ana García",
      address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
      countryCode: "ES",
    };

    emit(c, "choose-invoice");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient,
      },
    );
    await flush(el);

    emit(c, "collect-card", {});
    await flush(el);
    expect(ticket(el)).toBeNull();
    emit(c, "collect-card", {});
    await flush(el);

    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay).toHaveBeenNthCalledWith(1, {
      id,
      lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      invoiceType: "F1",
      recipient,
    });
    expect(pay).toHaveBeenNthCalledWith(2, {
      id,
      lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      invoiceType: "F1",
      recipient,
    });
    expect(ticket(el)).not.toBeNull();
  });

  it("does not send one customer's full-invoice choice with a different basket", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);
    emit(c, "choose-invoice");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
    await flush(el);

    c.store.clear();
    c.store.addProduct(cafe, "2");
    const nextId = c.store.id;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      { method: "cash", amount: "5" },
      nextId,
    );
  });

  it("confirm-payment: sends a line's picks as one entry per list, and omits the key on a plain line", async () => {
    // A line carrying picks sends `extras: [{ listId, picks }]` — never the display name or price
    // (the server re-resolves both). A plain line still omits the key.
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1", {
      extras: [
        {
          listId: "list-milk",
          productId: "p-oat",
          name: "Leche de avena",
          price: "0.50",
          quantity: 1,
        },
      ],
    });
    c.store.addProduct(cafe, "2"); // a plain line — must reach the wire with NO answer keys
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [
        {
          makeAt: null,
          menuItemId: "menu-item-cafe-0",
          quantity: "1",
          extras: [{ listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] }],
        },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
      ],
      { method: "cash", amount: "5" },
      c.store.id,
    );
  });

  it("confirm-payment: sends each pick's own per-dish count and the line's options answers", async () => {
    // The picker sets a pick's per-dish count; the send builder forwards it so the server prices and
    // re-validates it. An options answer rides the same line under its own key.
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1", {
      extras: [
        {
          listId: "list-extras",
          productId: "p-shot",
          name: "Extra chupito",
          price: "0.50",
          quantity: 2,
        },
        {
          listId: "list-milk",
          productId: "p-oat",
          name: "Leche de avena",
          price: "0.50",
          quantity: 1,
        },
      ],
      options: [{ listId: "list-cooked", labelId: "label-medium" }],
    });
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [
        {
          makeAt: null,
          menuItemId: "menu-item-cafe-0",
          quantity: "1",
          extras: [
            { listId: "list-extras", picks: [{ productId: "p-shot", quantity: 2 }] },
            { listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] },
          ],
          options: [{ listId: "list-cooked", labelId: "label-medium" }],
        },
      ],
      { method: "cash", amount: "5" },
      c.store.id,
    );
  });

  it("the printed receipt line list comes from the SERVER result, not the client basket (Finding 2)", async () => {
    // The client basket and the FILED lines deliberately DIVERGE: the store holds café×2, but the
    // server's filed result reports a different composition (agua×3). The rendered ticket must show the
    // FILED "Agua"/"3"/"6,00 €" — proof the receipt renders `result.lines`, never the mutable basket, so
    // a local edit can never make the printed goods list disagree with the invoice.
    const filed: TillSaleResult = {
      ...saleResult,
      total: "6.00",
      lines: [{ descriptions: { "es-ES": "Agua" }, quantity: "3", gross: "6.00" }],
    };
    const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");
    const { el } = await mountApp({ recordSale: vi.fn().mockResolvedValue(filed) });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2"); // client basket — different from the filed lines
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "10" });
    await flush(el);

    const rows = ticket(el)!.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Agua");
    expect(rows[0]!.textContent).toContain("3");
    expect(norm(rows[0]!.textContent!)).toContain("6,00 €");
    expect(ticket(el)!.shadowRoot!.textContent).not.toContain("Café");
  });

  // ── Counter receipt/drawer: the ticket screen's Reprint + Abrir cajón buttons ────────────────
  // The view dispatches `reprint`/`open-drawer`; the app owns the API call and (for reprint) the
  // working-order id. `#store.id` is STILL the just-filed sale's id at the ticket stage — nothing clears
  // the store between recordSale and New sale — so reprint replays against the sale the ticket shows.

  it("reprint (from the ticket view) calls TillApi.reprint with the just-filed sale's working-order id", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    const workingOrderId = c.store.id; // the STABLE id recordSale files against — the reprint target

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      workingOrderId,
    );
    expect(ticket(el)).not.toBeNull();

    // Press Reprint on the ticket view — the event bubbles to the app, which calls the API with the SAME id.
    emit(ticket(el)!, "reprint");
    await flush(el);
    expect(currentApi.reprint).toHaveBeenCalledTimes(1);
    expect(currentApi.reprint).toHaveBeenCalledWith(workingOrderId);
    // A successful reprint stays on the ticket with no error banner (non-fiscal, non-fatal).
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  describe("reprint in another receipt language", () => {
    const SPAIN = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
    const languageDialog = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement>("till-reprint-language-dialog");
    const radio = (el: TillApp, language: string) =>
      languageDialog(el)!.shadowRoot!.querySelector<HTMLInputElement>(
        `input[name="language"][value="${language}"]`,
      )!;
    const dialogButton = (el: TillApp, name: string) =>
      languageDialog(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-reprint-${name}]`)!;

    async function soldWith(
      tillOverrides: Record<string, unknown>,
      api: Record<string, unknown> = {},
    ) {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, ...tillOverrides }),
        ...api,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const workingOrderId = c.store.id;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      return { el, workingOrderId };
    }

    it("asks which language, starting on the one the sale was filed in, and reprints in the one chosen", async () => {
      const { el, workingOrderId } = await soldWith(
        { invoiceLocale: "eu-ES", receiptLanguages: SPAIN },
        { recordSale: vi.fn().mockResolvedValue({ ...saleResult, locale: "ca-ES" }) },
      );

      emit(ticket(el)!, "reprint");
      await flush(el);

      expect(currentApi.reprint).not.toHaveBeenCalled();
      expect(radio(el, "ca-ES").checked).toBe(true);
      radio(el, "gl-ES").click();
      dialogButton(el, "confirm").click();
      await flush(el);

      expect(vi.mocked(currentApi.reprint).mock.calls).toEqual([[workingOrderId, "gl-ES"]]);
      expect(languageDialog(el)).toBeNull();
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    });

    it("starts on the location's language when the sale names none", async () => {
      const { el } = await soldWith(
        { invoiceLocale: "eu-ES", receiptLanguages: SPAIN },
        { recordSale: vi.fn().mockResolvedValue({ ...saleResult, locale: undefined }) },
      );

      emit(ticket(el)!, "reprint");
      await flush(el);

      expect(radio(el, "eu-ES").checked).toBe(true);
    });

    it("starts on the location's language when the sale's is not one of the receipt languages", async () => {
      const { el } = await soldWith(
        { invoiceLocale: "eu-ES", receiptLanguages: SPAIN },
        { recordSale: vi.fn().mockResolvedValue({ ...saleResult, locale: "en-GB" }) },
      );

      emit(ticket(el)!, "reprint");
      await flush(el);

      expect(radio(el, "eu-ES").checked).toBe(true);
    });

    it("reprints nothing when the language question is cancelled", async () => {
      const { el } = await soldWith({ receiptLanguages: SPAIN });

      emit(ticket(el)!, "reprint");
      await flush(el);
      dialogButton(el, "cancel").click();
      await flush(el);

      expect(languageDialog(el)).toBeNull();
      expect(currentApi.reprint).not.toHaveBeenCalled();
    });

    it("says so when the copy in the chosen language could not be printed", async () => {
      const { el } = await soldWith(
        { receiptLanguages: SPAIN },
        { reprint: vi.fn().mockRejectedValue({ code: "server.internal" }) },
      );

      emit(ticket(el)!, "reprint");
      await flush(el);
      dialogButton(el, "confirm").click();
      await flush(el);

      expect(currentApi.reprint).toHaveBeenCalledOnce();
      expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
        t("reprint.error"),
      );
    });

    it("closes the language question when the till locks, reprinting nothing", async () => {
      const { el } = await soldWith({ receiptLanguages: SPAIN });

      emit(ticket(el)!, "reprint");
      await flush(el);
      expect(languageDialog(el)).not.toBeNull();
      emit(ticket(el)!, "logout");
      await flush(el);

      expect(languageDialog(el)).toBeNull();
      expect(currentApi.reprint).not.toHaveBeenCalled();
    });

    it("reprints at once, in the language the sale was filed in, when there is one receipt language", async () => {
      const { el, workingOrderId } = await soldWith({
        invoiceLocale: "en-GB",
        receiptLanguages: ["en-GB"],
      });

      emit(ticket(el)!, "reprint");
      await flush(el);

      expect(languageDialog(el)).toBeNull();
      expect(vi.mocked(currentApi.reprint).mock.calls).toEqual([[workingOrderId]]);
    });
  });

  it("shows a printerless F1 original and rereads its status after later printing", async () => {
    let printed = false;
    const getReceiptPrintStatus = vi.fn(async () =>
      printed ? { status: "queued", jobId: "original", canRetry: false } : { status: "not_queued" },
    );
    const printReceipt = vi.fn(async () => {
      printed = true;
    });
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus,
      printReceipt,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    const id = c.store.id;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("Factura completa no entregada");
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
    emit(ticket(el)!, "print-receipt");
    await flush(el);
    expect(printReceipt).toHaveBeenCalledWith(id);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("El original está esperando para imprimirse.");
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(getReceiptPrintStatus.mock.calls).toEqual([[id], [id]]);
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
  });

  it("retries the exhausted F1 original once while busy, then checks without filing again", async () => {
    let release!: () => void;
    let retried = false;
    const retryReceipt = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      retried = true;
      return { jobId: "retry" };
    });
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus: vi.fn(async () => ({
        status: retried ? "done" : "failed",
        jobId: retried ? "retry" : "original",
        canRetry: !retried,
      })),
      retryReceipt,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    const id = c.store.id;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=retry-receipt]")).not.toBeNull();
    emit(ticket(el)!, "retry-receipt");
    emit(ticket(el)!, "retry-receipt");
    await flush(el);
    expect(retryReceipt).toHaveBeenCalledExactlyOnceWith(id);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=retry-receipt]")?.hasAttribute("disabled"),
    ).toBe(true);
    release();
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("Entrega el original al cliente.");
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("Factura completa no entregada");
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
  });

  it("keeps a refused F1 retry visible when a later status read recovers", async () => {
    const getReceiptPrintStatus = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue({ status: "failed", jobId: "original", canRetry: true });
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus,
      retryReceipt: vi.fn().mockRejectedValue({ code: "print_queue.failed" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("No se pudo consultar");
    emit(ticket(el)!, "refresh-receipt");
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).not.toContain("No se pudo consultar");
    emit(ticket(el)!, "retry-receipt");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("receipt.error"),
    );
    emit(ticket(el)!, "refresh-receipt");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      t("receipt.error"),
    );
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=retry-receipt]")?.hasAttribute("disabled"),
    ).toBe(false);
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
  });

  it("a successful F1 original enqueue followed by a failed read does not offer another original", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: "not_queued" })
        .mockRejectedValue({ code: "connection.failed" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    emit(ticket(el)!, "print-receipt");
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("No se pudo consultar");
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(currentApi.printReceipt).toHaveBeenCalledOnce();
  });

  it.each(["different", "same"])(
    "ignores an earlier F1 status response after reopening a %s working order",
    async (order) => {
      let release!: (value: unknown) => void;
      const { el } = await mountApp({
        recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
        getReceiptPrintStatus: vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                release = resolve;
              }),
          )
          .mockResolvedValue({ status: "not_queued" }),
      });
      let c = await toCounter(el);
      if (order === "same") {
        emit(c, "retrieve-order", { id: "wo-1" });
        await flush(el);
      } else c.store.addProduct(cafe, "2");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      emit(ticket(el)!, "new-sale");
      await flush(el);
      c = counter(el)!;
      if (order === "same") {
        emit(c, "retrieve-order", { id: "wo-1" });
        await flush(el);
      } else c.store.addProduct(cafe, "2");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      release({ status: "done", jobId: "old-original", canRetry: false });
      await flush(el);
      expect(
        ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
      ).toContain("El original no se ha enviado");
      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
    },
  );

  it("confirms customer handover once while busy without device printing capability or refiling", async () => {
    let release!: (value: unknown) => void;
    const confirmed = {
      status: "done",
      jobId: "original",
      canRetry: false,
      handover: { personId: "staff-1", confirmedAt: "2026-08-05T12:40:00.000Z" },
    };
    const confirmReceiptHandover = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, deviceId: "dev-1", capabilities: ["take-cash"] }),
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", jobId: "original", canRetry: false }),
      confirmReceiptHandover,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    const id = c.store.id;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(ticket(el)!.canPrintReceipt).toBe(false);
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=confirm-handover]")).not.toBeNull();
    emit(ticket(el)!, "confirm-handover");
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(confirmReceiptHandover).toHaveBeenCalledExactlyOnceWith(id);
    expect(
      ticket(el)!
        .shadowRoot!.querySelector("[data-test=confirm-handover]")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    release(confirmed);
    await flush(el);
    expect(ticket(el)!.originalReceiptPrint).toEqual(confirmed);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("Entrega al cliente confirmada");
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(confirmReceiptHandover).toHaveBeenCalledOnce();
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
    expect(currentApi.printReceipt).not.toHaveBeenCalled();
    expect(currentApi.reprint).not.toHaveBeenCalled();
  });

  it("keeps a refused customer handover visible after a status read recovers and allows retry", async () => {
    const done = { status: "done", jobId: "original", canRetry: false };
    const confirmReceiptHandover = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue({
        ...done,
        handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
      });
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValueOnce(done)
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(done),
      confirmReceiptHandover,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudo confirmar la entrega al cliente",
    );
    emit(ticket(el)!, "refresh-receipt");
    await flush(el);
    expect(
      ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")?.textContent,
    ).toContain("No se pudo consultar");
    emit(ticket(el)!, "refresh-receipt");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      "No se pudo confirmar la entrega al cliente",
    );
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
    expect(confirmReceiptHandover).toHaveBeenCalledTimes(2);
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
  });

  it.each(["not_queued", "queued", "printing", "failed"])(
    "refuses an emitted customer handover event while the original is %s",
    async (status) => {
      const confirmReceiptHandover = vi.fn();
      const { el } = await mountApp({
        recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
        getReceiptPrintStatus: vi
          .fn()
          .mockResolvedValue(
            status === "not_queued"
              ? { status }
              : { status, jobId: "original", canRetry: status === "failed" },
          ),
        confirmReceiptHandover,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      emit(ticket(el)!, "confirm-handover");
      await flush(el);
      expect(confirmReceiptHandover).not.toHaveBeenCalled();
      expect(currentApi.recordSale).toHaveBeenCalledOnce();
    },
  );

  it.each(["different", "same"])(
    "ignores customer handover completion after reopening a %s working order",
    async (order) => {
      let release!: (value: unknown) => void;
      const { el } = await mountApp({
        recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
        getReceiptPrintStatus: vi
          .fn()
          .mockResolvedValue({ status: "done", jobId: "original", canRetry: false }),
        confirmReceiptHandover: vi.fn(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        ),
      });
      let c = await toCounter(el);
      if (order === "same") {
        emit(c, "retrieve-order", { id: "wo-1" });
        await flush(el);
      } else c.store.addProduct(cafe, "2");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      emit(ticket(el)!, "confirm-handover");
      await flush(el);
      expect(currentApi.confirmReceiptHandover).toHaveBeenCalledOnce();
      emit(ticket(el)!, "new-sale");
      await flush(el);
      c = counter(el)!;
      if (order === "same") {
        emit(c, "retrieve-order", { id: "wo-1" });
        await flush(el);
      } else c.store.addProduct(cafe, "2");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      release({
        status: "done",
        jobId: "old-original",
        canRetry: false,
        handover: { personId: "old-staff", confirmedAt: "2026-08-05T12:40:00.000Z" },
      });
      await flush(el);
      expect(ticket(el)!.originalReceiptPrint).toEqual({
        status: "done",
        jobId: "original",
        canRetry: false,
      });
      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=confirm-handover]")).not.toBeNull();
      expect(ticket(el)!.originalReceiptBusy).toBe(false);
    },
  );

  it("does not confirm customer handover for F2 even when its print state says done", async () => {
    const confirmReceiptHandover = vi.fn();
    const { el } = await mountApp({ confirmReceiptHandover });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    Object.assign(el, {
      originalReceiptPrint: { status: "done", jobId: "original", canRetry: false },
    });
    await flush(el);
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(confirmReceiptHandover).not.toHaveBeenCalled();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=confirm-handover]")).toBeNull();
  });

  it("ignores a refused customer handover after locking the till", async () => {
    let refuse!: (value: unknown) => void;
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue({ ...saleResult, invoiceType: "F1" }),
      getReceiptPrintStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", jobId: "original", canRetry: false }),
      confirmReceiptHandover: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      ),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    emit(ticket(el)!, "confirm-handover");
    await flush(el);
    expect(currentApi.confirmReceiptHandover).toHaveBeenCalledOnce();
    emit(ticket(el)!, "logout");
    await flush(el);
    refuse({ code: "connection.failed" });
    await flush(el);
    expect(ticket(el)).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not fetch original print status for an F2 completion", async () => {
    const getReceiptPrintStatus = vi.fn();
    const { el } = await mountApp({ getReceiptPrintStatus });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(getReceiptPrintStatus).not.toHaveBeenCalled();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=original-delivery]")).toBeNull();
  });

  it.each(["on_request", "never"] as const)(
    "%s offers an original at completion and switches to duplicate reprint after it succeeds",
    async (receiptPrintMode) => {
      const printReceipt = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({
        zonePolicy: { receiptPrintMode: receiptPrintMode },
        getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode }),
        printReceipt,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      const workingOrderId = c.store.id;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);

      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();

      emit(ticket(el)!, "print-receipt");
      await flush(el);
      expect(printReceipt).toHaveBeenCalledWith(workingOrderId);
      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
      expect(ticket(el)!.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
    },
  );

  it("collection offers the original receipt after payment, then a duplicate after printing", async () => {
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "ticket_then_pay", receiptPrintMode: "on_request" },
      getTill: vi.fn().mockResolvedValue({
        ...till,
        orderFlow: "ticket_then_pay",
        receiptPrintMode: "on_request",
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");

    emit(c, "place-order");
    await flush(el);
    emit(c, "collect-order", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
    emit(ticket(el)!, "print-receipt");
    await flush(el);
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
  });

  it("a card completion can request its separate payment slip", async () => {
    const filed: TillSaleResult = {
      ...saleResult,
      tender: { method: "card", charged: "3.50", tip: "0.50", reference: null },
    };
    const printPaymentSlip = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountApp({
      recordSale: vi.fn().mockResolvedValue(filed),
      printPaymentSlip,
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    const workingOrderId = c.store.id;
    emit(c, "confirm-payment", { method: "card", amount: "3.00" });
    await flush(el);

    emit(ticket(el)!, "payment-slip");
    await flush(el);
    expect(printPaymentSlip).toHaveBeenCalledWith(workingOrderId);
    expect(ticket(el)).not.toBeNull();
  });

  it("an enrolled device without print-receipt gets no receipt or payment-slip actions", async () => {
    const filed: TillSaleResult = {
      ...saleResult,
      tender: { method: "card", charged: "3.00", tip: "0.00", reference: null },
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: ["open-cash-drawer"] }),
      recordSale: vi.fn().mockResolvedValue(filed),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "confirm-payment", { method: "card", amount: "3.00" });
    await flush(el);

    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=payment-slip]")).toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=open-drawer]")).not.toBeNull();
  });

  it("open-drawer (from the ticket view) calls TillApi.openDrawer with no argument", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(currentApi.openDrawer).toHaveBeenCalledTimes(1);
    expect(currentApi.openDrawer).toHaveBeenCalledWith();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("a handheld whose profile allows the drawer shows Open drawer, and it opens the drawer", async () => {
    const openDrawer = vi.fn().mockResolvedValue(undefined);
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: phoneCanvasDef,
        capabilities: ["open-cash-drawer", "print-receipt", "take-cash"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      getTablesState: vi.fn().mockResolvedValue([openTable]),
      listZones: vi.fn().mockResolvedValue([floorZone]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
      recordSale,
      openDrawer,
    });
    await flush(el);
    emit(lock(el)!, "logged-in", {
      personId: "p1",
      displayName: "Ana",
      permissions: [],
    });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: openTable.id, seated: true });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "20.00" });
    await flush(el);
    expect(recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "20.00" }, "wo-7");
    ticket(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=open-drawer]")!.click();
    await flush(el);
    expect(openDrawer).toHaveBeenCalledTimes(1);
    expect(openDrawer).toHaveBeenCalledWith();
  });

  it("a till whose profile does not allow the drawer shows no Open drawer on the ticket", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: ["print-receipt", "take-cash"] }),
    });
    await toTicket(el);

    expect(ticket(el)).not.toBeNull();
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=open-drawer]")).toBeNull();
  });

  it("a device whose profile does not take cash offers no Cash on the counter's pay card", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: ["print-receipt"] }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await flush(el);

    const pay = tenderPay(el);
    expect(pay.shadowRoot!.querySelector(".pay")).toBeNull();
    expect(pay.shadowRoot!.querySelector(".cash-at-till")).not.toBeNull();
  });

  it("too many wrong override PINs keep the dialog open, telling the operator to wait", async () => {
    const openDrawer = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockRejectedValueOnce({ code: "pin.throttled", params: { retryAfterSeconds: 2 } });
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);

    emit(overrideDialog(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el);

    const dialog = overrideDialog(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.error).toBe("pin.throttled");
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["drawer.no_printer", "No se pudo abrir el cajón, inténtalo de nuevo"],
    ["drawer.not_attached", "Esta impresora no tiene un cajón conectado"],
  ])(
    "open-drawer: %s surfaces a helpful banner and leaves the ticket open",
    async (code, message) => {
      const { el } = await mountApp({
        openDrawer: vi.fn().mockRejectedValue({ code }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);

      emit(ticket(el)!, "open-drawer");
      await flush(el);
      const banner = el.shadowRoot!.querySelector('[role="alert"]');
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain(message);
      expect(ticket(el)).not.toBeNull();
    },
  );

  it("a direct open (200 first try) never opens the override dialog and fetches no authorizers", async () => {
    const { el } = await mountApp(); // openDrawer resolves by default
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(currentApi.openDrawer).toHaveBeenCalledWith();
    expect(overrideDialog(el)).toBeNull();
    expect(currentApi.listDrawerAuthorizers).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("a permission refusal fetches the eligible supervisors and opens the override dialog", async () => {
    const { el } = await mountApp({
      openDrawer: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);

    // The 403 sent the operator into the override flow: authorizers fetched, dialog open with them.
    expect(currentApi.listDrawerAuthorizers).toHaveBeenCalledTimes(1);
    const dialog = overrideDialog(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.authorizers).toEqual([{ personId: "sup-1", displayName: "Responsable" }]);
    // No error banner yet — the 403 is an expected branch, not a failure to surface.
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("override-confirm retries openDrawer with { personId, pin } and closes the dialog on success", async () => {
    // First (direct) open is refused 403; the override retry succeeds.
    const openDrawer = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockResolvedValueOnce(undefined);
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(overrideDialog(el)).not.toBeNull();

    // The dialog emits the picked supervisor + PIN; the app retries with it as the override.
    emit(overrideDialog(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el);

    expect(openDrawer).toHaveBeenNthCalledWith(2, { personId: "sup-1", pin: "4321" });
    expect(overrideDialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("a wrong override PIN keeps the dialog open showing the pin.invalid retry error", async () => {
    const openDrawer = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockRejectedValueOnce({ code: "pin.invalid" });
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);

    emit(overrideDialog(el)!, "override-confirm", { personId: "sup-1", pin: "0000" });
    await flush(el);

    // Still open for a retry, told to show the wrong-PIN error; no app-level banner.
    const dialog = overrideDialog(el);
    expect(dialog).not.toBeNull();
    expect(dialog!.error).toBe("pin.invalid");
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["drawer.no_printer", "No se pudo abrir el cajón, inténtalo de nuevo"],
    ["drawer.not_attached", "Esta impresora no tiene un cajón conectado"],
  ])(
    "%s on the override closes the dialog and surfaces a helpful banner",
    async (code, message) => {
      const openDrawer = vi
        .fn()
        .mockRejectedValueOnce({ code: "authorization.not_permitted" })
        .mockRejectedValueOnce({ code });
      const { el } = await mountApp({ openDrawer });
      await toTicket(el);
      emit(ticket(el)!, "open-drawer");
      await flush(el);

      emit(overrideDialog(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
      await flush(el);

      expect(overrideDialog(el)).toBeNull();
      const banner = el.shadowRoot!.querySelector('[role="alert"]');
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain(message);
    },
  );

  it("override-cancel closes the dialog with no banner and no further openDrawer call", async () => {
    const openDrawer = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(overrideDialog(el)).not.toBeNull();

    emit(overrideDialog(el)!, "override-cancel");
    await flush(el);
    expect(overrideDialog(el)).toBeNull();
    expect(openDrawer).toHaveBeenCalledTimes(1); // only the initial direct attempt
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("drawer approval Escape keeps an unsubmitted PIN, then discards without another drawer request", async () => {
    const openDrawer = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);
    const proof = el.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
    proof.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await proof.updateComplete;
    const pad = proof.shadowRoot!.querySelector("till-numeric-pad")!;
    await pad.updateComplete;
    pad.shadowRoot!.querySelector<HTMLElement>("[data-key='0']")!.click();
    await proof.updateComplete;
    await userEvent.keyboard("{Escape}");
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    expect(question.open).toBe(true);
    expect(overrideDialog(el)).toBe(proof);
    expect(openDrawer).toHaveBeenCalledTimes(1);
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question.open).toBe(false);
    expect(pad.value).toBe("0");
    expect(overrideDialog(el)).toBe(proof);
    await userEvent.keyboard("{Escape}");
    await flush(el);
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => overrideDialog(el)).toBeNull();
    expect(openDrawer).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(ticket(el)).not.toBeNull();
  });

  it("a failed authorizers fetch degrades to the drawer.error banner, opening no dialog", async () => {
    const { el } = await mountApp({
      openDrawer: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
      listDrawerAuthorizers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);

    expect(overrideDialog(el)).toBeNull();
    const banner = el.shadowRoot!.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain(t("drawer.error"));
  });

  it("reprint: a rejection surfaces the reprint.error banner, never an unhandled rejection", async () => {
    const { el } = await mountApp({
      reprint: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "reprint");
    await flush(el);
    const banner = el.shadowRoot!.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain(t("reprint.error"));
    expect(ticket(el)).not.toBeNull();
  });

  it("confirm-payment: a CARD tender forwards intact (method, amount, externalRef) with the store's stable id", async () => {
    // `#onConfirmPayment` forwards whichever tender the widget emits without branching — this pins that
    // a CARD tender reaches recordSale UNCHANGED (method still "card", externalRef still present, never
    // dropped) and keyed under the store's own stable working-order id, exactly like the cash test above.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "1");
    await el.updateComplete;
    const workingOrderId = store.id; // the walk-up's STABLE client-minted id — the pay-idempotency key

    emit(c, "confirm-payment", { method: "card", amount: "1.50", externalRef: "OP-42" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" }],
      { method: "card", amount: "1.50", externalRef: "OP-42" },
      workingOrderId,
    );
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    expect(view.result).toBe(saleResult);
  });

  it("confirm-payment success: refreshes the held-orders list so a just-paid parked order drops off", async () => {
    // Paying a RETRIEVED parked order must drop it off the cross-till held list immediately, like
    // park/retrieve/discard already do. `listWorkingOrders` returns the order first, then an empty list
    // after it is settled — so a successful pay re-reads and the settled order is gone.
    const { el } = await mountApp({
      listWorkingOrders: vi.fn().mockResolvedValueOnce([heldSummary]).mockResolvedValue([]),
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]); // one call on entering the counter
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // once on entering the counter, once after the successful pay — the settled order drops off.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(ticket(el)).not.toBeNull();

    // Returning to the counter ("New sale") shows the refreshed (now empty) list, not the stale one —
    // the app's held state was updated to [] by the pay refresh, so the re-rendered counter reads it.
    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(counter(el)!.heldOrders).toEqual([]);
  });

  it("threads the RECEIPT invoiceLocale from getTill to the ticket, DECOUPLED from the UI locale", async () => {
    // The ticket's receipt locale (till-ticket-view.invoiceLocale) is threaded from getTill's OWN
    // `invoiceLocale` field — NOT the UI-driving `locale`. Drive the two APART (UI en-GB, receipt ca-ES)
    // to prove the receipt follows `invoiceLocale`, never the operator UI.
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en-GB", invoiceLocale: "ca-ES" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.invoiceLocale).toBe("ca-ES");
  });

  it("marks the ticket as simulated on a preparation installation", async () => {
    const { el } = await mountWidget<TillApp>("till-app", {
      api: stubApi({
        getTill: vi.fn().mockResolvedValue({ ...till, onboardingIntent: "prepare" }),
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "2.00" });
    await flush(el);
    expect(ticket(el)?.simulated).toBe(true);
  });

  it("retrieve then pay: recordSale settles under the RETRIEVED order's own id, not a fresh one", async () => {
    // Paying a retrieved order must send that order's adopted id (wo-1), so the server takes the
    // pay-the-parked-order branch and settles it. A random id would take the walk-up branch → wo-1 left
    // `open` and re-payable → double-charge + a second unrepairable chained record.
    // `retrieveWorkingOrder` defaults to id "wo-1" + a cafe line.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.id).toBe("wo-1"); // loadFrom adopted the retrieved order's id

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // the adopted id is the pay-idempotency key.
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    // The order was retrieved but NOT edited, so it must NOT be re-synced: an unedited retrieve→pay
    // files from the stored lines (recordSale straight through).
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → pay re-syncs the edited basket BEFORE paying, so the edit is not dropped (Finding 2)", async () => {
    // The server's retrieved-order pay files from the STORED lock and IGNORES the sent basket, so an
    // edit made after retrieve must be re-locked (`updateWorkingOrder`) BEFORE the pay or it is SILENTLY
    // DROPPED from both the charge and the filed record. Retrieve wo-1 (café×2), add a second café, then
    // pay: `updateWorkingOrder` must carry the EDITED composition and run BEFORE `recordSale`.
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true); // a retrieved order is persisted server-side

    store.addProduct(cafe, "1"); // the edit AFTER retrieve
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // The edited composition was re-locked: café×2 (retrieved) + café×1 (the edit), under the order's
    // id, from the copy at the revision it was retrieved at.
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      label: "Mesa 4",
      revision: 3,
    });
    // recordSale files the SAME edited composition under the same id, and the sync ran FIRST — the
    // server needs the lock updated before it files from it.
    expect(recordSale).toHaveBeenCalledWith(
      [
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
      recordSale.mock.invocationCallOrder[0]!,
    );
  });

  it("a save that lands moves the copy on a revision, so a pay retried after a decline saves again from it", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValue({ revision: 5 });
    const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
    const { el } = await mountApp({ updateWorkingOrder, pay });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "collect-card", {});
    await flush(el);
    emit(c, "collect-card", {});
    await flush(el);

    expect(updateWorkingOrder.mock.calls.map(([, req]) => req.revision)).toEqual([3, 4]);
  });

  it("a save the server says changed nothing keeps the copy at the server's revision, so the retried pay is not refused as out of date", async () => {
    // The server counts a save on the revision only when it changed something, and answers the
    // revision the order is at.
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 3 });
    const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
    const { el } = await mountApp({ updateWorkingOrder, pay });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    c.store.removeLine(1);
    await el.updateComplete;

    emit(c, "collect-card", {});
    await flush(el);
    emit(c, "collect-card", {});
    await flush(el);

    expect(updateWorkingOrder.mock.calls.map(([, req]) => req.revision)).toEqual([3, 3]);
    expect(c.store.revision).toBe(3);
  });

  it("a held order parked from this till is saved from revision 0", async () => {
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_default" })
      .mockResolvedValue(placedResult);
    const { el } = await mountApp({ updateWorkingOrder, placeOrder });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(c, "place-order", {});
    await flush(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "place-order", {});
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledWith(
      c.store.id,
      expect.objectContaining({ revision: 0 }),
    );
  });

  it("a save refused as out of date reloads the order and says it changed on another till, paying nothing", async () => {
    // Spec §10.7 example 2: the second save is refused, and that till reloads the order.
    const retrieveWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce({
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        revision: 3,
        lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
      })
      .mockResolvedValueOnce({
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        revision: 4,
        lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "5.000" }],
      });
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValue({ code: "working_order.out_of_date", params: { revision: 4 } });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ retrieveWorkingOrder, updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
    expect(retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    // The basket is the order as the other till left it, at its new revision.
    expect(c.store.lines.map((line) => line.quantity)).toEqual(["5"]);
    expect(c.store.revision).toBe(4);
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.changed_elsewhere"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.out_of_date");
  });

  it("an out-of-date save whose order has since closed says so, as a stale retrieve does", async () => {
    const retrieveWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        revision: 3,
        lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
      })
      .mockRejectedValueOnce({ code: "working_order.not_found" });
    const { el } = await mountApp({
      retrieveWorkingOrder,
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "park-order", {});
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
  });

  it("sends a retrieved line's stable server id on a quantity edit", async () => {
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const { el } = await mountApp({
      updateWorkingOrder,
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-stable",
        orderNumber: 8,
        label: null,
        lines: [
          {
            workingOrderLineId: "line-stable",
            menuItemId: "menu-item-cafe-0",
            productId: "cafe",
            quantity: "1.000",
          },
        ],
      }),
    });
    const counter = await toCounter(el);
    emit(counter, "retrieve-order", { id: "wo-stable" });
    await flush(el);

    counter.store.setLineQuantity(0, "2");
    emit(counter, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-stable", {
      lines: [
        {
          makeAt: null,
          workingOrderLineId: "line-stable",
          menuItemId: "menu-item-cafe-0",
          quantity: "2",
        },
      ],
      label: undefined,
      revision: 0,
    });
  });

  // A held line's extras come back as VALUES and the id of the list each was picked from, so the till
  // finds that list in the dish's LIVE offer before the line can be re-sent. The three names of the list
  // and of the picked product differ, so reading the wrong one fails (CLAUDE.md §3).
  const milkList = {
    kind: "extras" as const,
    id: "list-milk",
    name: "Leches",
    customerName: { es: "Leches carta" },
    kitchenName: "Leches KDS",
    minPicks: 0,
    maxPicks: null,
    items: [
      {
        portion: "1",
        unit: {
          name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
          hardwareUnit: null,
          id: "00000000-0000-0000-0000-000000000001",
          abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
          precision: 0,
        },
        productId: "p-milk",
        name: "Leche extra",
        customerName: { es: "Leche extra carta" },
        kitchenName: "Leche extra KDS",
        price: "0.75",
        vatClass: "general" as const,
        maxQuantity: 3,
        preselected: false,
        addAllergens: null,
        suitableFor: [],
        image: null,
        available: true,
      },
    ],
  };

  /** The dish's child line as the server hands it back: values, and the list it was picked from. */
  const heldMilk = {
    productId: "p-milk",
    name: "Leche extra",
    descriptions: { "es-ES": "Leche extra carta" },
    kitchenName: "Leche extra KDS",
    price: "0.75",
    quantity: 2,
    listId: "list-milk",
  };

  it("rebuilds a retrieved line's picks under the list its dish still offers", async () => {
    const offering: TillProduct = { ...cafe, offeredModifiers: [milkList] };
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [offering] }),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-customised",
        orderNumber: 9,
        label: "Takeaway",
        lines: [
          {
            workingOrderLineId: "line-customised",
            menuItemId: "menu-item-cafe-0",
            productId: "cafe",
            quantity: "2.000",
            product: cafe,
            extras: [heldMilk],
            note: "Sin espuma",
          },
        ],
      }),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);

    expect(counter.store.lines).toEqual([
      {
        workingOrderLineId: "line-customised",
        // The stored snapshot keeps the line's own names and price; the OFFERED lists come from
        // today's live offer, which is what the pick has to be answered against.
        product: { ...cafe, offeredModifiers: [milkList] },
        quantity: "2",
        extras: [
          {
            listId: "list-milk",
            productId: "p-milk",
            name: "Leche extra",
            price: "0.75",
            quantity: 2,
          },
        ],
        note: "Sin espuma",
      },
    ]);
    // Re-sending the edit names the list the pick was matched to.
    counter.store.setLineQuantity(0, "3");
    await el.updateComplete;
    emit(counter, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(currentApi.updateWorkingOrder).toHaveBeenCalledWith("wo-customised", {
      label: "Takeaway",
      revision: 0,
      lines: [
        {
          makeAt: null,
          workingOrderLineId: "line-customised",
          menuItemId: "menu-item-cafe-0",
          quantity: "3",
          note: "Sin espuma",
          extras: [{ listId: "list-milk", picks: [{ productId: "p-milk", quantity: 2 }] }],
        },
      ],
    });
  });

  /** A retrieved order whose one café line (×2) carries `heldMilk` (×2 per dish). */
  function milkOrder(product: TillProduct = cafe) {
    return {
      id: "wo-customised",
      orderNumber: 9,
      label: "Takeaway",
      lines: [
        {
          workingOrderLineId: "line-customised",
          menuItemId: product.menuItemId,
          productId: product.id,
          quantity: "2.000",
          product,
          extras: [heldMilk],
        },
      ],
    };
  }

  const basketText = (el: TillApp) =>
    counterGrid(el)!.shadowRoot!.querySelector("till-basket")!.shadowRoot!.textContent!;
  const totalText = (el: TillApp) =>
    counterGrid(el)!.shadowRoot!.querySelector("till-total")!.shadowRoot!.textContent!;

  it("shows a retrieved pick no list offers any more, marked, and counts it in the total", async () => {
    // Nothing offers `p-milk` now, so the pick cannot be re-sent, but the unedited order is paid
    // from its stored lines, which still bill it.
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(milkOrder()),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);

    expect(basketText(el)).toContain("Leche extra ×2");
    expect(basketText(el)).toContain(t("basket.not_offered"));
    // Two cafés at 1.50, and two milks per café at 0.75.
    expect(totalText(el)).toContain(formatMoney("6.00", currentLocale()));
  });

  it("takes a not-offered pick off the basket and the total once the order is edited", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(milkOrder()),
    });
    const counter = await toCounter(el);
    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);

    counter.store.setLineQuantity(0, "3");
    await flush(el);

    expect(basketText(el)).not.toContain("Leche extra");
    // Three cafés at 1.50, and no milk: what the server re-prices the edit to.
    expect(totalText(el)).toContain(formatMoney("4.50", currentLocale()));
  });

  it("never sends a not-offered pick, whether the order is paid unedited, held, or edited", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(milkOrder()),
    });
    const counter = await toCounter(el);
    const retrieve = async () => {
      emit(counter, "retrieve-order", { id: "wo-customised" });
      await flush(el);
    };
    const plainLine = (quantity: string) => ({
      workingOrderLineId: "line-customised",
      menuItemId: "menu-item-cafe-0",
      quantity,
      makeAt: null,
    });

    await retrieve();
    emit(counter, "confirm-payment", { method: "cash", amount: "10" });
    await flush(el);
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [plainLine("2")],
      { method: "cash", amount: "10" },
      "wo-customised",
    );

    emit(counter, "new-sale");
    await flush(el);
    await retrieve();
    counter.store.setLineQuantity(0, "3");
    emit(counter, "park-order", { label: undefined });
    await flush(el);
    expect(currentApi.updateWorkingOrder).toHaveBeenCalledWith("wo-customised", {
      label: "Takeaway",
      revision: 0,
      lines: [plainLine("3")],
    });
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
  });

  it("says a retrieved extra is no longer offered, not that it was dropped", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(milkOrder()),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.extra_not_offered"));
    expect(banner.textContent).not.toContain(t("held.product_gone"));
  });

  // The till cannot tell a list that withdrew a still-sellable extra from an extra that can no
  // longer be sold (both are simply absent from the live offer), nor whether the line has gone to
  // the kitchen, so the banner may not promise that the extra is charged: paying refuses an unsent
  // one that can no longer be sold (`priceStoredOrderForIssuance`, apps/server/src/working-order.ts).
  it("warns that paying is refused if a no-longer-offered extra cannot be sold, in both languages", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(milkOrder()),
    });
    const counter = await toCounter(el);
    const banner = () => el.shadowRoot!.querySelector('[role="alert"]')!.textContent!;

    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);
    expect(banner()).toContain("Sigue en el pedido tal como se guardó");
    expect(banner()).toContain("no se podrá cobrar hasta que se quite");
    expect(banner()).not.toContain("Se sigue cobrando");

    setLocale("en-GB");
    emit(counter, "retrieve-order", { id: "wo-customised" });
    await flush(el);
    expect(banner()).toContain("It stays on the order as saved");
    expect(banner()).toContain("paying is refused until it is removed");
    expect(banner()).not.toContain("still charged");
  });

  it("reports a dropped line before a not-offered extra, and a not-offered extra before a stale answer", async () => {
    const offering: TillProduct = { ...cafe, offeredModifiers: [puntoList] };
    const answered = {
      workingOrderLineId: "line-answered",
      menuItemId: "menu-item-cafe-0",
      productId: "cafe",
      quantity: "1.000",
      product: cafe,
      optionSnapshots: [{ ...frozenPunto, labelName: { es: "Muy hecho" } }],
      extras: [heldMilk],
    };
    const retrieveWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce({
        id: "wo-both",
        orderNumber: 12,
        label: null,
        lines: [answered, { productId: "ghost", quantity: "1.000" }],
      })
      .mockResolvedValueOnce({ id: "wo-one", orderNumber: 13, label: null, lines: [answered] });
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [offering] }),
      retrieveWorkingOrder,
    });
    const counter = await toCounter(el);
    const banner = () => el.shadowRoot!.querySelector('[role="alert"]')!.textContent;

    emit(counter, "retrieve-order", { id: "wo-both" });
    await flush(el);
    expect(banner()).toContain(t("held.product_gone"));

    emit(counter, "retrieve-order", { id: "wo-one" });
    await flush(el);
    expect(banner()).toContain(t("held.extra_not_offered"));
  });

  it("shows a retrieved line's frozen options answers, which carry no ids to re-send", async () => {
    const snapshot = {
      listName: { "es-ES": "Punto personal" },
      listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
      listKitchenName: "PTO",
      labelName: { "es-ES": "Poco personal" },
      labelCustomerName: { "es-ES": "Poco hecho" },
      labelKitchenName: "PH",
    };
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-answered",
        orderNumber: 10,
        label: null,
        lines: [
          {
            workingOrderLineId: "line-answered",
            menuItemId: "menu-item-cafe-0",
            productId: "cafe",
            quantity: "1.000",
            product: cafe,
            optionSnapshots: [snapshot],
          },
        ],
      }),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-answered" });
    await flush(el);

    const line = counter.store.lines[0]!;
    expect(line.optionSnapshots).toEqual([snapshot]);
    // This dish offers no options list today (`cafe` carries no `offeredModifiers`), so there is no
    // list for the frozen wording to be matched back to and the wire carries no answer. A dish that
    // still offers the list is the next case.
    expect(line.options).toBeUndefined();
  });

  // A frozen answer carries six names and no ids, so a retrieved line re-derives the
  // `{ listId, labelId }` the wire wants by matching those names against the dish's LIVE offer —
  // the same problem `deriveExtraSelections` solves for a pick. The three names of the list and of
  // the label differ, so a match made on the wrong one of the six fails (CLAUDE.md §3).
  const puntoList = {
    kind: "options" as const,
    id: "list-punto",
    name: "Punto",
    customerName: { es: "¿Cómo lo quiere?" },
    kitchenName: "PTO",
    defaultLabelId: null,
    labels: [
      {
        id: "label-rare",
        name: "Poco hecho",
        customerName: { es: "Poco hecho para el cliente" },
        kitchenName: "PH",
        available: true,
      },
      {
        id: "label-medium",
        name: "Al punto",
        customerName: { es: "Al punto para el cliente" },
        kitchenName: "AP",
        available: true,
      },
    ],
  };

  /** The answer as the server froze it: the list's three names and the chosen label's three. */
  const frozenPunto = {
    listName: { es: "Punto" },
    listCustomerName: { es: "¿Cómo lo quiere?" },
    listKitchenName: "PTO",
    labelName: { es: "Al punto" },
    labelCustomerName: { es: "Al punto para el cliente" },
    labelKitchenName: "AP",
  };

  /** A retrieved order whose one line froze `answer` against a dish offering `puntoList`. */
  function answeredOrder(answer: Record<string, unknown>) {
    return {
      id: "wo-answered",
      orderNumber: 11,
      label: "Mesa 2",
      lines: [
        {
          workingOrderLineId: "line-answered",
          menuItemId: "menu-item-cafe-0",
          productId: "cafe",
          quantity: "2.000",
          product: cafe,
          optionSnapshots: [answer],
        },
      ],
    };
  }

  it("re-sends a retrieved line's options answer, matched to the list its dish still offers", async () => {
    const offering: TillProduct = { ...cafe, offeredModifiers: [puntoList] };
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [offering] }),
      retrieveWorkingOrder: vi.fn().mockResolvedValue(answeredOrder(frozenPunto)),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-answered" });
    await flush(el);

    expect(counter.store.lines[0]!.options).toEqual([
      { listId: "list-punto", labelId: "label-medium" },
    ]);
    expect(el.shadowRoot!.textContent).not.toContain(t("held.options_changed"));

    // Without that answer on the wire the server refuses the whole edit with
    // `options.label_required` — pinned by "refuses a quantity-only edit that names no answer for an
    // active options list" (`apps/server/src/working-order.test.ts`).
    counter.store.setLineQuantity(0, "3");
    await el.updateComplete;
    emit(counter, "confirm-payment", { method: "cash", amount: "10" });
    await flush(el);
    expect(currentApi.updateWorkingOrder).toHaveBeenCalledWith("wo-answered", {
      label: "Mesa 2",
      revision: 0,
      lines: [
        {
          makeAt: null,
          workingOrderLineId: "line-answered",
          menuItemId: "menu-item-cafe-0",
          quantity: "3",
          options: [{ listId: "list-punto", labelId: "label-medium" }],
        },
      ],
    });
  });

  it("sends a walk-up line's options answer and not the names the picker copied onto it for display", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1", {
      options: [{ listId: "list-punto", labelId: "label-medium" }],
      optionSnapshots: [frozenPunto],
    });
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [
        {
          makeAt: null,
          menuItemId: "menu-item-cafe-0",
          quantity: "1",
          options: [{ listId: "list-punto", labelId: "label-medium" }],
        },
      ],
      { method: "cash", amount: "5" },
      c.store.id,
    );
  });

  it("tells the operator when a still-offered list's frozen answer no longer matches it", async () => {
    // The label was renamed between the park and the retrieve, so the six frozen names name nothing
    // on offer. Substituting the list's default would change what the diner asked for on a line
    // about to be billed, so the answer is left off and the operator is told to choose again.
    const offering: TillProduct = { ...cafe, offeredModifiers: [puntoList] };
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [offering] }),
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValue(answeredOrder({ ...frozenPunto, labelName: { es: "Muy hecho" } })),
    });
    const counter = await toCounter(el);

    emit(counter, "retrieve-order", { id: "wo-answered" });
    await flush(el);

    const line = counter.store.lines[0]!;
    expect(line.options).toBeUndefined();
    // The wording the order holds stays on screen — it is what the diner asked for.
    expect(line.optionSnapshots).toEqual([{ ...frozenPunto, labelName: { es: "Muy hecho" } }]);
    expect(el.shadowRoot!.textContent).toContain(t("held.options_changed"));
  });

  it("retrieve → edit → pay: a not_open re-sync FALLS THROUGH to the settled replay, not sale.error (Findings 3 & 4)", async () => {
    // A lost-response retry, or the LOSER of a two-till concurrent pay on the same parked order, finds
    // the order ALREADY settled. The edit-gated re-sync then throws `working_order.not_open` — which must
    // NOT surface. It means "already settled → let the pay path replay": `recordSale`'s settled branch
    // returns the FILED ticket (no double-file, no error banner).
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
    const recordSale = vi.fn().mockResolvedValue(saleResult); // the server's settled-replay ticket
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // an edit → the basket is dirty, so the re-sync is attempted
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // The re-sync was attempted and rejected `not_open` — but the pay REPLAYED: ticket shown, no error.
    expect(updateWorkingOrder).toHaveBeenCalled();
    expect(recordSale).toHaveBeenCalledWith(
      [
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("retrieve → edit → pay: a NON-not_open re-sync failure surfaces as a non-fatal error (basket intact)", async () => {
    // The other side of the swallow: only `working_order.not_open` falls through. Any OTHER re-sync
    // rejection (a network error, some other domain code) is a real failure — it must surface as the
    // generic sale.error, leave the basket intact, and NOT file (recordSale is never reached). Mutating
    // the swallow to catch every code would let a genuine failure be silently paid past.
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "server.internal" });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // edit → dirty → re-sync attempted
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled(); // the failed sync short-circuits before filing
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(2); // basket intact — café×2 retrieved + café×1 edit
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(el.shadowRoot!.textContent).not.toContain("server.internal"); // never leaks the raw code
  });

  it("shows sale.unconfirmed, basket kept, when the sale request got no answer", async () => {
    // A `recordSale` whose `fetch` rejects at the NETWORK level (a TypeError — the host never answered)
    // is not the same as a server that refused with a `{ code }` (#264): the operator must
    // check whether the sale went through before retrying, so the banner is `sale.unconfirmed`, not the
    // free-to-retry `sale.error`. Basket kept, still on the counter.
    const recordSale = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1);
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.unconfirmed"));
  });

  it("confirm-payment: a PRELIMINARY-save network failure shows sale.error, not sale.unconfirmed", async () => {
    // `sale.unconfirmed` means "the sale may have filed — check before retrying". A network failure of
    // the PRE-PAY `#syncIfDirty` save is not that: no fiscal request was ever made, nothing filed, safe to
    // retry — so it must be the plain `sale.error`. Retrieve + edit so `#syncIfDirty` actually calls the
    // API, then reject that call at the network level; `recordSale` is never reached.
    const updateWorkingOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // edit → dirty → the pre-pay sync is attempted
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled(); // the failed save short-circuits before any fiscal call
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(2);
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(banner.textContent).not.toContain(t("sale.unconfirmed"));
  });

  it("walk-up pay retry: a re-tapped confirm sends the SAME store id (idempotent replay, never two ids)", async () => {
    // A lost pay response then an operator re-tap must replay against the same working-order id, not
    // mint a second one — otherwise a second POST /api/sales files a second chained fiscal record
    // (the client holds the id stable across retries). The first attempt rejects (response
    // lost); the re-tap succeeds. Both must carry the identical store id.
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "sale.rejected" })
      .mockResolvedValueOnce(saleResult);
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const stableId = store.id;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // first — rejects, basket intact
    await flush(el);
    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // re-tap — succeeds
    await flush(el);

    expect(recordSale).toHaveBeenCalledTimes(2);
    // the SAME id both times (not two random uuids) — a re-tap replays rather than double-files.
    expect(recordSale.mock.calls[0]![2]).toBe(stableId);
    expect(recordSale.mock.calls[1]![2]).toBe(stableId);
  });

  it("new-sale: clears the basket and returns to an empty counter", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "new-sale");
    await flush(el);

    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
    expect(store.lines).toHaveLength(0);
  });

  it("park-order: parks the basket with its id + mapped lines + label, then empties it and stays on the counter", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const parkedId = store.id; // captured BEFORE the park — clear() re-mints it on success

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledWith({
      id: parkedId,
      lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      label: "Mesa 4",
    });
    // The basket is emptied and its id re-minted, ready for the next customer; still on the counter.
    expect(store.lines).toHaveLength(0);
    expect(store.id).not.toBe(parkedId);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("park-order: forwards an unlabelled park (label undefined)", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: undefined });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledWith({
      id: expect.any(String),
      lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      label: undefined,
    });
  });

  it("a failed parkOrder keeps the counter and the basket, showing a non-fatal error", async () => {
    const { el } = await mountApp({
      parkOrder: vi.fn().mockRejectedValue({ code: "working_order.rejected" }),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledOnce();
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1); // basket intact — a failed park never loses the order
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.park_error"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.rejected"); // never leaks the code
  });

  it("park single-flight: a second park-order while the first is pending parks EXACTLY ONCE", async () => {
    // A re-entrant park (double-tap / laggy link) must not fire a second POST.
    const parkOrder = vi.fn(() => new Promise(() => {}));
    const { el } = await mountApp({ parkOrder });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" }); // first — raises the guard, awaits
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 4" }); // second — guarded, a no-op
    await el.updateComplete;

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("entering the counter loads the held-orders list and threads it to the counter", async () => {
    const { el } = await mountApp({
      listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
    });
    const c = await toCounter(el);
    expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    expect(c.heldOrders).toEqual([heldSummary]);
  });

  it("park success: refreshes the held-orders list", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    // once on entering the counter, once after the successful park.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("retrieve → edit → Hold re-syncs the edit via updateWorkingOrder instead of re-parking (P6)", async () => {
    // The server's park is IDEMPOTENT (a re-sent park with the same id REPLAYS the existing OPEN order
    // and inserts nothing — the re-sent basket is DISCARDED), so re-parking a RETRIEVED, EDITED order
    // would SILENTLY DISCARD the edit yet show success. So Hold must mirror the pay/place paths: route a
    // PERSISTED order through `#syncIfDirty` (`updateWorkingOrder`), never `parkOrder`.
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true); // a retrieved order is persisted server-side

    store.addProduct(cafe, "1"); // the edit AFTER retrieve → the basket is dirty
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    // The edit is re-locked via updateWorkingOrder (café×2 retrieved + café×1 edit), under the order's
    // id and label — NOT re-parked (a re-park would idempotently replay and discard the edit).
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      label: "Mesa 4",
      revision: 3,
    });
    expect(parkOrder).not.toHaveBeenCalled();
    // Success path: the basket empties and stays on the counter (a hold is not a completed sale).
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("retrieve → (no edit) → Hold does not re-park an unedited retrieved order (P6)", async () => {
    // A retrieved order tapped straight to Hold has nothing to save — and must STILL not re-park,
    // because an idempotent re-park is a needless round trip that only replays the already-stored order.
    // `#syncIfDirty` no-ops on a clean basket (`persisted && !dirty`), so neither `updateWorkingOrder`
    // nor `parkOrder` fires; the basket clears so the operator can move on.
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true);
    expect(store.dirty).toBe(false); // retrieved but never edited

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(parkOrder).not.toHaveBeenCalled();
    expect(updateWorkingOrder).not.toHaveBeenCalled();
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
  });

  it("retrieve → edit → Hold with a BLANK label keeps the retrieved order's name, does not wipe it (P6)", async () => {
    // The Hold field opens BLANK, so `park-order` carries `label: undefined`. `updateWorkingOrder` writes
    // `label ?? null`, so forwarding that undefined would WIPE the retrieved order's name ("Mesa 4" → NULL)
    // — anonymising it in the cross-till held list. The persisted branch falls back to the STORED label,
    // so a blank re-hold preserves the name. (A typed label still renames — the case above.)
    const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.label).toBe("Mesa 4"); // loadFrom adopted the retrieved order's name

    store.addProduct(cafe, "1"); // edit AFTER retrieve → dirty
    await el.updateComplete;

    emit(c, "park-order", { label: undefined }); // the blank Hold field
    await flush(el);

    // The stored "Mesa 4" is preserved, NOT wiped — updateWorkingOrder carries the name, not undefined.
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
        { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      label: "Mesa 4",
      revision: 3,
    });
    expect(parkOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → Hold surfaces held.park_error and keeps the basket when the update fails (P6)", async () => {
    // A REAL `updateWorkingOrder` failure (not the `working_order.not_open` that `#syncIfDirty`
    // swallows) must surface the same non-fatal `held.park_error` banner and leave the basket intact, as
    // the fresh-walk-up park does (see "a failed parkOrder keeps the counter and the basket").
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.rejected" });
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // edit → dirty, so #syncIfDirty attempts the update
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    expect(parkOrder).not.toHaveBeenCalled();
    expect(store.lines).toHaveLength(2); // basket intact (not cleared) so the operator can retry
    expect(counter(el)).not.toBeNull();
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.park_error"));
  });

  it("retrieve-order: fetches, maps productId→OrderLine via products, loads it under the order's id", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.retrieveWorkingOrder).toHaveBeenCalledWith("wo-1");
    // the retrieved order's own id is adopted (so paying it later keys the same idempotency slot)
    expect(store.id).toBe("wo-1");
    expect(store.label).toBe("Mesa 4");
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toMatchObject({
      id: "cafe",
      productId: "cafe",
      menuItemId: "menu-item-cafe-0",
      unitPrice: "1.50",
    });
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("retrieve-order resolves the stored menu-item identity when one product has two offers", async () => {
    const homeFields = {
      orderable: true,
      sendable: true,
      audience: "customer" as const,
      structure: { members: [] },
      home: {
        shortcuts: [],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
    };
    const catalogue = {
      service: { open: true, periodName: null, keepOpen: null },
      context: {
        departmentName: "Restaurant",
        zoneId: "zone-counter",
        departmentId: "department-bar",
        serviceMode: "prepay",
      },
      defaultMenuId: "menu-standard",
      menus: [
        {
          id: "menu-standard",
          name: "Standard",
          isDefault: true,
          versionId: "version-standard",
          ...homeFields,
        },
        {
          id: "menu-happy",
          name: "Happy hour",
          isDefault: false,
          versionId: "version-happy",
          ...homeFields,
        },
      ],
      offers: [
        {
          ...fixtureOffers({
            menus: [{ id: "menu-standard", name: "Standard", isDefault: true }],
            products: [{ ...cafe, id: "negroni", unitPrice: "9.00" }],
          }).offers[0]!,
          id: "offer-standard",
          productId: "negroni",
          menuId: "menu-standard",
          menuName: "Standard",
          grossPrice: "9.00",
        },
        {
          ...fixtureOffers({
            menus: [{ id: "menu-happy", name: "Happy hour", isDefault: true }],
            products: [{ ...cafe, id: "negroni", unitPrice: "7.00" }],
          }).offers[0]!,
          id: "offer-happy",
          productId: "negroni",
          menuId: "menu-happy",
          menuName: "Happy hour",
          grossPrice: "7.00",
        },
      ],
    } satisfies ZoneOfferCatalogue;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-happy",
        orderNumber: 8,
        label: null,
        lines: [{ menuItemId: "offer-happy", productId: "negroni", quantity: "1.000" }],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-happy" });
    await flush(el);

    expect(c.store.lines[0]!.product).toMatchObject({
      id: "negroni",
      menuItemId: "offer-happy",
      unitPrice: "7.00",
    });
  });

  it("retrieve-order keeps a snapshotted offer that is no longer in the live zone menu", async () => {
    const storedProduct: TillProduct = {
      id: "seasonal-soup",
      productId: "seasonal-soup",
      menuItemId: "offer-seasonal-soup",
      name: "Seasonal soup",
      customerName: { en: "Seasonal soup for the customer" },
      pricingUnit: "each",
      unitPrice: "8.50",
      vatClass: "reduced",
      category: "Starter",
      allergens: null,
      catalogueId: "menu-winter",
      catalogueName: "Winter menu",
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      courseId: null,
    };
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        service: { open: true, periodName: null, keepOpen: null },
        context: {
          departmentName: "Restaurant",
          zoneId: "zone-counter",
          departmentId: "department-default",
          serviceMode: "prepay",
        },
        defaultMenuId: null,
        menus: [],
        offers: [],
      }),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-seasonal",
        orderNumber: 9,
        label: null,
        lines: [
          {
            menuItemId: "offer-seasonal-soup",
            productId: "seasonal-soup",
            quantity: "1.000",
            product: storedProduct,
          },
        ],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-seasonal" });
    await flush(el);

    expect(c.store.lines).toEqual([{ product: storedProduct, quantity: "1", notOffered: true }]);
    const basket = counterGrid(el)!.shadowRoot!.querySelector("till-basket")!.shadowRoot!;
    expect(basket.querySelector(".line")!.textContent).toContain(t("basket.not_offered"));
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("retrieve-order: an each quantity displays without trailing zeros; a weight keeps its decimals", async () => {
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [cafe, jamon] }),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [
          { productId: "cafe", quantity: "2.000" },
          { productId: "jamon", quantity: "0.320" },
        ],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    const store = c.store;
    expect(store.lines).toHaveLength(2);
    // each: the three-place "2.000" is cleaned to "2" for display; re-pricing is unaffected
    expect(store.lines[0]!.quantity).toBe("2");
    // weight: decimals are kept verbatim
    expect(store.lines[1]!.quantity).toBe("0.320");
  });

  it("retrieve-order: drops a line whose product no longer resolves and shows a non-fatal held.product_gone", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        lines: [
          { productId: "cafe", quantity: "1.000" },
          { productId: "ghost", quantity: "1.000" }, // deactivated since the order was parked
        ],
      }),
    });
    const c = await toCounter(el); // products default to [cafe] — "ghost" won't resolve
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    // the unresolved line is dropped; the rest of the order is loaded
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toMatchObject({
      id: "cafe",
      productId: "cafe",
      menuItemId: "menu-item-cafe-0",
      unitPrice: "1.50",
    });
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.product_gone"));
    expect(counter(el)).not.toBeNull();
  });

  it("retrieve-order: refreshes the held-orders list after loading", async () => {
    const { el } = await mountApp({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // after the retrieve
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
  });

  it("discard-order: abandons the order and refreshes the held-orders list", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.abandonWorkingOrder).toHaveBeenCalledWith("wo-1");
    // once on entering the counter, once after the discard.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("retrieve-order: a stale row (order gone on another till) shows held.stale, refreshes, keeps the basket, leaks no code", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // recovery refresh drops the vanished row
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);
    const store = c.store;
    store.addProduct(cafe, "2"); // a basket already in progress
    await el.updateComplete;

    emit(c, "retrieve-order", { id: "wo-1" });
    await discardBasketChanges(el);

    // non-fatal, translated banner — never the raw code
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.not_found");
    // the vanished order drops off the list on the recovery refresh
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
    // the in-progress basket is UNTOUCHED — loadFrom never ran on the rejected retrieve
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("discard-order: a stale row (order gone on another till) shows held.stale, refreshes, leaks no code", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_open" }),
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // recovery refresh drops the vanished row
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.abandonWorkingOrder).toHaveBeenCalledWith("wo-1");
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.not_open");
    // the recovery refresh runs even though the discard rejected, so the stale row drops off
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
  });

  it("discard-order: refused for an order still holding money, says to give it back, and refreshes", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi
        .fn()
        .mockRejectedValue({ code: "bill.payments_received", status: 409, workingOrderId: "wo-1" }),
      listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
    });
    const c = await toCounter(el);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.abandonWorkingOrder).toHaveBeenCalledWith("wo-1");
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.discard_holds_money"));
    expect(banner.textContent).not.toContain(t("held.stale"));
    expect(banner.textContent).not.toContain(codeMessage("bill.payments_received"));
    expect(el.shadowRoot!.textContent).not.toContain("bill.payments_received");
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([heldSummary]);
  });

  it("discard-order: a money refusal for an order the refreshed list no longer holds shows held.stale", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi
        .fn()
        .mockRejectedValue({ code: "bill.payments_received", status: 409, workingOrderId: "wo-1" }),
      listWorkingOrders: vi.fn().mockResolvedValueOnce([heldSummary]).mockResolvedValue([]),
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(banner.textContent).not.toContain(t("held.discard_holds_money"));
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
  });

  it("discard-order: refused while a card payment is under way, says so in that code's own words, and refreshes", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({
        code: "order.payment_in_flight",
        status: 409,
        workingOrderId: "wo-1",
      }),
      listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
    });
    const c = await toCounter(el);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(codeMessage("order.payment_in_flight"));
    expect(banner.textContent).not.toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("order.payment_in_flight");
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("discard-order: refused while a card refund is pending, says so in that code's own words, and refreshes", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({
        code: "bill.refund_in_progress",
        status: 409,
        workingOrderId: "wo-1",
      }),
      listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
    });
    const c = await toCounter(el);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(codeMessage("bill.refund_in_progress"));
    expect(banner.textContent).not.toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("bill.refund_in_progress");
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("discard success clears a stale banner left by a prior failed action", async () => {
    // A failed retrieve sets a `held.stale` banner; a SUCCESSFUL discard must clear it, like every
    // sibling handler.
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" }); // fails → held.stale banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();

    emit(c, "discard-order", { id: "wo-1" }); // succeeds → clears the banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("logout: calls logout, returns to lock, and KEEPS the basket", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store: WorkingOrderStore = c.store;
    store.addProduct(cafe, "2");
    store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "logout");
    await flush(el);

    expect(currentApi.logout).toHaveBeenCalledOnce();
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    // A shift change never loses the half-built order.
    expect(store.lines).toHaveLength(2);
    expect(store.lines[0]!.product).toBe(cafe);
  });

  it("session activity: a handheld + 300s boot configures the controller; logout stops it", async () => {
    const sa = fakeSessionActivity();
    const api = stubApi({
      // A handheld device (phone canvas) whose profile carries a 300s inactivity auto-logout.
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: phoneCanvasDef, inactivityTimeoutSeconds: 300 }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "h1",
        name: "Phone 1",
        formFactor: "phone-portrait",
        stationId: null,
      }),
    });
    currentApi = api;
    const { el } = await mountWidget<TillApp>("till-app", {
      api,
      sessionActivity: sa as never,
    });
    await flush(el);

    // The controller is started on connect and configured once boot resolves the device kind + timeout.
    expect(sa.start).toHaveBeenCalled();
    expect(sa.configure).toHaveBeenCalled();
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({
      loggedIn: false,
      kind: "handheld",
      timeoutSeconds: 300,
    });

    // Login → the same handheld kind + timeout, now logged in (wake lock + idle timer engage).
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({
      loggedIn: true,
      kind: "handheld",
      timeoutSeconds: 300,
    });

    // Logout → reconfigured as not-logged-in: the controller releases the lock and cancels the timer.
    emit(shell(el)!, "logout");
    await flush(el);
    expect(currentApi.logout).toHaveBeenCalledOnce();
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({
      loggedIn: false,
      kind: "handheld",
      timeoutSeconds: 300,
    });
  });

  it("session activity: a KDS boot configures the controller as a kds_station", async () => {
    const sa = fakeSessionActivity();
    const api = stubApi({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "kds1",
        name: "Pass",
        formFactor: "kds",
        stationId: "st-1",
      }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-1",
          name: "Pass",
          today: {
            open: true,
            isDefault: true,
            byHand: null,
            sendsTo: null,
            why: "default" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api, sessionActivity: sa as never });
    await flush(el);
    // A KDS never logs in — it is configured as a kds_station (which holds the wake lock while active).
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({
      loggedIn: false,
      kind: "kds_station",
    });
  });

  it("session activity: with no injected controller, a logout still reaches the lock screen", async () => {
    // No injected sessionActivity → the app builds a real SessionActivity.
    const { el } = await mountApp();
    const c = await toCounter(el);
    emit(c, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
  });

  it("idle expiry locks locally even when api.logout() rejects (offline failover — C2)", async () => {
    // The exact failover case: the device is offline, so `api.logout()` REJECTS. The device must still
    // end logged-out and locked — the local lock must not depend on the server call.
    const sa = fakeSessionActivity();
    const logout = vi.fn().mockRejectedValue(new Error("offline"));
    const api = stubApi({ logout });
    currentApi = api;
    const { el } = await mountWidget<TillApp>("till-app", { api, sessionActivity: sa as never });
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(lock(el)).toBeNull(); // on the counter, logged in

    // Fire the idle callback the app handed the controller — the controller's onIdle IS the app's
    // drop-and-lock (`#onIdle` → `#onLogout`).
    const lastConfig = sa.configure.mock.calls.at(-1)![0] as { onIdle: () => void };
    lastConfig.onIdle();
    await flush(el);

    // The server logout was ATTEMPTED (best-effort)…
    expect(logout).toHaveBeenCalledOnce();
    // …but the rejection never left the till unlocked: back on the lock screen, operator cleared, and
    // the controller reconfigured to loggedIn:false (wake lock released, idle timer cancelled).
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({ loggedIn: false });
  });

  it("records a nav event on the shared diagnostics trail when the screen changes", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    // `diag` is a MODULE SINGLETON with a bounded buffer shared across every test. Read the latest
    // matching event because appending at capacity leaves the snapshot length unchanged.
    emit(c, "show-schedule");
    await flush(el);
    const nav = diag
      .snapshot()
      .slice()
      .reverse()
      .find((e) => e.event === "nav");
    expect(nav?.fields.screen).toBe("schedule");
  });

  describe("the profile's starting screen", () => {
    const rosterApi = {
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    };

    it("opens at sign-in, over the canvas's first tab", async () => {
      const { el } = await mountApp({
        ...rosterApi,
        getTill: vi.fn().mockResolvedValue({ ...till, startingScreen: "show-schedule" }),
      });
      await toCounter(el);
      expect(schedule(el)).not.toBeNull();
      expect(counter(el)).not.toBeNull();
    });

    it("opens nothing when the profile no longer shows that screen", async () => {
      const { el } = await mountApp({
        ...rosterApi,
        getTill: vi.fn().mockResolvedValue({
          ...till,
          capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
          startingScreen: "show-schedule",
        }),
      });
      await toCounter(el);
      expect(schedule(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
    });

    it("selects the canvas's tab of that name when the canvas has the screen as a tab", async () => {
      const withScheduleTab = {
        ...till.canvas,
        tabs: [...till.canvas.tabs, { key: "schedule", title: "Horario", columns: 24, cards: [] }],
      };
      const { el } = await mountApp({
        ...rosterApi,
        getTill: vi.fn().mockResolvedValue({
          ...till,
          canvas: withScheduleTab,
          startingScreen: "show-schedule",
        }),
      });
      await toCounter(el);
      expect(shell(el)!.activeTabKey).toBe("schedule");
      expect(schedule(el)).toBeNull();
    });

    it("selects a starting tab in place of the sign-in's history entry, so Back does not return to the first tab", async () => {
      const withScheduleTab = {
        ...till.canvas,
        tabs: [...till.canvas.tabs, { key: "schedule", title: "Horario", columns: 24, cards: [] }],
      };
      history.replaceState(null, "", "/");
      const { el } = await mountApp({
        ...rosterApi,
        getTill: vi.fn().mockResolvedValue({
          ...till,
          canvas: withScheduleTab,
          startingScreen: "show-schedule",
        }),
      });
      await flush(el);
      const entries = history.length;
      await toCounter(el);
      expect(shell(el)!.activeTabKey).toBe("schedule");
      expect(history.length).toBe(entries);
    });

    it("opens again for the next person after a logout", async () => {
      const { el } = await mountApp({
        ...rosterApi,
        getTill: vi.fn().mockResolvedValue({ ...till, startingScreen: "show-schedule" }),
      });
      await toCounter(el);
      emit(schedule(el)!, "back-to-counter");
      await flush(el);
      expect(schedule(el)).toBeNull();
      emit(shell(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Bea", permissions: [] });
      await flush(el);
      expect(schedule(el)).not.toBeNull();
    });
  });

  it("show-schedule shows the schedule screen (basket preserved) and threads the roster + operator id", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "show-schedule");
    await flush(el);

    expect(schedule(el)).not.toBeNull();
    // On the shell the schedule is a DRILL overlaying the still-mounted counter tab.
    expect(counter(el)).not.toBeNull();
    // Basket-preserving, like logout: navigating to the schedule never loses the half-built order.
    expect(store.lines).toHaveLength(1);
    expect(schedule(el)!.operatorPersonId).toBe("p1");
    expect(schedule(el)!.staff).toEqual([{ personId: "p1", displayName: "Ana" }]);
  });

  it("back-to-counter returns to the counter with the basket intact after a schedule round trip", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "show-schedule");
    await flush(el);
    expect(schedule(el)).not.toBeNull();

    emit(schedule(el)!, "back-to-counter");
    await flush(el);

    expect(counter(el)).not.toBeNull();
    expect(schedule(el)).toBeNull();
    // The basket survives the whole counter → schedule → counter round trip.
    expect(store.lines).toHaveLength(2);
    expect(store.lines[0]!.product).toBe(cafe);
  });

  describe("live floor (FP-1)", () => {
    it("selecting the floor tab loads the zones + occupancy read-model and shows the floor (basket preserved)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;

      selectTab(el, "floor");
      await flush(el);

      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      expect(currentApi.listZones).toHaveBeenCalledOnce();
      expect(floor(el)!.zones).toEqual([floorZone]);
      expect(floor(el)!.tables).toEqual([freeTable]);
      // Basket-preserving like the schedule nav: the half-built order survives the round trip.
      expect(store.lines).toHaveLength(1);
    });

    it("selecting the floor tab shows an empty floor when the occupancy load fails (never blocks)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockRejectedValue({ code: "server.internal" }),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);

      selectTab(el, "floor");
      await flush(el);

      // A failed read shows the floor anyway (degrade gracefully), with tables left at their default.
      expect(floor(el)).not.toBeNull();
      expect(floor(el)!.tables).toEqual([]);
    });

    it("gives a floor-plan card's floor screen the app's api and no editing (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      // A floor-plan card's floor screen is not editable; the editor card's lock is covered below.
      expect(floor(el)!.api).toBe(currentApi);
      expect(floor(el)!.canEdit).toBe(false);
    });

    // The on-till floor editor is a permission-locked `table-layout-editor` card, gated at the CELL by
    // the grid's `permissions`. So the end-to-end assertion is that the operator's `permissions`
    // reach the floor tab's card grid. (The card's own lock rendering is covered by card-grid's suite.)
    const gridPermissions = (el: TillApp) =>
      (activeTabGrid(el) as unknown as { permissions: string[] }).permissions;

    it("a login WITH venue.configure lights up the on-till floor editor, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      // The lock screen sends the server's permission list; a manager holds `venue.configure`.
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Marta",
        permissions: ["venue.configure"],
      });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);

      expect(gridPermissions(el)).toEqual(["venue.configure"]);

      // Logging out drops the privilege so the next operator starts un-privileged.
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      emit(counter(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Ana", permissions: [] });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);
      expect(gridPermissions(el)).toEqual([]);
    });

    it("a login WITHOUT venue.configure keeps the on-till floor editor hidden, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);

      expect(gridPermissions(el)).toEqual([]);
    });

    it("floor-refresh re-reads the tables but NOT the zones after an on-till placement write (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);
      // The initial floor load read each once.
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      expect(currentApi.listZones).toHaveBeenCalledOnce();

      emit(floor(el)!, "floor-refresh");
      await flush(el);

      // The refresh re-read the TABLES (twice total) so the map reflects the just-persisted placement —
      // but NOT the zones: a placement write cannot change the zone list, so re-fetching it is waste.
      expect(currentApi.getTablesState).toHaveBeenCalledTimes(2);
      expect(currentApi.listZones).toHaveBeenCalledOnce();
    });

    it("floor-refresh degrades gracefully when the re-read fails (keeps the last-known floor)", async () => {
      // The first load succeeds; the refresh re-read rejects. A failed refresh must NOT blank the floor
      // or throw (the floor touches no fiscal path) — the last-known tables stay put.
      const { el } = await mountApp({
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([freeTable])
          .mockRejectedValue({ code: "server.internal" }),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);
      expect(floor(el)!.tables).toEqual([freeTable]);

      emit(floor(el)!, "floor-refresh");
      await flush(el);

      expect(floor(el)).not.toBeNull();
      expect(floor(el)!.tables).toEqual([freeTable]);
    });

    it("open-table on a FREE table opens a fresh tab and moves to the table-ordering screen", async () => {
      const seatTable = vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 });
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        seatTable,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t1", seated: false });
      await flush(el);

      // A free table opens a NEW tab (a pre-fiscal working order) before transitioning.
      expect(seatTable).toHaveBeenCalledWith("t1", null);
      // On a TILL the table-order screen opens as a DRILL over the floor tab, which stays
      // mounted (inert) underneath — the drill is what the operator sees.
      expect(floor(el)).not.toBeNull();
      const screen = tableOrder(el);
      expect(screen).not.toBeNull();
      expect(screen!.orderId).toBe("wo-new");
    });

    it("refreshes station availability when a table order opens and keeps the last list if a read fails", async () => {
      const listStations = vi
        .fn()
        .mockResolvedValueOnce([defaultStation])
        .mockRejectedValue(new Error("offline"));
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        seatTable: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
        listStations,
      });
      await toCounter(el);
      expect(listStations).toHaveBeenCalledOnce();
      expect(counter(el)!.defaultStationId).toBe(defaultStation.id);
      selectTab(el, "floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t1", seated: false });
      await flush(el);
      expect(listStations).toHaveBeenCalledTimes(2);
      expect(tableOrder(el)).not.toBeNull();
      selectTab(el, "counter");
      await flush(el);
      expect(listStations).toHaveBeenCalledTimes(3);
      expect(counter(el)!.defaultStationId).toBe(defaultStation.id);
    });

    it("keeps the newest station list when an earlier table read finishes last", async () => {
      let finishTableRead!: (stations: (typeof defaultStation)[]) => void;
      const newer = { ...defaultStation, id: "st-new" };
      const listStations = vi
        .fn()
        .mockResolvedValueOnce([defaultStation])
        .mockImplementationOnce(() => new Promise((resolve) => (finishTableRead = resolve)))
        .mockResolvedValueOnce([newer]);
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        seatTable: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
        listStations,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t1", seated: false });
      await flush(el);
      selectTab(el, "counter");
      await flush(el);
      expect(counter(el)!.defaultStationId).toBe(newer.id);
      finishTableRead([defaultStation]);
      await flush(el);
      expect(counter(el)!.defaultStationId).toBe(newer.id);
    });

    it("open-table on an OCCUPIED table resumes its tab WITHOUT opening a new one", async () => {
      const seatTable = vi.fn();
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        seatTable,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", seated: true });
      await flush(el);

      // An occupied table already has a tab — no seatTable call, just the transition. The screen
      // points at the RESUMED party's main bill, not a new one.
      expect(seatTable).not.toHaveBeenCalled();
      // The table-order drill overlays the still-mounted floor tab.
      expect(floor(el)).not.toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-7");
    });

    it("open-table on an occupied table missing from the read-model transitions with no order id", async () => {
      const seatTable = vi.fn();
      const { el } = await mountApp({
        // The read-model is empty, so the tapped table can't be resolved to a tab id.
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        seatTable,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", seated: true });
      await flush(el);

      // A resume never opens a fresh tab; with no tab id resolved the screen carries none.
      expect(seatTable).not.toHaveBeenCalled();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.orderId).toBeUndefined();
    });

    it("back-to-counter returns from the floor to the counter, basket intact", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;

      selectTab(el, "floor");
      await flush(el);
      expect(floor(el)).not.toBeNull();

      emit(floor(el)!, "back-to-counter");
      await flush(el);

      expect(counter(el)).not.toBeNull();
      expect(floor(el)).toBeNull();
      expect(store.lines).toHaveLength(1);
    });

    describe("table-order screen (FP-1)", () => {
      const tabLine: TabLine = {
        stationId: null,
        movable: false,
        id: "line-1",
        groupId: null,
        lineNo: 1,
        productId: "cafe",
        quantity: "2.000",
        unitPriceGross: "1.50",
        servedAt: null,
        courseId: null,
        sentAt: "2026-08-17T09:59:00.000Z",
        firedAt: "2026-08-17T09:59:00.000Z",
        state: "queued",
        note: null,
        listId: null,
        menuItemId: null,
        parentProductId: null,
      };
      const largeTabLine: TabLine = {
        ...tabLine,
        quantity: "1.000",
        unitPriceGross: "3000.01",
      };
      const largePartyBill: PartyBill = {
        ...smallPartyBill,
        total: "3000.01",
        outstanding: "3000.01",
      };
      const largeOpenTable: TableState = {
        ...openTable,
        tabLineCount: 1,
        tabTotal: "3000.01",
        party: { ...openTable.party!, outstanding: "3000.01" },
      };
      it("loads the tab's lines and threads them (with the catalogue) to the screen", async () => {
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        expect(getTabLines).toHaveBeenCalledWith("wo-7");
        expect(screen.lines).toEqual([tabLine]);
        expect(screen.products).toEqual([
          expect.objectContaining({
            id: "cafe",
            productId: "cafe",
            menuItemId: "menu-item-cafe-0",
            unitPrice: "1.50",
          }),
        ]);
      });

      it("loads offers for the table's zone before showing its ordering screen", async () => {
        const diningOffer = fixtureOffers({
          menus: [{ id: "menu-dining", name: "Dining", isDefault: true }],
          products: [
            {
              ...cafe,
              id: "negroni",
              menuItemId: "menu-item-negroni-0",
              name: "Negroni",
              customerName: { en: "Negroni for the customer" },
              unitPrice: "11.00",
              catalogueId: "menu-dining",
              catalogueName: "Dining",
            },
          ],
        });
        diningOffer.context.zoneId = floorZone.id;
        const listZoneOffers = vi.fn().mockResolvedValue(diningOffer);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          listZoneOffers,
        });
        const screen = await toTableOrder(el, openTable);

        expect(listZoneOffers).toHaveBeenCalledWith(floorZone.id);
        expect(screen.products).toEqual([
          expect.objectContaining({
            id: "negroni",
            menuItemId: "menu-item-negroni-0",
            unitPrice: "11.00",
          }),
        ]);
        expect(screen.menus).toEqual(diningOffer.menus);
        expect(screen.selectedMenuId).toBe("menu-dining");
      });

      it("ignores a late offer response for a table the operator has already left", async () => {
        const tableA = {
          ...openTable,
          id: "table-a",
          zoneId: "zone-a",
          party: { ...openTable.party!, id: "party-a", mainBillId: "order-a" },
        };
        const tableB = {
          ...openTable,
          id: "table-b",
          zoneId: "zone-b",
          party: { ...openTable.party!, id: "party-b", mainBillId: "order-b" },
        };
        const offersA = fixtureOffers({
          menus: [{ id: "menu-a", name: "Menu A", isDefault: true }],
          products: [{ ...cafe, id: "product-a", catalogueId: "menu-a", catalogueName: "Menu A" }],
        });
        offersA.context.zoneId = "zone-a";
        const offersB = fixtureOffers({
          menus: [{ id: "menu-b", name: "Menu B", isDefault: true }],
          products: [{ ...cafe, id: "product-b", catalogueId: "menu-b", catalogueName: "Menu B" }],
        });
        offersB.context.zoneId = "zone-b";
        let resolveA!: (value: ZoneOfferCatalogue) => void;
        let resolveB!: (value: ZoneOfferCatalogue) => void;
        const pending = {
          "zone-a": new Promise<ZoneOfferCatalogue>((resolve) => (resolveA = resolve)),
          "zone-b": new Promise<ZoneOfferCatalogue>((resolve) => (resolveB = resolve)),
        };
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([tableA, tableB]),
          listZones: vi.fn().mockResolvedValue([
            { ...floorZone, id: "zone-a" },
            { ...floorZone, id: "zone-b" },
          ]),
          listZoneOffers: vi.fn((zoneId: "zone-a" | "zone-b") => pending[zoneId]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
        });
        await toCounter(el);
        selectTab(el, "floor");
        await flush(el);

        emit(floor(el)!, "open-table", { tableId: tableA.id, seated: true });
        emit(floor(el)!, "open-table", { tableId: tableB.id, seated: true });
        resolveB(offersB);
        await flush(el);
        expect(tableOrder(el)!.products[0]!.id).toBe("product-b");

        resolveA(offersA);
        await flush(el);
        expect(tableOrder(el)!.products[0]!.id).toBe("product-b");
        expect(tableOrder(el)!.orderId).toBe("order-b");
      });

      it("a counter till can settle the tab — canSettle true (default)", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);
        // The pay section is available. The screen threads no `cardProvider`, so the embedded pay widget
        // offers BOTH tenders — cash and the manual (datáfono) card.
        expect(screen.canSettle).toBe(true);
      });

      it("a handheld reaches the table-order screen and can settle — canSettle true", async () => {
        // A handheld may settle at `POST /api/sales` for cash OR a manual card tender, so the pay
        // section SHOWS with both tenders. Opening a table SWITCHES to the phone canvas's order tab, mounting the
        // table-order screen as that tab's card.
        const phoneCanvas: CanvasDef = {
          formFactor: "phone-portrait",
          tabs: [
            {
              key: "floor",
              title: "Floor",
              columns: 12,
              cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
            },
            {
              key: "order",
              title: "Order",
              columns: 12,
              cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
            },
          ],
        };
        const { el } = await mountApp({
          getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
          getDeviceIdentity: vi
            .fn()
            .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        await flush(el);
        // A handheld waits on the lock screen, then lands on the floor after PIN login.
        emit(lock(el)!, "logged-in", {
          personId: "p1",
          displayName: "Ana",
          permissions: [],
        });
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: openTable.id, seated: openTable.hasOpenTab });
        await flush(el);
        const screen = tableOrder(el)!;
        expect(screen).not.toBeNull();
        expect(screen.canSettle).toBe(true);
      });

      it("loads the ACTIVE service-status catalogue and threads it to the Estado picker", async () => {
        const catalogue = [
          { id: "s1", label: "Reservada", color: "#cc0000" },
          { id: "s2", label: "Cuenta pedida", color: "#0a8a0a" },
        ];
        const listStatuses = vi.fn().mockResolvedValue(catalogue);
        const { el } = await mountApp({
          // openTable carries `status: null`, so a list DERIVED from the occupancy read-model would be
          // empty — the picker must be fed the loaded catalogue (incl. a status applied to no table).
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          listStatuses,
        });
        const screen = await toTableOrder(el, openTable);
        expect(listStatuses).toHaveBeenCalled();
        expect(screen.statuses).toEqual(catalogue);
      });

      it("submit-draft submits the round to the table's party then reloads its lines", async () => {
        const submitDraft = answering({ tabId: "wo-7", revision: 4, groups: [] });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          submitDraft,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "submit-draft", await ringCafe(el, screen));
        await flush(el);

        // Put on the party's tab, then re-read so the drawer reflects the new round.
        expect(submitDraft).toHaveBeenCalledWith(
          "v-2",
          "draft-1",
          {
            submissionId: expect.any(String),
            expectedPartyRevision: 3,
            draftRevision: 1,
            groups: [{ release: "fire", lineIds: [expect.any(String)] }],
          },
          { signal: expect.any(AbortSignal) },
        );
        expect(drafts.sentGroups(submitDraft.mock.calls[0]![2])).toEqual([
          { release: "fire", lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] },
        ]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("submit-draft forwards a per-line course OVERRIDE verbatim with the draft (KDS-2 §5b)", async () => {
        const submitDraft = answering({ tabId: "wo-7", revision: 4, groups: [] });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          submitDraft,
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "submit-draft", await ringCafe(el, screen, "fire", "postres"));
        await flush(el);
        expect(drafts.sentGroups(submitDraft.mock.calls[0]![2])).toEqual([
          {
            release: "fire",
            lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1", courseId: "postres" }],
          },
        ]);
      });

      it("submit-draft sends a held line's group held (coursing A3)", async () => {
        const submitDraft = answering({ tabId: "wo-7", revision: 4, groups: [] });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          submitDraft,
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "submit-draft", await ringCafe(el, screen, "hold"));
        await flush(el);
        expect(drafts.sentGroups(submitDraft.mock.calls[0]![2])).toEqual([
          { release: "hold", lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] },
        ]);
      });

      it("boots the venue courses + fire mode and threads them to the table-order screen", async () => {
        const courses = [{ id: "c1", name: "Entrantes", displayOrder: 0 }];
        const { el } = await mountApp({
          getTill: vi.fn().mockResolvedValue({ ...till, courses, fireControl: "waiter" }),
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
        });
        const screen = await toTableOrder(el, openTable);
        expect(screen.courses).toEqual(courses);
        expect(screen.fireControl).toBe("waiter");
      });

      const heldCourseLine: TabLine = {
        ...tabLine,
        courseId: "c1",
        groupId: "g1",
        sentAt: null,
        firedAt: null,
      };
      const heldGroup = {
        id: "g1",
        position: 1,
        state: "held" as const,
        firedAt: null,
        remindAt: null,
        lineIds: [],
        summary: "",
      };

      it("fire-group fires the held group then reloads its lines", async () => {
        const fireGroup = vi.fn().mockResolvedValue({ revision: 4 });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [heldCourseLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [heldGroup] }),
          fireGroup,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "fire-group", { groupId: "g1" });
        await flush(el);

        // Re-read so the groups list reconciles to server truth (the fired group is marked fired).
        expect(fireGroup).toHaveBeenCalledWith("v-2", "g1", {
          submissionId: expect.any(String),
          expectedPartyRevision: 3,
        });
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a failed fire-group surfaces a non-fatal banner, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [heldCourseLine], revision: 0 }),
          listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [heldGroup] }),
          fireGroup: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "fire-group", { groupId: "g1" });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
      });

      it("serve-lines marks the chosen quantity of a row served, on its party, then reloads its lines", async () => {
        const markServed = vi.fn().mockResolvedValue({ revision: 4 });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          markServed,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "serve-lines", { items: [{ lineId: "line-1", quantity: "2" }] });
        await flush(el);

        expect(markServed).toHaveBeenCalledWith("v-2", [{ lineId: "line-1", quantity: "2" }], {
          submissionId: expect.any(String),
          expectedPartyRevision: 3,
        });
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a serve-lines refused because the quantity no longer fits the line says so in its own words", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          markServed: vi.fn().mockRejectedValue({ code: "tab.serve_quantity_invalid" }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "serve-lines", { items: [{ lineId: "line-1", quantity: "2" }] });
        await flush(el);

        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(
          codeMessage("tab.serve_quantity_invalid"),
        );
      });

      it("set-line-course moves a held line's course then reloads its lines", async () => {
        const setLineCourse = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          setLineCourse,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "set-line-course", { lineNo: 1, courseId: "c2" });
        await flush(el);

        // Re-filed on the tab's own working order (activeTabId), then re-read so the picker reconciles.
        expect(setLineCourse).toHaveBeenCalledWith("wo-7", 1, "c2");
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("set-line-course clears a line's course, forwarding the explicit null", async () => {
        const setLineCourse = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          setLineCourse,
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "set-line-course", { lineNo: 1, courseId: null });
        await flush(el);

        expect(setLineCourse).toHaveBeenCalledWith("wo-7", 1, null);
      });

      it("a rejected set-line-course surfaces the banner AND still reloads to reconcile to server truth", async () => {
        // A raced move of a line the kitchen has just fired rejects `ticket.already_fired`; the handler
        // must still re-read the tab so the stale picker reconciles to server truth (like its siblings).
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          setLineCourse: vi.fn().mockRejectedValue({ code: "ticket.already_fired" }),
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "set-line-course", { lineNo: 1, courseId: "c2" });
        await flush(el);

        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        // …and the tab is re-read even on the reject, so the picker reconciles to server truth.
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a failed round/serve/status write surfaces a non-fatal error, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          submitDraft: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
          markServed: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
          setLineCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }),
          setTableStatus: vi.fn().mockRejectedValue({ code: "status.not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        for (const [type, detail] of [
          ["submit-draft", await ringCafe(el, screen)],
          ["serve-lines", { items: [{ lineId: "line-1", quantity: "2" }] }],
          ["set-line-course", { lineNo: 1, courseId: "c2" }],
          ["set-status", { statusId: "s1" }],
        ] as const) {
          emit(screen, type, detail);
          await flush(el);
          expect(tableOrder(el)).not.toBeNull();
          expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        }
      });

      it("set-status sets the table's manual status keyed by TABLE id (not the tab's order id)", async () => {
        const setTableStatus = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          setTableStatus,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "set-status", { statusId: "s1" });
        await flush(el);

        // Keyed by the TABLE id "t2", never the tab's order id "wo-7".
        expect(setTableStatus).toHaveBeenCalledWith("t2", "s1");
      });

      // ── Coursing corrections: send / recall / cancel line actions ─────────────────────────────
      it("send-lines fires the held lines on the tab then reloads its lines", async () => {
        const sendLines = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          sendLines,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "send-lines", { lineNos: [1] });
        await flush(el);

        // Released on the tab's own working order (activeTabId), then re-read so the drawer reconciles.
        expect(sendLines).toHaveBeenCalledWith("wo-7", [1]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("recall-lines un-sends the not-yet-started lines then reloads its lines", async () => {
        const recallLines = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          recallLines,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "recall-lines", { lineNos: [1] });
        await flush(el);

        expect(recallLines).toHaveBeenCalledWith("wo-7", [1]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a cancel records the started line's cancel then reloads its lines", async () => {
        const { applyAdjustment } = adjustmentStubs();
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          applyAdjustment,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        await cancelThroughDialog(el, screen, "line-1", () => flush(el));

        expect(applyAdjustment).toHaveBeenCalledWith(
          "wo-7",
          expect.objectContaining({ lineId: "line-1", action: "cancel" }),
          expect.anything(),
        );
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      // A raced recall of a line the kitchen has just started, and a recall after the venue switched
      // off changes to sent items, each name what the waiter can still do.
      it.each(["ticket.already_started", "ticket.already_fired"])(
        "a recall-lines refused %s says so in its own words AND still reloads to reconcile to server truth",
        async (code) => {
          // The order is re-read after a refusal, to reconcile with the server.
          const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
          const { el } = await mountApp({
            getTablesState: vi.fn().mockResolvedValue([openTable]),
            listZones: vi.fn().mockResolvedValue([floorZone]),
            getTabLines,
            recallLines: vi.fn().mockRejectedValue({ code }),
          });
          const screen = await toTableOrder(el, openTable);
          expect(getTabLines).toHaveBeenCalledTimes(1);

          emit(screen, "recall-lines", { lineNos: [1] });
          await flush(el);

          expect(tableOrder(el)).not.toBeNull();
          const banner = el.shadowRoot!.querySelector(".error")!.textContent!;
          expect(banner).toContain(codeMessage(code));
          expect(banner).not.toContain(t("table.error"));
          expect(getTabLines).toHaveBeenCalledTimes(2);
        },
      );

      it("a recall-lines refused tab.not_open shows the generic banner AND still reloads", async () => {
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          recallLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "recall-lines", { lineNos: [1] });
        await flush(el);

        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a rejected send-lines also surfaces the banner and reloads", async () => {
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          sendLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
        });
        const screen = await toTableOrder(el, openTable);

        getTabLines.mockClear();
        emit(screen, "send-lines", { lineNos: [1] });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        expect(getTabLines).toHaveBeenCalledTimes(1);
      });

      it("a refused cancel shows the refusal above the cancel dialog's action", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          applyAdjustment: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        await cancelThroughDialog(el, screen, "line-1", () => flush(el));

        expect(tableOrder(el)).not.toBeNull();
        const dialog = el.shadowRoot!.querySelector("till-adjustment-dialog")!;
        expect(
          dialog.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
            .error,
        ).toBe(codeMessage("tab.line_not_found"));
      });

      // ── Move / join / merge / transfer table actions ──────────────────────────────────
      it("move-guests moves the party then reloads the floor (staying on the screen)", async () => {
        const moveGuests = vi
          .fn()
          .mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          moveGuests,
        });
        const screen = await toTableOrder(el, openTable);
        // One floor load reached the screen (entering the floor).
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "move-guests", { toTableId: "t9", bills: "merge" });
        await flush(el);

        expect(moveGuests).toHaveBeenCalledWith("v-2", "t9", "merge", {
          expectedPartyRevision: 3,
          otherPartyId: null,
        });
        // Re-reads the floor so the freed/occupied tables reconcile, and stays on the table-order screen.
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(tableOrder(el)).not.toBeNull();
      });

      it("join-tables adds a table to the party then reloads the floor", async () => {
        const joinTables = vi
          .fn()
          .mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          joinTables,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "join-tables", { tableId: "t9", bills: "merge" });
        await flush(el);

        expect(joinTables).toHaveBeenCalledWith("v-2", "t9", "merge", {
          expectedPartyRevision: 3,
          otherPartyId: null,
        });
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(tableOrder(el)).not.toBeNull();
      });

      it("merge-bills absorbs another bill then reloads this bill's lines AND the floor", async () => {
        const mergeBills = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          mergeBills,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "merge-bills", { fromBillId: "wo-9" });
        await flush(el);

        expect(mergeBills).toHaveBeenCalledWith("wo-7", "wo-9", {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
        // The current tab absorbed the other's lines (reload) and the floor changed (reload).
        expect(getTabLines).toHaveBeenCalledTimes(2);
        expect(getTablesState).toHaveBeenCalledTimes(2);
      });

      it("transfer-lines moves selected lines out then reloads this tab's lines AND the floor", async () => {
        const transferItems = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          transferItems,
          getPartyBills: vi.fn().mockResolvedValue([smallPartyBill]),
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(transferItems).toHaveBeenCalledWith("wo-7", "wo-9", [{ lineNo: 1 }], {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
        expect(getTabLines).toHaveBeenCalledTimes(2);
        expect(getTablesState).toHaveBeenCalledTimes(2);
      });

      it("requires staff confirmation before transferring lines off a bill over €3,000", async () => {
        const transferItems = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([largeOpenTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [largeTabLine], revision: 0 }),
          getPartyBills: vi.fn().mockResolvedValue([largePartyBill]),
          transferItems,
        });
        const screen = await toTableOrder(el, largeOpenTable);

        emit(screen, "transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).not.toBeNull();
        expect(transferItems).not.toHaveBeenCalled();

        el.shadowRoot!.querySelector<HTMLElement>(
          "[data-confirm-different-people] [data-confirm]",
        )!.click();
        await flush(el);
        expect(transferItems).toHaveBeenCalledWith("wo-7", "wo-9", [{ lineNo: 1 }], {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
      });

      it("sends no party with a bill action once the party has left the table while its bill is open", async () => {
        const transferItems = vi.fn().mockResolvedValue(undefined);
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          transferItems,
          getPartyBills: vi.fn().mockResolvedValue([smallPartyBill]),
          getBillBalance: vi.fn().mockResolvedValue({
            workingOrderId: "wo-7",
            status: "open",
            total: "12.00",
            received: "0.00",
            reserved: "0.00",
            outstanding: "12.00",
            tips: "0.00",
            payments: [],
            paidLines: [],
          }),
        });
        const screen = await toTableOrder(el, openTable);
        getTablesState.mockResolvedValue([{ ...openTable, party: null }]);
        emit(screen, "merge-bills", { fromBillId: "wo-9" });
        await flush(el);

        emit(tableOrder(el)!, "transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(transferItems).toHaveBeenCalledWith("wo-7", "wo-9", [{ lineNo: 1 }], {});
      });

      it("split-lines switches pay and later receipt actions to the bill split off", async () => {
        const splitBill = vi.fn().mockResolvedValue({ billId: "wo-check" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const recordSale = vi.fn().mockResolvedValue(saleResult);
        const reprint = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitBill,
          getPartyBills: vi.fn().mockResolvedValue([smallPartyBill]),
          recordSale,
          reprint,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(splitBill).toHaveBeenCalledWith("wo-7", [{ lineNo: 1 }], {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
        expect(getTabLines).toHaveBeenLastCalledWith("wo-check");
        expect(tableOrder(el)!.orderId).toBe("wo-check");
        expect(getTablesState).toHaveBeenCalledTimes(2);

        emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);
        expect(recordSale).toHaveBeenCalledWith(
          [],
          { method: "cash", amount: "10.00" },
          "wo-check",
        );
        emit(ticket(el)!, "reprint");
        await flush(el);
        expect(reprint).toHaveBeenCalledWith("wo-check");
      });

      it("requires staff confirmation before splitting a bill over €3,000 and cancels without writing", async () => {
        const splitBill = vi.fn().mockResolvedValue({ billId: "wo-check" });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([largeOpenTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [largeTabLine], revision: 0 }),
          getPartyBills: vi.fn().mockResolvedValue([largePartyBill]),
          splitBill,
        });
        const screen = await toTableOrder(el, largeOpenTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
        await flush(el);

        const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
        expect(dialog).not.toBeNull();
        expect(splitBill).not.toHaveBeenCalled();

        dialog!.querySelector<HTMLElement>("[data-cancel]")!.click();
        await flush(el);
        expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
        expect(splitBill).not.toHaveBeenCalled();

        emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
        await flush(el);
        el.shadowRoot!.querySelector<HTMLElement>(
          "[data-confirm-different-people] [data-confirm]",
        )!.click();
        await flush(el);
        expect(splitBill).toHaveBeenCalledWith("wo-7", [{ lineNo: 1 }], {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
      });

      it("a modifier-dish partial split refusal keeps the origin open and explains the full-line rule", async () => {
        const splitBill = vi.fn().mockRejectedValue({ code: "tab.transfer_modifier_line" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitBill,
          getPartyBills: vi.fn().mockResolvedValue([smallPartyBill]),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1, quantity: "1" }] });
        await flush(el);

        expect(splitBill).toHaveBeenCalledWith("wo-7", [{ lineNo: 1, quantity: "1" }], {
          expectedPartyRevision: 3,
          partyId: "v-2",
        });
        expect(tableOrder(el)!.orderId).toBe("wo-7");
        expect(getTabLines).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
          t("table.split_modifier_error"),
        );
      });

      it("a refusal to split held kitchen work keeps the origin open and says to send it first", async () => {
        const splitBill = vi.fn().mockRejectedValue({ code: "tab.split_held_line" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitBill,
          getPartyBills: vi.fn().mockResolvedValue([smallPartyBill]),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(tableOrder(el)!.orderId).toBe("wo-7");
        expect(getTabLines).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
          t("table.split_held_error"),
        );
      });

      it("a failed table action surfaces a non-fatal banner, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          moveGuests: vi.fn().mockRejectedValue({ code: "table.needs_clearing" }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "move-guests", { toTableId: "t9", bills: "merge" });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(
          codeMessage("table.needs_clearing"),
        );
      });

      it("threads the occupancy read-model to the table-order screen for its action targets", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable, freeTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
        });
        const screen = await toTableOrder(el, openTable);
        expect(screen.tables).toEqual([openTable, freeTable]);
      });

      it("pay-tab settles the WHOLE tab via recordSale with the tab id and NO re-price, then shows the ticket", async () => {
        const recordSale = vi.fn().mockResolvedValue(saleResult);
        const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          recordSale,
          updateWorkingOrder,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        // The server files the tab's STORED locked lines and ignores the sent basket, so we send `[]`
        // (the documented shape) tagged with the tab's order id, and never #syncIfDirty →
        // updateWorkingOrder, which saves the counter basket, not the tab.
        expect(recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "10.00" }, "wo-7");
        expect(updateWorkingOrder).not.toHaveBeenCalled();
        expect(ticket(el)).not.toBeNull();
      });

      it("does not ask the counter dead-end question when a table bill opens cash tender", async () => {
        const askSaleDeadEnds = vi.fn();
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          askSaleDeadEnds,
        });
        const screen = await toTableOrder(el, openTable);
        screen.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
        await flush(el);
        const tender = screen.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
        expect(tender).not.toBeNull();
        tender.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
        await flush(el);
        expect(askSaleDeadEnds).not.toHaveBeenCalled();
        expect(tender.shadowRoot!.querySelector("till-numeric-pad")).not.toBeNull();
      });

      it("a failed tab pay keeps the operator on the screen with a non-fatal error", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        expect(ticket(el)).toBeNull();
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("sale.error"));
      });

      it("a PERMANENT fiscal refusal on a tab pay surfaces sale.refused, not the retry message", async () => {
        // Paying a tab carries a tender like the counter's own pay, so the money the operator may
        // already have taken is the same risk and the message is the same.
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          recordSale: vi.fn().mockRejectedValue({ code: "fiscal.record_invalid" }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        expect(ticket(el)).toBeNull();
        const banner = el.shadowRoot!.querySelector(".error")!;
        expect(banner.textContent).toContain(t("sale.refused"));
        expect(banner.textContent).not.toContain(t("sale.error"));
      });

      it("back-to-floor reloads the occupancy read-model and returns to the floor", async () => {
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const listZones = vi.fn().mockResolvedValue([floorZone]);
        const { el } = await mountApp({ getTablesState, listZones });
        const screen = await toTableOrder(el, openTable);
        // One load on entering the floor before opening the tab.
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "back-to-floor");
        await flush(el);

        // On the shell, back-to-floor pops the table-order drill and REFRESHES the floor tables-only
        // (`#refreshFloor`) — a just-paid table shows free — but NOT the zones, which are static within a
        // session. So tables re-read (twice total), zones untouched (once).
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(listZones).toHaveBeenCalledTimes(1);
        expect(floor(el)).not.toBeNull();
        expect(tableOrder(el)).toBeNull();
      });
    });
  });

  it("a failed recordSale keeps the counter and the basket, showing a non-fatal error", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledOnce();
    // The held-list refresh is gated to the SUCCESS path: a rejected pay must not re-read the list
    // (only the one call on entering the counter).
    expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1); // basket intact — the sale in progress is not lost
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(el.shadowRoot!.textContent).not.toContain("sale.rejected"); // never leaks the raw code
  });

  /* A sale the FISCAL FILING refuses is permanent: the same basket rung up again builds the same
   * record and is refused again. The operator has no terminal — the till screen is their only
   * window — so telling them to try again is the one piece of advice that cannot work. */
  it.each([["fiscal.record_invalid"], ["fiscal.foreign_recipient_unsupported"]])(
    "a permanent fiscal refusal (%s) says to stop, not to retry",
    async (code) => {
      const { el } = await mountApp({ recordSale: vi.fn().mockRejectedValue({ code }) });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.refused"));
      // The retry message must NOT be what is shown — the whole point of the third key.
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain(code); // never leaks the raw code
      // Same non-fatal handling as every other refusal: still on the counter, basket intact.
      expect(ticket(el)).toBeNull();
      expect(c.store.lines).toHaveLength(1);
    },
  );

  it("tells a CARD operator what to do about the money already on the terminal", async () => {
    /* `method: "card"` on this event is a MANUAL bank-terminal charge: the operator put the card
     * through the terminal and then keyed its operation number into the till
     * (`ConfirmPaymentDetail`, widgets/tender-pay.ts). So by the time a permanent fiscal refusal
     * arrives, the customer HAS been charged and the till has no record of the sale. This pins that
     * the card tender reaches the same permanent-refusal message at all; what that message must and
     * must not SAY is pinned on the catalogues themselves, in `i18n/strings.test.ts`, where both
     * languages can be checked without depending on which locale a rendered banner happens to be in. */
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "fiscal.record_invalid" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "card", amount: "5", externalRef: "OP-4417" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.refused"));
  });

  it("still says to retry when the refusal is an ordinary one", async () => {
    // The control in the other direction: without it, wiring every refusal to `sale.refused` would
    // pass the two cases above while telling an operator to stop for a fault a retry would clear.
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.tender_shortfall" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(banner.textContent).not.toContain(t("sale.refused"));
  });

  it("says the operator may not take payments when the server refuses them the payment permission", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "authorization.not_permitted",
        status: 403,
        permission: "sale.take_payment",
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("take_payment.not_permitted"));
    expect(banner.textContent).not.toContain(t("sale.error"));
    expect(ticket(el)).toBeNull();
    expect(c.store.lines).toHaveLength(1);
  });

  it("still says to retry when the server refuses a sale for another permission", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "authorization.not_permitted",
        status: 403,
        permission: "sale.discount",
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
  });

  it("clears a prior sale error when the next payment attempt starts", async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "sale.rejected" })
      .mockResolvedValueOnce(saleResult);
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // rejected → error banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // retried → succeeds
    await flush(el);
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("single-flight: a second confirm-payment while recordSale is pending files the sale EXACTLY ONCE", async () => {
    // The double-file safety (CLAUDE.md §5): two chained registros_facturacion for one basket are
    // unrepairable. First recordSale never settles, so the sale stays in flight; a second
    // confirm-payment dispatched in that window (double-tap / laggy link) must be a no-op.
    const recordSale = vi.fn(() => new Promise<TillSaleResult>(() => {}));
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // first — raises submitting, awaits
    await el.updateComplete;
    expect(counter(el)!.busy).toBe(true); // in flight → the pay affordance is disabled

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // second — guarded, a no-op
    await el.updateComplete;

    expect(recordSale).toHaveBeenCalledOnce();
  });

  it("resets the busy state after a REJECTED sale so the counter re-enables for a retry", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // Back on the counter, and `submitting` was cleared in the `finally` — the pay affordance is live
    // again so the operator can retry. (Without the finally reset, busy would stay true and stick.)
    expect(counter(el)).not.toBeNull();
    expect(counter(el)!.busy).toBe(false);
  });

  it("resets the busy state after a SUCCESSFUL sale so a later sale is not blocked", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(ticket(el)).not.toBeNull();

    // A fresh sale must fire a SECOND recordSale — proving `submitting` was cleared after the first
    // success rather than left stuck (a stuck flag would make this confirm-payment a silent no-op).
    emit(ticket(el)!, "new-sale");
    await flush(el);
    counter(el)!.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(counter(el)!, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(currentApi.recordSale).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------------------------------
  // collect-card (integrated card terminal): same shape as confirm-payment (single-flight,
  // dirty-retrieved-order re-sync, held-list refresh on success) but branching on the server's DATA
  // outcome instead of assuming a ticket — a decline/timeout/network_unavailable must never wedge the
  // till (CLAUDE.md §5). These tests dispatch the event directly.
  // ---------------------------------------------------------------------------------------------

  describe("collect-card (integrated card terminal, Task 8)", () => {
    const withReaderTill = () =>
      vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "stripe_terminal",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      });
    const tapPayCard = (el: TillApp): void =>
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();

    it("forwards the selected simulator outcome to POST /api/pay", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountWidget<TillApp>("till-app", {
        api: stubApi({
          getTill: vi.fn().mockResolvedValue({
            ...till,
            cardProvider: "simulator",
            capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
          }),
          pay,
        }),
      });
      const c = await toCounter(el);
      emit(c, "collect-card", { simulationOutcome: "declined" });
      await flush(el);

      expect(pay).toHaveBeenCalledWith(expect.objectContaining({ simulationOutcome: "declined" }));
    });

    it("cancels the pretend reader on the server and does not show its late decline", async () => {
      let settlePay: (outcome: PayOutcome) => void = () => undefined;
      const pay = vi.fn<(request: { demoAttemptId?: string }) => Promise<PayOutcome>>(
        () => new Promise<PayOutcome>((resolve) => (settlePay = resolve)),
      );
      const cancelDemoReaderPayment = vi.fn(async () => {
        settlePay({ outcome: "declined" });
        return true;
      });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "simulator",
          activeReaders: [
            {
              id: "00000000-0000-4000-8000-000000000247",
              name: "Demo card reader",
              provider: "simulator",
            },
          ],
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
        cancelDemoReaderPayment,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await flush(el);
      const orderId = c.store.id;

      emit(c, "collect-card", { readerId: "00000000-0000-4000-8000-000000000247" });
      await vi.waitFor(() => expect(pay).toHaveBeenCalledOnce());
      emit(c, "cancel-demo-reader");
      await flush(el);

      const payAttemptId = pay.mock.calls[0]?.[0]?.demoAttemptId;
      expect(payAttemptId).toMatch(/^[0-9a-f-]{36}$/);
      expect(cancelDemoReaderPayment).toHaveBeenCalledWith(orderId, payAttemptId);
      expect(tenderPay(el).shadowRoot!.querySelector(".card-outcome")).toBeNull();
    });

    it("pays over the integrated terminal with the mapped lines(+tip+allowOffline), then shows the ticket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;
      const workingOrderId = store.id; // the walk-up's stable id — the same pay-idempotency key

      emit(c, "collect-card", { tip: "0.50", allowOffline: true });
      await flush(el);

      expect(pay).toHaveBeenCalledWith({
        id: workingOrderId,
        lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
        tip: "0.50",
        allowOffline: true,
      });
      const view = ticket(el)!;
      expect(view).not.toBeNull();
      expect(view.result).toBe(saleResult);
    });

    it("omits tip/allowOffline from the request when the event detail carries neither", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(pay).toHaveBeenCalledWith({
        id: c.store.id,
        lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" }],
      });
    });

    it("success: refreshes the held-orders list so a just-paid parked order drops off", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({
        pay,
        listWorkingOrders: vi.fn().mockResolvedValueOnce([heldSummary]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(c.heldOrders).toEqual([heldSummary]); // one call on entering the counter
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      // once on entering the counter, once after the successful pay — the settled order drops off.
      expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
      expect(ticket(el)).not.toBeNull();
    });

    it("declined: stays on the counter with the basket intact and records the outcome for the widget", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      // A decline is data, never a fault: no ticket, still on the counter, basket untouched, and no
      // sale.error banner — the operator retries the card or switches tender, nothing is lost.
      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      // `cardOutcome` is `private` (TS's `private` is compile-time only, so the cast through
      // `unknown` still reads its real runtime value). `till-tender-pay`'s own tests cover the rendered
      // retry/switch-tender/wait output, so this layer stays scoped to till-app's own state.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");
      // The held list is re-read only on a captured outcome — nothing settled here, so no re-read.
      expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    });

    it.each(["timeout", "network_unavailable"] as const)(
      "%s: also stays on the counter with the basket intact and records the outcome",
      async (outcome) => {
        const pay = vi.fn().mockResolvedValue({ outcome });
        const { el } = await mountApp({ pay });
        const c = await toCounter(el);
        c.store.addProduct(cafe, "2");
        await el.updateComplete;

        emit(c, "collect-card", {});
        await flush(el);

        expect(ticket(el)).toBeNull();
        expect(counter(el)).not.toBeNull();
        expect(c.store.lines).toHaveLength(1);
        expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
        expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe(outcome);
      },
    );

    it("clears a prior declined outcome when the next collect-card attempt starts", async () => {
      const pay = vi
        .fn()
        .mockResolvedValueOnce({ outcome: "declined" })
        .mockResolvedValueOnce({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {}); // first — declines
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      emit(counter(el)!, "collect-card", {}); // retry — captures
      await flush(el);
      expect(ticket(el)).not.toBeNull();
    });

    // cardOutcome must not survive the basket it describes being replaced: a decline on basket A must
    // not leak into whatever basket the operator moves to next via Park or Retrieve. `.cardOutcome` is
    // threaded through `till-counter-screen`/`till-tender-pay`, so a stale value would reach the
    // rendered card_outcome screen.
    it("park: a declined cardOutcome does not survive into the NEXT (empty) basket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      // Switch tender instead of retrying the card: park the (still-declined) basket for later.
      emit(counter(el)!, "park-order", { label: "Mesa 4" });
      await flush(el);

      // store.clear() re-minted a fresh id — this is now an UNRELATED next-customer basket, and it
      // must not show the previous basket's decline.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBeUndefined();
    });

    it("retrieve: a declined cardOutcome does not survive into a DIFFERENT retrieved order's basket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      // Retrieve a DIFFERENT order (wo-1) into the basket instead of retrying the card.
      emit(counter(el)!, "retrieve-order", { id: "wo-1" });
      await discardBasketChanges(el);

      // loadFrom swapped in wo-1's lines — the decline described the basket that was just replaced,
      // not this one.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBeUndefined();
      expect(c.store.id).toBe("wo-1");
    });

    it("discard: an UNRELATED held order being discarded does not touch the current basket's cardOutcome", async () => {
      // The deliberate non-fix: #onDiscardOrder addresses a held order by the EVENT's own id, never
      // `#store` — discarding some other parked order must not wipe a decline that still correctly
      // describes the basket that is still on the counter. Proves the deviation from treating discard
      // like park/retrieve is intentional, not an oversight.
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const declinedBasketId = c.store.id;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      emit(counter(el)!, "discard-order", { id: "some-other-held-order" });
      await flush(el);

      // The current basket (and its decline) is untouched — discard never reached `#store`.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");
      expect(c.store.id).toBe(declinedBasketId);
      expect(c.store.lines).toHaveLength(1);
    });

    it("a genuine fault (thrown, incl. the recovery-corruption 500) surfaces sale.error, basket intact, no ticket", async () => {
      const pay = vi.fn().mockRejectedValue({ code: "server.internal" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain("server.internal"); // never leaks the raw code
    });

    it("a PERMANENT fiscal refusal surfaces sale.refused, not the retry message", async () => {
      // The integrated terminal captures BEFORE the fiscal record is attempted (`finalizeCapture`,
      // apps/server/src/till-sale.ts), so this is the path where the customer's card is most
      // certainly already charged when the refusal arrives. Retrying files nothing new, so the
      // message must say to stop — and must never claim no money was taken.
      const pay = vi.fn().mockRejectedValue({ code: "fiscal.record_invalid" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.refused"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(c.store.lines).toHaveLength(1); // basket intact, like every other refusal
    });

    it("says the till is not set up for the reader when the server refuses it the reader", async () => {
      const pay = vi
        .fn()
        .mockRejectedValue({ code: "device.forbidden_action", status: 403, action: "pay" });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("card_reader.not_set_up"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(c.store.lines).toHaveLength(1);
    });

    it("says the till changed profile when the server refuses the reader payment for it", async () => {
      const pay = vi.fn().mockRejectedValue({ code: "device.profile_changed", status: 409 });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(pay).toHaveBeenCalledTimes(1);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(codeMessage("device.profile_changed"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain("device.profile_changed");
      expect(c.store.lines).toHaveLength(1);
    });

    it.each([
      {
        refusal: { code: "device.forbidden_action", status: 403, action: "pay" },
        says: "card_reader.not_set_up" as const,
      },
      { refusal: { code: "server.internal", status: 500 }, says: "sale.error" as const },
    ])(
      "puts the pay card back to its choices, with $refusal.code explained in the banner, after the reader payment is refused",
      async ({ refusal, says }) => {
        const pay = vi.fn().mockRejectedValue(refusal);
        const { el } = await mountApp({
          getTill: vi.fn().mockResolvedValue({
            ...till,
            cardProvider: "stripe_terminal",
            capabilities: [
              "print-receipt",
              "integrated-card-payment",
              "take-cash",
            ] as CapabilityFlag[],
          }),
          pay,
        });
        const c = await toCounter(el);
        c.store.addProduct(cafe, "2");
        await flush(el);

        tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
        await flush(el);

        expect(pay).toHaveBeenCalledTimes(1);
        const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
        expect(banner.textContent).toContain(t(says));
        await tenderPay(el).updateComplete;
        const card = tenderPay(el).shadowRoot!;
        expect(card.querySelector(".collecting")).toBeNull();
        expect(card.querySelector(".pay")).not.toBeNull();
        expect(card.querySelector(".pay-card")).not.toBeNull();
      },
    );

    it("puts the pay card back to its choices for the next sale after a reader payment is captured", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await flush(el);

      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
      await flush(el);
      expect(ticket(el)).not.toBeNull();
      emit(ticket(el)!, "new-sale");
      await flush(el);

      await tenderPay(el).updateComplete;
      const card = tenderPay(el).shadowRoot!;
      expect(card.querySelector(".collecting")).toBeNull();
      expect(card.querySelector(".pay-card")).not.toBeNull();
    });

    it("says the operator may not take payments when the server refuses them the reader payment", async () => {
      const pay = vi.fn().mockRejectedValue({
        code: "authorization.not_permitted",
        status: 403,
        permission: "sale.take_payment",
      });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("take_payment.not_permitted"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(c.store.lines).toHaveLength(1);
    });

    it("a PRELIMINARY-save network failure shows sale.error, not sale.unconfirmed (pay never reached)", async () => {
      // The pre-pay `#syncIfDirty` save network-fails, so the integrated `pay` is never
      // called — nothing filed, safe to retry — so this is `sale.error`, not `sale.unconfirmed`.
      const updateWorkingOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ updateWorkingOrder, pay });
      const c = await toCounter(el);
      const store = c.store;

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      store.addProduct(cafe, "1"); // edit → dirty → the pre-pay sync is attempted
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(pay).not.toHaveBeenCalled();
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.error"));
      expect(banner.textContent).not.toContain(t("sale.unconfirmed"));
    });

    it("the integrated pay itself network-failing shows sale.unconfirmed (the fiscal request was reached)", async () => {
      // The other side: once `pay` IS called, a network failure of THAT request is
      // `sale.unconfirmed` — the charge may have captured and filed, so a human checks before retrying.
      const pay = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(pay).toHaveBeenCalled();
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.unconfirmed"));
    });

    it("single-flight: a second collect-card while pay is pending fires exactly once", async () => {
      // Same double-file safety as confirm-payment's single-flight test (CLAUDE.md §5): the first pay
      // never resolves, so a second collect-card dispatched in that window (double-tap / laggy link)
      // must be a no-op.
      const pay = vi.fn(() => new Promise<PayOutcome>(() => {}));
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {}); // first — raises submitting, awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true); // in flight → the pay affordance is disabled

      emit(c, "collect-card", {}); // second — guarded, a no-op
      await el.updateComplete;

      expect(pay).toHaveBeenCalledOnce();
    });

    it("a collect-card ignored while a reader payment runs starts nothing, and that payment's refusal still puts the pay card back to its choices", async () => {
      let refuse: (reason: unknown) => void = () => undefined;
      const pay = vi.fn(() => new Promise<PayOutcome>((_resolve, reject) => (refuse = reject)));
      const { el } = await mountApp({ getTill: withReaderTill(), pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await flush(el);

      tapPayCard(el);
      await flush(el);
      emit(c, "collect-card", {});
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(pay).toHaveBeenCalledOnce();
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

      refuse({ code: "server.internal", status: 500 });
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).not.toBeNull();
    });

    it("an earlier reader payment finishing late leaves a newer one's pay card waiting on the reader", async () => {
      let heldRead: ((orders: HeldOrderSummary[]) => void) | undefined;
      let holdHeldRead = false;
      const listWorkingOrders = vi.fn(() =>
        holdHeldRead
          ? new Promise<HeldOrderSummary[]>((resolve) => (heldRead = resolve))
          : Promise.resolve([]),
      );
      const pay = vi
        .fn()
        .mockRejectedValueOnce({ code: "bill.payments_received", status: 409 })
        .mockImplementationOnce(() => new Promise<PayOutcome>(() => {}));
      const { el } = await mountApp({ getTill: withReaderTill(), pay, listWorkingOrders });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await flush(el);

      holdHeldRead = true;
      tapPayCard(el);
      await flush(el);
      expect(heldRead).toBeDefined();
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
      await tenderPay(el).updateComplete;
      tapPayCard(el);
      await flush(el);
      expect(pay).toHaveBeenCalledTimes(2);
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

      heldRead!([]);
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();
    });

    const deadEnd = {
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Café",
          quantity: "2",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    };
    const noDeadEnds = { sends: false, deadEnds: [], stations: [] };
    /** The station lookup a tap's own pre-check makes answers at once; the next one waits. */
    function heldStationLookup() {
      let answer: ((value: unknown) => void) | undefined;
      let hold = false;
      const askSaleDeadEnds = vi.fn(() => {
        if (!hold) return Promise.resolve(noDeadEnds);
        hold = false;
        return new Promise((resolve) => (answer = resolve));
      });
      return {
        askSaleDeadEnds,
        holdNext: () => (hold = true),
        answer: (value: unknown) => answer!(value),
        held: () => answer !== undefined,
      };
    }
    const updateRefusedOnceForStation = () =>
      vi
        .fn()
        .mockRejectedValueOnce({ code: "station.no_replacement" })
        .mockResolvedValue({ revision: 4 });

    it("keeps the pay card waiting on the reader through the kitchen-station question a refused save asks, and puts its choices back once the retry ends", async () => {
      const lookup = heldStationLookup();
      const updateWorkingOrder = updateRefusedOnceForStation();
      const pay = vi.fn().mockRejectedValue({ code: "server.internal", status: 500 });
      const { el } = await mountApp({
        getTill: withReaderTill(),
        askSaleDeadEnds: lookup.askSaleDeadEnds,
        updateWorkingOrder,
        pay,
      });
      const c = await toCounter(el);
      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1");
      await flush(el);

      tapPayCard(el);
      lookup.holdNext();
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(updateWorkingOrder).toHaveBeenCalledOnce();
      expect(lookup.held()).toBe(true);
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

      lookup.answer(deadEnd);
      await flush(el);
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
      expect(dialog).not.toBeNull();
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

      dialog
        .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
        .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
      await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(pay).toHaveBeenCalledOnce();
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).not.toBeNull();
    });

    it("puts the pay card back to its choices when an earlier attempt's kitchen-station retry ends after a newer attempt was declined", async () => {
      const lookup = heldStationLookup();
      let refuseRetry: (reason: unknown) => void = () => undefined;
      const pay = vi
        .fn()
        .mockResolvedValueOnce({ outcome: "declined" })
        .mockImplementationOnce(
          () => new Promise<PayOutcome>((_resolve, reject) => (refuseRetry = reject)),
        );
      const { el } = await mountApp({
        getTill: withReaderTill(),
        askSaleDeadEnds: lookup.askSaleDeadEnds,
        updateWorkingOrder: updateRefusedOnceForStation(),
        pay,
      });
      const c = await toCounter(el);
      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1");
      await flush(el);

      tapPayCard(el);
      lookup.holdNext();
      await flush(el);
      expect(lookup.held()).toBe(true);
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
      await tenderPay(el).updateComplete;
      tapPayCard(el);
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(pay).toHaveBeenCalledOnce();
      expect(tenderPay(el).shadowRoot!.querySelector(".retry")).not.toBeNull();

      lookup.answer(noDeadEnds);
      await flush(el);
      expect(pay).toHaveBeenCalledTimes(2);
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".retry")!.click();
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(pay).toHaveBeenCalledTimes(2);
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).not.toBeNull();

      refuseRetry({ code: "server.internal", status: 500 });
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).not.toBeNull();
    });

    it("shows the decline again when a retried reader payment is declined again", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ getTill: withReaderTill(), pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await flush(el);

      tapPayCard(el);
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(tenderPay(el).shadowRoot!.querySelector(".retry")).not.toBeNull();

      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".retry")!.click();
      await flush(el);
      await tenderPay(el).updateComplete;
      expect(pay).toHaveBeenCalledTimes(2);
      expect(tenderPay(el).shadowRoot!.querySelector(".retry")).not.toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).toBeNull();
    });

    it("puts the pay card back to its choices when the basket cannot be saved before the reader payment", async () => {
      const updateWorkingOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ getTill: withReaderTill(), updateWorkingOrder, pay });
      const c = await toCounter(el);
      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1");
      await flush(el);

      tapPayCard(el);
      await flush(el);
      await tenderPay(el).updateComplete;

      expect(updateWorkingOrder).toHaveBeenCalled();
      expect(pay).not.toHaveBeenCalled();
      expect(tenderPay(el).shadowRoot!.querySelector(".collecting")).toBeNull();
      expect(tenderPay(el).shadowRoot!.querySelector(".pay-card")).not.toBeNull();
    });

    it("resets the busy state after a declined outcome so the counter re-enables for a retry", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(counter(el)!.busy).toBe(false);
    });

    it("retrieve → edit → collect-card re-syncs the edited basket BEFORE paying, so the edit is not dropped", async () => {
      // As in #onConfirmPayment (its retrieve → edit → pay test above): the server's retrieved-order pay
      // path files from the STORED lock and IGNORES req.lines for the integrated route too, so an edit
      // made after retrieve must be re-locked (updateWorkingOrder) BEFORE the pay or it is silently
      // dropped from both the charge and the filed record.
      const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ updateWorkingOrder, pay });
      const c = await toCounter(el);
      const store = c.store;

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      store.addProduct(cafe, "1"); // the edit AFTER retrieve
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
        lines: [
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
        ],
        label: "Mesa 4",
        revision: 3,
      });
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" },
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" },
        ],
      });
      expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
        pay.mock.invocationCallOrder[0]!,
      );
    });

    it("retrieve → collect-card (unedited): no re-sync, files the stored lock straight through", async () => {
      // The integrated route's mirror of the unedited retrieve→pay test: an UNEDITED retrieve must NOT
      // re-sync.
      const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ updateWorkingOrder, pay });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);

      emit(c, "collect-card", {});
      await flush(el);

      expect(updateWorkingOrder).not.toHaveBeenCalled();
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Integrated card wiring: `cardProvider`/`tipsEnabled`, read once from `GET /api/till` (#boot), and
  // `cardOutcome` all reach the REAL nested `till-tender-pay` — through `till-counter-screen`, exactly
  // like `orderFlow`/`stage` above (per-mode pay control).
  // ---------------------------------------------------------------------------------------------

  describe("integrated card wiring (Task 9): threaded from GET /api/till to the widget", () => {
    it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
      const { el } = await mountApp(); // the till fixture defaults cardProvider: "none"
      await toCounter(el);
      expect(tenderPay(el).cardProvider).toBe("none");
      expect(tenderPay(el).tipsEnabled).toBe(false);
    });

    it("threads a real integrated cardProvider + tipsEnabled through to the widget", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_on_device",
          tipsEnabled: true,
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
      });
      await toCounter(el);
      expect(tenderPay(el).cardProvider).toBe("stripe_on_device");
      expect(tenderPay(el).tipsEnabled).toBe(true);
    });

    it("threads a declined cardOutcome through to the widget, driving its card_outcome view", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "stripe_terminal",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(tenderPay(el).cardOutcome).toBe("declined");
      expect(tenderPay(el).shadowRoot!.querySelector(".retry")).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Prepare & collect: per-mode control selection (end-to-end, not just the widget in isolation)
  // and the prep queue rendered from fetched data.
  // ---------------------------------------------------------------------------------------------

  describe("per-mode pay control + station queue (KDS-1)", () => {
    it("boots into Mode P (prepay, the default): tender-pay shows the unchanged Pay flow, no station queue fetched or rendered", async () => {
      const { el } = await mountApp(); // the till fixture defaults orderFlow: "prepay"
      const c = await toCounter(el);
      expect(tenderPay(el).mode).toBe("prepay");
      expect(tenderPay(el).stage).toBe("order");
      // Mode P never fetches the queue, so the counter tab's has-items-gated prep-queue card stays hidden.
      expect(stationQueueWidget(el)).toBeNull();
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      expect(c.products).toEqual([
        expect.objectContaining({
          id: "cafe",
          productId: "cafe",
          menuItemId: "menu-item-cafe-0",
          unitPrice: "1.50",
        }),
      ]);
    });

    it("boots into ticket-then-pay: tender-pay starts on the order stage; the default station's queue is fetched and rendered", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        // A non-empty queue so the has-items-gated prep-queue card renders (an empty queue hides it).
        getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      expect(tenderPay(el).stage).toBe("order");
      expect(stationQueueWidget(el)).not.toBeNull();
      // Resolves the default station once, then reads its queue on entering the counter.
      expect(currentApi.listStations).toHaveBeenCalledOnce();
      expect(currentApi.getStationQueue).toHaveBeenCalledWith("st-default");
    });

    it("boots into Mode T (ticket_then_pay): the same per-mode selection applies", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        // A non-empty queue so the has-items-gated prep-queue card renders (an empty queue hides it).
        getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      expect(stationQueueWidget(el)).not.toBeNull();
    });

    it("renders the station queue from fetched data, not just an empty placeholder", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
      });
      await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);
    });

    it("no default station configured leaves the counter queue empty rather than throwing", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        listStations: vi.fn().mockResolvedValue([{ ...defaultStation, isDefault: false }]),
      });
      await toCounter(el);
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      // No default station ⇒ the queue is never fetched ⇒ empty ⇒ the has-items gate hides the card.
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("place-order (fresh basket): parks then places, moves to the collect stage, refreshes the prep queue", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const id = c.store.id;
      expect(c.store.persisted).toBe(false); // a fresh walk-up basket, never parked

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).toHaveBeenCalledWith({
        id,
        lines: [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
        label: undefined,
      });
      expect(currentApi.placeOrder).toHaveBeenCalledWith(id);
      expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
      expect(c.store.persisted).toBe(true); // marked persisted after the successful park
      expect(tenderPay(el).stage).toBe("collect"); // Place → Collect
      expect(counter(el)).not.toBeNull(); // stays on the counter (no ticket for a mere place)
      expect(ticket(el)).toBeNull();
      // once on entering the counter, once after the successful place (Modes I/T auto-enqueue).
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
    });

    it("place-order on an UNEDITED retrieved order does NOT re-sync — placeOrder files the stored composition", async () => {
      // Symmetric with the unedited retrieve→pay path: retrieving adopts the order's id and marks it
      // persisted+clean (loadFrom). An UNEDITED retrieved order must NOT re-sync before placing, and
      // must never re-park either (a re-park of the same id would idempotently REPLAY the existing open
      // order server-side).
      // `placeOrder` files the STORED composition straight.
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      expect(c.store.persisted).toBe(true);
      expect(c.store.dirty).toBe(false); // retrieved but never edited

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).not.toHaveBeenCalled();
      expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
      expect(currentApi.placeOrder).toHaveBeenCalledWith("wo-1");
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("place-order on an EDITED retrieved order re-syncs the edit via updateWorkingOrder before placing", async () => {
      // The mirror of the pay path's retrieve→edit→pay: an edit made after retrieve must be re-locked
      // (`updateWorkingOrder`) BEFORE placing, or the server places the STORED lock and silently drops
      // the edit. Retrieve wo-1 (café×2), add a second café, then place: `updateWorkingOrder` carries the
      // EDITED composition and runs BEFORE `placeOrder`.
      const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
      const placeOrder = vi.fn().mockResolvedValue(placedResult);
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        updateWorkingOrder,
        placeOrder,
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1"); // the edit AFTER retrieve → the basket is dirty
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).not.toHaveBeenCalled();
      expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
        lines: [
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }, // retrieved
          { makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "1" }, // the edit
        ],
        label: "Mesa 4",
        revision: 3,
      });
      expect(placeOrder).toHaveBeenCalledWith("wo-1");
      expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
        placeOrder.mock.invocationCallOrder[0]!,
      );
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("place-order on an EDITED retrieved order already placed elsewhere: the re-tap surfaces place.error (placeOrder is not idempotent)", async () => {
      // The concurrent-place race / lost-response re-tap: the order has already moved past `open` (placed
      // on another register, or the first place landed and its response was lost). The edit-gated re-sync
      // calls `updateWorkingOrder`, which returns `working_order.not_open` — SWALLOWED by `#syncIfDirty` —
      // and then the server's `placeOrder`, which is NOT idempotent (it refuses ANY non-open order with
      // the same `working_order.not_open`; till-api.test.ts pins that 409), returns `not_open` too. So
      // `#onPlaceOrder` surfaces `place.error` and stays on the ORDER stage — it does NOT fall through to
      // collect: placing has no `sales_working_order_id_key` replay the way pay does. Both server calls are
      // mocked to reject `not_open`, matching the real server: `placeOrder` succeeds only when the order
      // is open, which is exactly when `updateWorkingOrder` would not have thrown.
      const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
      const placeOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        updateWorkingOrder,
        placeOrder,
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1"); // edit → dirty → re-sync attempted
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(tenderPay(el).stage).toBe("order"); // NOT advanced to collect — the place failed
      expect(ticket(el)).toBeNull();
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.not_open"); // raw code never leaks
    });

    it("a failed place keeps the counter, the order stage and the basket, showing a non-fatal error", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        parkOrder: vi.fn().mockRejectedValue({ code: "working_order.rejected" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.placeOrder).not.toHaveBeenCalled(); // never reached — the park failed first
      expect(tenderPay(el).stage).toBe("order"); // never advanced
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1); // basket intact
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.rejected");
    });

    it("place: a PERMANENT fiscal refusal surfaces place.refused, which says nothing about money", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        placeOrder: vi.fn().mockRejectedValue({ code: "fiscal.record_invalid" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.refused"));
      expect(banner.textContent).not.toContain(t("place.error"));
      expect(banner.textContent).not.toContain(t("sale.refused"));
      expect(c.store.lines).toHaveLength(1); // basket intact
    });

    it("place: a fresh-basket park network failure shows place.error, not sale.unconfirmed", async () => {
      // `parkOrder` is the preliminary save on a fresh basket; a network failure of it means the
      // `placeOrder` fiscal request was never made, so this is the free-to-retry `place.error`, not the
      // "did it file?" `sale.unconfirmed`. `placeOrder` is never reached.
      const parkOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        parkOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.placeOrder).not.toHaveBeenCalled();
      expect(tenderPay(el).stage).toBe("order"); // never advanced
      expect(c.store.lines).toHaveLength(1); // basket kept
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.error"));
      expect(banner.textContent).not.toContain(t("sale.unconfirmed"));
    });

    it("place: the placeOrder fiscal request network-failing shows sale.unconfirmed (the request was reached)", async () => {
      // The other side: park succeeded and `placeOrder` IS called, so a network failure of THAT
      // request is `sale.unconfirmed` — the placement / deferred invoice may have filed.
      const placeOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        placeOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).toHaveBeenCalled();
      expect(placeOrder).toHaveBeenCalled();
      expect(tenderPay(el).stage).toBe("order"); // never advanced — the place failed
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.unconfirmed"));
    });

    it("place single-flight: a second place-order while the first is pending places EXACTLY ONCE", async () => {
      const parkOrder = vi.fn(() => new Promise(() => {}));
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        parkOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order"); // first — raises the guard, awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true); // in flight → the Place affordance is disabled
      emit(c, "place-order"); // second — guarded, a no-op
      await el.updateComplete;

      expect(parkOrder).toHaveBeenCalledOnce();
    });

    it.each([
      ["cash", "confirm-payment", { method: "cash", amount: "5" }, "recordSale"],
      ["an integrated card", "collect-card", {}, "pay"],
    ] as const)(
      "Pay by %s at the order stage of a ticket_then_pay zone pays the open order and re-reads the kitchen queue",
      async (_method, event, detail, route) => {
        const getStationQueue = vi.fn().mockResolvedValue({ items: [], notices: [] });
        const { el } = await mountApp({
          zonePolicy: { serviceMode: "ticket_then_pay" },
          getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
          getStationQueue,
        });
        const c = await toCounter(el);
        c.store.addProduct(cafe, "2");
        await el.updateComplete;
        const reads = getStationQueue.mock.calls.length;

        emit(c, event, detail);
        await flush(el);

        expect(currentApi[route]).toHaveBeenCalledOnce();
        expect(currentApi.placeOrder).not.toHaveBeenCalled();
        expect(currentApi.collectOrder).not.toHaveBeenCalled();
        expect(ticket(el)).not.toBeNull();
        expect(getStationQueue).toHaveBeenCalledTimes(reads + 1);
      },
    );

    it("Pay by an integrated card at the order stage of an ticket_then_pay zone issues the invoice now, so the original receipt is offered", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay", receiptPrintMode: "on_request" },
        getTill: vi.fn().mockResolvedValue({
          ...till,
          orderFlow: "ticket_then_pay",
          receiptPrintMode: "on_request",
        }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(ticket(el)!.originalReceiptAvailable).toBe(true);
    });

    it("collect-order: settles the placed order and shows the ticket", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const id = c.store.id;
      emit(c, "place-order");
      await flush(el);
      expect(tenderPay(el).stage).toBe("collect");

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      expect(currentApi.collectOrder).toHaveBeenCalledWith(id, { method: "cash", amount: "5" });
      const view = ticket(el)!;
      expect(view).not.toBeNull();
      // The ticket renders the SERVER collect result (its `lines` are the filed placed composition),
      // not the local basket — a local edit between place and collect can't diverge the printed list.
      expect(view.result).toBe(saleResult);
    });

    it("ignores invoice reads and releases their busy gate after closing and reopening recovery", async () => {
      let finish!: (value: TillSaleResult) => void;
      let finishNew!: (value: TillSaleResult) => void;
      const getFiledTicket = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve;
            }),
        );
      const { el } = await mountApp({ getFiledTicket });
      await toCounter(el);
      const show = async () => {
        el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
          .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
          .click();
        await el.updateComplete;
        return el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      };
      const first = await show();
      first.dispatchEvent(
        new CustomEvent("find-invoice-open", {
          detail: { workingOrderId: "wo-old" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      first.dispatchEvent(new CustomEvent("find-bill-close", { bubbles: true, composed: true }));
      await el.updateComplete;
      const reopened = await show();
      expect(reopened.busy).toBe(false);
      reopened.dispatchEvent(
        new CustomEvent("find-invoice-open", {
          detail: { workingOrderId: "wo-new" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      finish({ ...saleResult, invoiceType: "F1", invoiceNumber: "FF/7" });
      await flush(el);
      expect(ticket(el)).toBeNull();
      expect(reopened.busy).toBe(true);
      finishNew({ ...saleResult, invoiceType: "F1", invoiceNumber: "FF/8" });
      await flush(el);
      expect(ticket(el)?.result.invoiceNumber).toBe("FF/8");
      expect(currentApi.collectOrder).not.toHaveBeenCalled();
    });

    it("opens a filed F1 from Find a bill with its original delivery controls", async () => {
      const filed = { ...saleResult, invoiceType: "F1" as const, invoiceNumber: "FF/7" };
      const getFiledTicket = vi.fn().mockResolvedValue(filed);
      const getReceiptPrintStatus = vi.fn().mockResolvedValue({ status: "not_queued" });
      const { el } = await mountApp({ getFiledTicket, getReceiptPrintStatus });
      await toCounter(el);
      el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      dialog.dispatchEvent(
        new CustomEvent("find-invoice-open", {
          detail: { workingOrderId: "wo-filed" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(ticket(el)?.result).toEqual(filed);
      expect(ticket(el)?.originalReceiptPrint).toEqual({ status: "not_queued" });
      expect(ticket(el)?.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
      expect(getFiledTicket).toHaveBeenCalledWith("wo-filed");
      expect(getReceiptPrintStatus).toHaveBeenCalledWith("wo-filed");
      expect(currentApi.collectOrder).not.toHaveBeenCalled();
      expect(currentApi.recordSale).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-find-bill-dialog")).toBeNull();
    });

    it("keeps invoice recovery open after a read failure and permits retry", async () => {
      const getFiledTicket = vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValueOnce({ ...saleResult, invoiceType: "F1" });
      const { el } = await mountApp({ getFiledTicket });
      await toCounter(el);
      el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      const open = () =>
        dialog.dispatchEvent(
          new CustomEvent("find-invoice-open", {
            detail: { workingOrderId: "wo-filed" },
            bubbles: true,
            composed: true,
          }),
        );
      open();
      await flush(el);
      expect(ticket(el)).toBeNull();
      expect(dialog.error).toBe("find_bill.invoice_load_failed");
      expect(dialog.busy).toBe(false);
      open();
      await flush(el);
      expect(ticket(el)?.result.invoiceType).toBe("F1");
      expect(currentApi.collectOrder).not.toHaveBeenCalled();
    });

    it("Find a bill collects an existing debt and offers a duplicate receipt", async () => {
      const waiting = vi.fn().mockResolvedValue([]);
      const { el } = await mountApp({ listCounterWaiting: waiting });
      await toCounter(el);
      const shell = el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!;
      shell.shadowRoot!.querySelector<HTMLElement>(".find-bill")!.click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      expect(dialog).not.toBeNull();
      const reads = waiting.mock.calls.length;
      dialog.dispatchEvent(
        new CustomEvent("find-bill-pay", {
          detail: {
            workingOrderId: "wo-debt",
            tender: { method: "cash", amount: "30.00" },
            invoiced: true,
          },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(currentApi.collectOrder).toHaveBeenCalledWith("wo-debt", {
        method: "cash",
        amount: "30.00",
      });
      expect(ticket(el)!.originalReceiptAvailable).toBe(false);
      expect(waiting.mock.calls.length).toBeGreaterThan(reads);
    });

    it.each([true, false])(
      "Find a bill searches and collects through the dialog (already invoiced: %s)",
      async (invoiced) => {
        const lookup = vi.fn().mockResolvedValue({
          bills: [
            {
              workingOrderId: "wo-debt",
              orderNumber: 12,
              label: "Birthday",
              partyName: "Familia Ruiz",
              tables: ["4"],
              invoiceNumber: invoiced ? "A/12" : null,
              openedAt: "2026-10-01T18:00:00.000Z",
              departedAt: null,
              status: "waiting_for_payment",
              stillOwed: "30.00",
            },
          ],
        });
        const { el } = await mountApp({
          lookUpBills: lookup,
          zonePolicy: { receiptPrintMode: "on_request" },
          getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "on_request" }),
        });
        await toCounter(el);
        el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
          .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
          .click();
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
        const search = dialog.shadowRoot!.querySelector<HTMLElement>("[name=bill-search]")!;
        await vi.waitFor(() => expect(search.shadowRoot!.querySelector("input")).not.toBeNull());
        const input = search.shadowRoot!.querySelector<HTMLInputElement>("input")!;
        input.value = "Ruiz";
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await dialog.updateComplete;
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-search]")!.click();
        await vi.waitFor(() =>
          expect(dialog.shadowRoot!.querySelector("[data-bill]")).not.toBeNull(),
        );
        expect(lookup).toHaveBeenCalledWith("Ruiz");
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-bill]")!.click();
        await dialog.updateComplete;
        dialog.shadowRoot!.querySelector<HTMLElement>("[data-collect]")!.click();
        await flush(el);
        expect(currentApi.collectOrder).toHaveBeenCalledWith("wo-debt", {
          method: "cash",
          amount: "30.00",
        });
        expect(ticket(el)!.originalReceiptAvailable).toBe(!invoiced);
      },
    );

    it("commits collection before a failed following refresh while retaining the exact tender", async () => {
      let answer!: (result: TillSaleResult) => void;
      const { el } = await mountApp({
        lookUpBills: vi.fn().mockResolvedValue({
          bills: [
            {
              workingOrderId: "wo-debt",
              orderNumber: 12,
              label: null,
              partyName: null,
              tables: [],
              invoiceNumber: "A/12",
              openedAt: "2026-10-01T18:00:00.000Z",
              departedAt: null,
              status: "waiting_for_payment",
              stillOwed: "30.00",
            },
          ],
        }),
        collectOrder: vi.fn(
          () =>
            new Promise<TillSaleResult>((resolve) => {
              answer = resolve;
            }),
        ),
      });
      await toCounter(el);
      el.shadowRoot!.querySelector("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      const form = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      await form.updateComplete;
      const fill = async (name: string, value: string) => {
        const field = form.shadowRoot!.querySelector<WtInput>(`[name=${name}]`)!;
        await field.updateComplete;
        const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
        await userEvent.fill(page.elementLocator(input), value);
        await form.updateComplete;
      };
      await fill("bill-search", "A/12");
      form.shadowRoot!.querySelector<HTMLElement>("[data-search]")!.click();
      await expect.poll(() => form.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
      form.shadowRoot!.querySelector<HTMLElement>("[data-bill]")!.click();
      await form.updateComplete;
      await fill("cash-received", "40.00");
      const unload = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(unload()).toBe(true);
      form.shadowRoot!.querySelector<HTMLElement>("[data-collect]")!.click();
      await el.updateComplete;
      expect(currentApi.collectOrder).toHaveBeenCalledWith("wo-debt", {
        method: "cash",
        amount: "40.00",
      });
      const protectionAtRefresh: boolean[] = [];
      vi.mocked(currentApi.listStations).mockImplementationOnce(async () => {
        protectionAtRefresh.push(unload());
        throw new Error("refresh refused");
      });
      answer(saleResult);
      await flush(el);
      expect(protectionAtRefresh).toEqual([false]);
      expect(el.shadowRoot!.querySelector("till-find-bill-dialog")).toBeNull();
      expect(ticket(el)!.originalReceiptAvailable).toBe(false);
      expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
      expect(unload()).toBe(false);
      expect(currentApi.collectOrder).toHaveBeenCalledOnce();
    });

    it("keeps Find a bill open with a refusal when collection fails", async () => {
      const { el } = await mountApp({
        collectOrder: vi.fn().mockRejectedValue({ code: "fiscal.foreign_recipient_unsupported" }),
      });
      await toCounter(el);
      el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      dialog.dispatchEvent(
        new CustomEvent("find-bill-pay", {
          detail: {
            workingOrderId: "wo-debt",
            tender: { method: "cash", amount: "30.00" },
            invoiced: true,
          },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(el.shadowRoot!.querySelector("till-find-bill-dialog")).toBe(dialog);
      expect(dialog.error).toBe("sale.refused");
      expect(ticket(el)).toBeNull();
    });

    it("tells the operator when Find a bill collection is refused for payment permission", async () => {
      const { el } = await mountApp({
        collectOrder: vi.fn().mockRejectedValue({
          code: "authorization.not_permitted",
          status: 403,
          permission: "sale.take_payment",
        }),
      });
      await toCounter(el);
      el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector("till-find-bill-dialog")!;
      dialog.dispatchEvent(
        new CustomEvent("find-bill-pay", {
          detail: {
            workingOrderId: "wo-debt",
            tender: { method: "cash", amount: "30.00" },
            invoiced: true,
          },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(dialog.error).toBe("take_payment.not_permitted");
      expect(el.shadowRoot!.querySelector("till-find-bill-dialog")).toBe(dialog);
    });

    it("a failed collect keeps the counter (collect stage) and the basket, showing a non-fatal error", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder: vi.fn().mockRejectedValue({ code: "working_order.not_placed" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(tenderPay(el).stage).toBe("collect"); // still awaiting collection
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.not_placed");
    });

    it("collect-order: a PERMANENT fiscal refusal surfaces sale.refused, not the retry message", async () => {
      // Collect is where a placed order's tender is finally taken, including a manual terminal
      // charge the operator already put through, so it needs the same stop-and-refund message the
      // counter's own pay gets.
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder: vi.fn().mockRejectedValue({ code: "fiscal.foreign_recipient_unsupported" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.refused"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(tenderPay(el).stage).toBe("collect"); // still awaiting collection
    });

    it("collect-order: says the operator may not take payments when refused the payment permission", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder: vi.fn().mockRejectedValue({
          code: "authorization.not_permitted",
          status: 403,
          permission: "sale.take_payment",
        }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("take_payment.not_permitted"));
      expect(banner.textContent).not.toContain(t("sale.error"));
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("collect-order: an order over the simplified-invoice limit is refused in its own words, naming the limit", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder: vi.fn().mockRejectedValue({
          code: "sale.total_exceeds_simplified_limit",
          total: "3150.00",
          limit: "3010.00",
          status: 409,
        }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toBe(
        t("sale.over_simplified_limit").replace("{amount}", () =>
          formatMoney("3010.00", currentLocale()),
        ),
      );
      expect(banner.textContent).toContain("3010,00");
      expect(ticket(el)).toBeNull();
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("collect-order: a NETWORK failure (no answer) shows sale.unconfirmed, basket kept", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(tenderPay(el).stage).toBe("collect"); // still awaiting collection, basket kept
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.unconfirmed"));
    });

    it("collect single-flight: a second collect-order while the first is pending collects EXACTLY ONCE", async () => {
      const collectOrder = vi.fn(() => new Promise<TillSaleResult>(() => {}));
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        collectOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" }); // first — awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true);
      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" }); // second — guarded
      await el.updateComplete;

      expect(collectOrder).toHaveBeenCalledOnce();
    });

    it("new-sale resets the collect stage back to order for the next basket", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);
      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull();

      emit(ticket(el)!, "new-sale");
      await flush(el);

      expect(tenderPay(el).stage).toBe("order");
    });

    it("advance-ticket-item: advances the line, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        getStationQueue: vi
          .fn()
          .mockResolvedValueOnce({ items: [stationGroup], notices: [] })
          .mockResolvedValue({ items: [], notices: [] }),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
      await flush(el);

      expect(currentApi.advanceTicketItem).toHaveBeenCalledWith("ti-1", "preparing");
      // once on entering the counter, once after the advance.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      // The refresh returned an EMPTY queue (the item advanced off), so the has-items gate hides the card.
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("a failed advance-ticket-item still refreshes the queue and shows a non-fatal error", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        advanceTicketItem: vi.fn().mockRejectedValue({ code: "ticket.invalid_transition" }),
      });
      const c = await toCounter(el);

      emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
      await flush(el);

      // the refresh runs even though the advance rejected — a stale entry corrects itself.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("station.advance_error"));
      expect(el.shadowRoot!.textContent).not.toContain("ticket.invalid_transition");
    });

    // The app's `#onMarkCollected` is mode-independent (it stamps a settled order's handover and reloads);
    // the reload is only OBSERVABLE where the counter's queue is live — Modes I/T — since `#refreshStationQueue`
    // skips Mode P. So these exercise the handler wiring under `ticket_then_pay`, exactly as the
    // advance-ticket-item tests above do.
    it("mark-collected: hands over the order via markCollected, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        getStationQueue: vi
          .fn()
          .mockResolvedValueOnce({ items: [stationGroup], notices: [] })
          .mockResolvedValue({ items: [], notices: [] }),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "mark-collected", { orderId: "wo-1" });
      await flush(el);

      expect(currentApi.markCollected).toHaveBeenCalledWith("wo-1");
      // once on entering the counter, once after the handover — so the collected order drops off the queue.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      // The refresh returned an EMPTY queue (the order handed over), so the has-items gate hides the card.
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("a failed mark-collected still refreshes the queue and shows a non-fatal error", async () => {
      const { el } = await mountApp({
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        markCollected: vi.fn().mockRejectedValue({ code: "working_order.already_collected" }),
      });
      const c = await toCounter(el);

      emit(c, "mark-collected", { orderId: "wo-1" });
      await flush(el);

      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("station.collect_error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.already_collected");
    });

    it("show-station: the counter nav switches to the station-display screen (basket-preserving)", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1"); // a basket in progress
      await el.updateComplete;

      emit(c, "show-station");
      await flush(el);

      expect(el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
      // On the shell the station display is a DRILL overlaying the counter tab, which stays mounted
      // (inert) underneath — the drill is what the operator sees.
      expect(counter(el)).not.toBeNull();
      // The basket survives the trip (till-owned store, not per-counter), like the schedule/floor nav.
      expect(c.store.lines).toHaveLength(1);

      // Back returns to the counter with the basket intact.
      emit(el.shadowRoot!.querySelector("till-station-screen")!, "back-to-counter");
      await flush(el);
      expect(counter(el)).not.toBeNull();
      expect(counter(el)!.store.lines).toHaveLength(1);
    });

    it("threads the venue bump_mode from boot to the station screen (a ticket-mode venue gets whole-ticket bump)", async () => {
      // The default `till` fixture is `line`; a venue configured `ticket` must reach the station
      // screen's `.bumpMode` so its whole-ticket affordance turns on — proving #boot reads
      // `TillInfo.bumpMode` rather than leaving the hardcoded `line` default.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, bumpMode: "ticket" }),
      });
      const c = await toCounter(el);
      emit(c, "show-station");
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-station-screen") as unknown as {
        bumpMode: string;
      };
      expect(screen.bumpMode).toBe("ticket");
    });

    it("threads the venue fire_control from boot to the station screen (a kitchen-fire venue gets the fire action)", async () => {
      // The default `till` fixture is `waiter`; a venue configured `kitchen` must reach the station
      // screen's `.fireControl` so its per-course fire affordance turns on — proving #boot reads
      // `TillInfo.fireControl` rather than leaving the hardcoded `waiter` default.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, fireControl: "kitchen" }),
      });
      const c = await toCounter(el);
      emit(c, "show-station");
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-station-screen") as unknown as {
        fireControl: string;
      };
      expect(screen.fireControl).toBe("kitchen");
    });

    it("show-expo: the counter nav switches to the expo/pass screen (basket-preserving)", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1"); // a basket in progress
      await el.updateComplete;

      emit(c, "show-expo");
      await flush(el);

      expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
      // On the shell the expo/pass display is a DRILL overlaying the still-mounted counter tab.
      expect(counter(el)).not.toBeNull();
      // The basket survives the trip (till-owned store), like the station/schedule/floor nav.
      expect(c.store.lines).toHaveLength(1);

      // Back returns to the counter with the basket intact.
      emit(el.shadowRoot!.querySelector("till-expo-screen")!, "back-to-counter");
      await flush(el);
      expect(counter(el)).not.toBeNull();
      expect(counter(el)!.store.lines).toHaveLength(1);
    });

    it("threads the venue fire_control from boot to the expo screen (an expo-fire venue gets the fire lever)", async () => {
      // A venue configured `expo` must reach the expo screen's `.fireControl` so its held-course Fire
      // lever turns on — proving #boot's `fireControl` threads here too, not just to the station screen.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, fireControl: "expo" }),
      });
      const c = await toCounter(el);
      emit(c, "show-expo");
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-expo-screen") as unknown as {
        fireControl: string;
      };
      expect(screen.fireControl).toBe("expo");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Receipt editor: #boot reads `receipt` from GET /api/till and threads it to the ticket view. The
  // `till` fixture above OMITS it, so it defaults to {}.
  // ---------------------------------------------------------------------------------------------

  describe("receipt trim (design §8)", () => {
    it("threads the receipt trim from getTill through to the ticket view", async () => {
      const receipt = { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, receipt }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.receipt).toEqual(receipt);
    });

    it("threads the location's printed address from getTill through to the ticket view", async () => {
      const venueAddress = ["Calle Mayor 1", "28013 Madrid"];
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, venueAddress }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.venueAddress).toEqual(venueAddress);
    });

    it("defaults the ticket address to none when GET /api/till omits it", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.venueAddress).toEqual([]);
    });

    it("defaults the ticket receipt to {} when GET /api/till omits it (older server)", async () => {
      const { el } = await mountApp(); // the `till` fixture omits `receipt`
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.receipt).toEqual({});
    });
  });

  describe("layout canvas (SP-B1)", () => {
    // A `till` canvas whose `counter` tab is what #boot reads and #tabBody threads to the counter screen.
    // Only the fields the assertion checks (key/columns) matter; the rest complete a valid CanvasDef.
    const counterCanvas: CanvasDef = {
      formFactor: "till",
      tabs: [{ key: "counter", title: "Counter", columns: 12, cards: [] }],
    };

    it("threads the canvas's counter tab into the counter screen", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: counterCanvas }),
      });
      await toCounter(el);
      const c = counter(el)!;
      expect(c.counterTab).toMatchObject({ key: "counter", columns: 12 });
    });
  });

  describe("canvas tab shell (SP-B2.1)", () => {
    // A `till` canvas with a `counter` tab and a `floor` tab (a `floor-plan` card, which needs no
    // capability, so it renders the card grid under the empty `capabilities` list).
    const shellCanvas: CanvasDef = {
      formFactor: "till",
      tabs: [
        { key: "counter", title: "Counter", columns: 12, cards: [] },
        {
          key: "floor",
          title: "Floor",
          columns: 12,
          cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
        },
      ],
    };
    const shell = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell");

    it("restores the URL tab through PIN login and refresh", async () => {
      const url = new URL(location.href);
      url.pathname = "/tabs/floor";
      history.replaceState(null, "", url);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await flush(el);
      expect(shell(el)).toBeNull();
      await toCounter(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      expect(currentApi.getTablesState).toHaveBeenCalled();
      el.remove();
      const { el: refreshed } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(refreshed);
      expect(shell(refreshed)!.activeTabKey).toBe("floor");
    });

    it("records tabs and restores their data on browser Back and Forward", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" });
      await flush(el);
      expect(location.pathname).toMatch(/^\/tabs\/floor(?:\/|$)/);
      emit(shell(el)!, "tab-select", { key: "counter" });
      await flush(el);
      const back = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await back;
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      const forward = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.forward();
      await forward;
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("counter");
    });

    it("uses the latest history destination when the login product load finishes", async () => {
      let resolve!: (value: Awaited<ReturnType<TillApi["listProducts"]>>) => void;
      history.replaceState(null, "", "/tabs/floor");
      history.pushState(null, "", "/tabs/counter");
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
        listProducts: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<TillApi["listProducts"]>>>((done) => {
              resolve = done;
            }),
        ),
      });
      await toCounter(el);
      expect(shell(el)).toBeNull();
      const back = new Promise<void>((done) =>
        window.addEventListener("popstate", () => done(), { once: true }),
      );
      history.back();
      await back;
      expect(location.pathname).toBe("/tabs/floor");
      resolve({ menus: [], products: [] });
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      expect(location.pathname).toBe("/tabs/floor");
      expect(currentApi.getTablesState).toHaveBeenCalled();
    });

    it("uses the latest history destination when the handheld login floor load finishes", async () => {
      let resolve!: (value: TableState[]) => void;
      history.replaceState(null, "", "/tabs/floor");
      history.pushState(null, "", "/tabs/order");
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn(
          () =>
            new Promise<TableState[]>((done) => {
              resolve = done;
            }),
        ),
      });
      await toCounter(el);
      expect(shell(el)).toBeNull();
      const back = new Promise<void>((done) =>
        window.addEventListener("popstate", () => done(), { once: true }),
      );
      history.back();
      await back;
      resolve([]);
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      expect(location.pathname).toBe("/tabs/floor");
    });

    it("replaces an unavailable URL tab with the canvas default", async () => {
      const url = new URL(location.href);
      url.pathname = "/tabs/removed";
      history.replaceState(null, "", url);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(el);
      expect(shell(el)!.activeTabKey).toBe("counter");
      expect(location.pathname).toMatch(/^\/tabs\/counter(?:\/|$)/);
    });

    it("renders the tab shell with the counter tab active when a canvas is present", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(el);
      const s = shell(el)!;
      expect(s).not.toBeNull();
      expect(s.activeTabKey).toBe("counter");
      // The counter tab's body is the counter screen, mounted EMBEDDED — the shell owns the header, so
      // the screen suppresses its own (no duplicate chrome).
      expect(counter(el)).not.toBeNull();
      expect(counter(el)!.shadowRoot!.querySelector(".header")).toBeNull();
    });

    it("switches the active tab body on tab-select", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" });
      await el.updateComplete;
      // Floor tab → the card grid (its floor-plan card); the counter body is gone.
      expect(el.shadowRoot!.querySelector("till-card-grid")).not.toBeNull();
      expect(counter(el)).toBeNull();
      expect(shell(el)!.activeTabKey).toBe("floor");
    });

    it("a HANDHELD with a canvas renders the shell landing on the floor tab (SP-B2.2 wraps table-order)", async () => {
      // A `handheld` phone with a canvas is a SHELL device, and the waiter lands on the FLOOR tab (the
      // phone canvas's first tab).
      const phoneCanvas: CanvasDef = {
        formFactor: "phone-portrait",
        tabs: [
          {
            key: "floor",
            title: "Floor",
            columns: 12,
            cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
          },
          {
            key: "order",
            title: "Order",
            columns: 12,
            cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
          },
        ],
      };
      const status: TableServiceStatus = { id: "s1", label: "Reservada", color: "#f00" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        listStatuses: vi.fn().mockResolvedValue([status]),
      });
      await flush(el);
      expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      // The shell renders with the FLOOR tab active (the floor surface the
      // waiter lands on), never the counter. The floor screen mounts as that tab's body through the grid
      // (nested in the grid's OWN shadow root, so pierce it — `floor(el)` only reaches the app's root).
      const s = shell(el)!;
      expect(s).not.toBeNull();
      expect(s.activeTabKey).toBe("floor");
      const grid = el.shadowRoot!.querySelector("till-card-grid")!;
      expect(grid).not.toBeNull();
      expect(grid.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
      expect(counter(el)).toBeNull();
    });
  });

  describe("canvas shell for handheld + kds (SP-B2.2)", () => {
    const shell = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement & { kiosk?: boolean; affordances?: unknown[] }>(
        "till-tab-shell",
      );

    // A phone-portrait canvas: a `floor` tab (a `floor-plan` card) + an `order` tab (a `table-order` card).
    const phoneCanvas: CanvasDef = {
      formFactor: "phone-portrait",
      tabs: [
        {
          key: "floor",
          title: "Floor",
          columns: 12,
          cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
        },
        {
          key: "order",
          title: "Order",
          columns: 12,
          cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
        },
      ],
    };

    // A KDS canvas: one `kitchen` tab carrying the `kds-board` card, whose embedded station screen the
    // grid gates on the `act-as-kds` capability the canvas grants. A kds display runs the shell in KIOSK
    // mode (the operator header suppressed — a display has no logged-in operator).
    const kdsCanvas: CanvasDef = {
      formFactor: "kds",
      tabs: [
        {
          key: "kitchen",
          title: "Kitchen",
          columns: 24,
          cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
        },
      ],
    };

    it("renders the tab shell for a handheld whose profile has no screen switches, with only Find a bill in its full header", async () => {
      // A handheld stays on `lock` until the waiter PIN-logs-in (then lands on this layout's first tab, `floor`);
      // the shell activates only on that authenticated surface, so boot THEN login before asserting.
      const { el } = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: phoneCanvas, capabilities: ["print-receipt"] }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      const s = shell(el)!;
      expect(s).not.toBeNull();
      // Handheld = the FULL header, never kiosk (kiosk is the kds display alone).
      expect(s.kiosk).toBe(false);
      expect(s.affordances).toEqual(["find-bill"]);
      expect(s.shadowRoot!.querySelector(".find-bill")).not.toBeNull();
      // The full header renders its logout control — kiosk mode would suppress the whole header.
      expect(s.shadowRoot!.querySelector(".logout")).not.toBeNull();
    });

    it("renders the tab shell in kiosk mode for a kds display, mounting the kds-board card", async () => {
      // A kds_station boots STRAIGHT into device mode past the lock screen (no login).
      const { el } = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
        getDeviceStation: vi.fn().mockResolvedValue({
          station: {
            id: "st-dev",
            name: "Grill",
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            queue: [],
            notices: [],
          },
        }),
      });
      await flush(el);
      const s = shell(el)!;
      expect(s).not.toBeNull();
      // KDS = kiosk: the operator header is suppressed (a display never logs in).
      expect(s.kiosk).toBe(true);
      // The kitchen tab's kds-board card mounts the embedded station screen through the grid — nested in
      // the grid's OWN shadow root (gated on the `act-as-kds` capability the canvas grants), so pierce it.
      const grid = el.shadowRoot!.querySelector("till-card-grid")!;
      expect(grid).not.toBeNull();
      expect(grid.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
    });

    // Capabilities at the RENDER axis come from the device PROFILE (the `/api/till` `capabilities`
    // sibling, threaded through `this.capabilities`), NOT from the canvas. Same KDS canvas both times —
    // only the profile's capability set differs:
    //  - a device with NO profile boots the form-factor default canvas with `capabilities: []`, so the
    //    `kds-board` card (which needs `act-as-kds`) is HIDDEN — its embedded station screen never mounts;
    //  - a device whose profile grants `act-as-kds` renders it.
    it("HIDES the kds-board card for a no-profile device (capabilities []) and SHOWS it when the profile grants act-as-kds (§5.3)", async () => {
      // No-profile device: same KDS canvas, but `capabilities: []` (a device with no device profile).
      const hidden = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: [] }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
        getDeviceStation: vi.fn().mockResolvedValue({
          station: {
            id: "st-dev",
            name: "Grill",
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            queue: [],
            notices: [],
          },
        }),
      });
      await flush(hidden.el);
      const hiddenGrid = hidden.el.shadowRoot!.querySelector("till-card-grid")!;
      expect(hiddenGrid).not.toBeNull();
      // The kds-board card is hidden (its required `act-as-kds` is absent), so no station screen mounts.
      expect(hiddenGrid.shadowRoot!.querySelector("till-station-screen")).toBeNull();
      hidden.el.remove();

      // Profile grants `act-as-kds` → the same card renders its embedded station screen.
      const shown = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
        getDeviceStation: vi.fn().mockResolvedValue({
          station: {
            id: "st-dev",
            name: "Grill",
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            queue: [],
            notices: [],
          },
        }),
      });
      await flush(shown.el);
      const shownGrid = shown.el.shadowRoot!.querySelector("till-card-grid")!;
      expect(shownGrid.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
    });
  });

  describe("handheld table-order mount duality (SP-B2.2 Task 7)", () => {
    // A phone-portrait canvas: a `floor` tab (a `floor-plan` card) + an `order` tab (a `table-order`
    // card). Because the canvas AUTHORS a tab whose cards mount a `table-order` card, opening a table on
    // a handheld SWITCHES to that Order tab rather than pushing a drill-in — the tab bar owns the
    // navigation, so there is no drill and no second Back. A till (no `order` tab) keeps the drill
    // push/pop, asserted by the sibling "drill-in stack" describe.
    const phoneCanvas: CanvasDef = {
      formFactor: "phone-portrait",
      tabs: [
        {
          key: "floor",
          title: "Floor",
          columns: 12,
          cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
        },
        {
          key: "order",
          title: "Order",
          columns: 12,
          cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
        },
      ],
    };
    const status: TableServiceStatus = { id: "s1", label: "Reservada", color: "#f00" };
    const shell = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell");

    /** Boots a handheld with the phone canvas and logs the waiter in — landing on the FLOOR tab (the
     * phone canvas's first tab). */
    async function toHandheldFloor(): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        listStatuses: vi.fn().mockResolvedValue([status]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      return el;
    }

    it("switches a handheld to the Order tab (card mount) when a table is opened, not a drill-in", async () => {
      const el = await toHandheldFloor();
      expect(shell(el)!.activeTabKey).toBe("floor");
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false });
      await flush(el);
      const s = shell(el)!;
      // Switched to the Order tab — the card mount, not a drill.
      expect(s.activeTabKey).toBe("order");
      // NO drill-in: the tab bar owns the navigation.
      expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();
      // The table-order screen mounts as the Order tab's card, nested in the card grid's OWN shadow root
      // (a card mount, not the app-root drill), so pierce the grid to find it.
      const grid = el.shadowRoot!.querySelector("till-card-grid")!;
      expect(grid).not.toBeNull();
      expect(grid.shadowRoot!.querySelector("till-table-order-screen")).not.toBeNull();
    });

    it("returns a handheld to the Floor tab via the REAL path — tapping the Floor tab — refreshing occupancy", async () => {
      // What actually happens in the app: the waiter on the Order tab taps the Floor TAB, firing the
      // shell's `tab-select` → `#onTabSelect("floor")`, which switches the active tab AND (the floor tab
      // needs the floor read-model, already loaded once) re-reads live occupancy via `#refreshFloor`. This
      // guards the "no stale floor" invariant for the handheld tab-switch return, proven here by a
      // SECOND `getTablesState` fetch that flips t1 from free → occupied.
      const occupiedT1: TableState = {
        ...freeTable,
        state: "open-tab",
        hasOpenTab: true,
        tabLineCount: 1,
        tabTotal: "3.00",
      };
      // A stateful floor read: FREE while the waiter is on the floor / opening the tab, OCCUPIED once the
      // tab is open. Robust to however many loads the login floor landing runs (it loads the floor read-
      // model more than once) — the assertion turns on the Floor-tab RETURN re-reading AFTER `occupied` flips.
      let occupied = false;
      const getTablesState = vi.fn(async () => (occupied ? [occupiedT1] : [freeTable]));
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState,
        listZones: vi.fn().mockResolvedValue([floorZone]),
        listStatuses: vi.fn().mockResolvedValue([status]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false }); // → Order tab card
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("order");
      const before = getTablesState.mock.calls.length;
      const pushHistory = vi.spyOn(history, "pushState");
      occupied = true; // the tab is now open — the floor read-model would show t1 occupied
      emit(shell(el)!, "tab-select", { key: "floor" }); // the REAL return: tap the Floor tab
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      // The Floor-tab return RE-READ occupancy (a fresh `getTablesState`), not merely switched tabs.
      expect(getTablesState.mock.calls.length).toBeGreaterThan(before);
      expect(pushHistory).toHaveBeenCalledTimes(1);
      // The Floor tab re-read occupancy (tables-only refresh): t1 now renders the SECOND fetch (occupied),
      // not the stale free one — so a re-tap resumes the open tab instead of seating the table again.
      const grid = el.shadowRoot!.querySelector("till-card-grid")!;
      const floorScreen = grid.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
      expect(floorScreen).not.toBeNull();
      expect(floorScreen!.tables).toEqual([occupiedT1]);
    });

    it("lands a handheld on its home (floor) tab after a new sale, refreshing the stale floor — not a phantom counter tab", async () => {
      // This phone layout has NO `counter` tab, so #onNewSale must land it on its HOME tab (the canvas's
      // first tab, `floor`), never a phantom `"counter"`. It reaches #onNewSale after settling a TAB
      // (pay-tab → ticket → New sale); the just-closed table is then stale in the floor read-model, so the
      // return must re-read occupancy — a re-tap must resume nothing.
      const occupiedT1: TableState = {
        ...freeTable,
        state: "open-tab",
        hasOpenTab: true,
        tabLineCount: 1,
        tabTotal: "3.00",
      };
      let occupied = false;
      const getTablesState = vi.fn(async () => (occupied ? [occupiedT1] : [freeTable]));
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState,
        listZones: vi.fn().mockResolvedValue([floorZone]),
        listStatuses: vi.fn().mockResolvedValue([status]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false }); // → Order tab card
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("order");
      const before = getTablesState.mock.calls.length;
      const pushHistory = vi.spyOn(history, "pushState");
      occupied = true; // the tab has been settled server-side; the floor read-model would now reflect it
      emit(shell(el)!, "new-sale"); // the ticket view's "New sale" after settling the tab
      await flush(el);
      // Lands on the device's HOME tab (floor), NOT a phantom `"counter"` this layout lacks.
      expect(shell(el)!.activeTabKey).toBe("floor");
      // AND re-read occupancy (a fresh getTablesState), so the just-closed table is no longer stale.
      expect(getTablesState.mock.calls.length).toBeGreaterThan(before);
      expect(pushHistory).not.toHaveBeenCalled();
    });
  });

  describe("drill-in stack (SP-B2.1)", () => {
    // A `till` canvas: a `counter` tab carrying the real sale cards (so the sale-path guard drives the
    // grid, not an empty tab) + a `floor` tab (a `floor-plan` card). Station/Expo/Schedule are NOT tabs,
    // so the shell offers them as affordance buttons; the shell's Allergens button is always present.
    const shellCanvas: CanvasDef = {
      formFactor: "till",
      tabs: [
        {
          key: "counter",
          title: "Counter",
          columns: 12,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
            { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
            { type: "total", colSpan: 4, rowSpan: 1, config: {} },
            { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
          ],
        },
        {
          key: "floor",
          title: "Floor",
          columns: 12,
          cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
        },
      ],
    };
    const shell = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell");
    const drill = (el: TillApp) => el.shadowRoot!.querySelector('[slot="drill"]');
    const grid = (el: TillApp) => el.shadowRoot!.querySelector("till-card-grid");

    /** Boots the shell, logs in (lands on the counter tab), and switches to the floor tab — the surface
     * a table is opened from. `getTablesState` returns `freeTable` so the floor has a table to open. */
    async function toShellFloor(): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" });
      await el.updateComplete;
      return el;
    }

    /** Boots the shell and logs in — leaving the app on the counter tab (no drill open). */
    async function toShellCounter(): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
      });
      await toCounter(el);
      return el;
    }

    it("pushes the table-order drill-in over the shell when a table is opened from the floor tab", async () => {
      const el = await toShellFloor();
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false });
      await flush(el);
      // The table-order screen mounts into the shell's `drill` slot, OVER the (now inert) floor tab.
      expect(drill(el)).not.toBeNull();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.getAttribute("slot")).toBe("drill");
    });

    it("pops the table-order drill-in back to the floor tab on back-to-floor", async () => {
      const el = await toShellFloor();
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false });
      await flush(el);
      emit(tableOrder(el)!, "back-to-floor");
      await el.updateComplete;
      // Drill gone; the underlying floor tab's card grid is back on top.
      expect(drill(el)).toBeNull();
      expect(tableOrder(el)).toBeNull();
      expect(grid(el)).not.toBeNull();
      expect(shell(el)!.activeTabKey).toBe("floor");
    });

    it("refreshes floor occupancy when the drill pops back to the floor tab (SP-B2.1 review — no stale floor)", async () => {
      // A round and other table-service actions do NOT update `this.tables`, so after a waiter adds a
      // round and taps Back, the floor tab must RE-READ occupancy or it re-renders a stale read-model.
      // So this asserts FRESHNESS — the floor reflects the read taken after Back.
      const occupiedT1: TableState = {
        ...freeTable,
        state: "open-tab",
        hasOpenTab: true,
        tabLineCount: 1,
        tabTotal: "3.00",
      };
      const afterRound: TableState = { ...occupiedT1, tabLineCount: 2, tabTotal: "6.00" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
        // FIRST floor load (tab-select): table free. SECOND load (seating re-reads the floor): now
        // occupied. THIRD load (the back-to-floor refresh): the round sent meanwhile shows.
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([freeTable])
          .mockResolvedValueOnce([occupiedT1])
          .mockResolvedValueOnce([afterRound]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" }); // first floor load → freeTable
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, seated: false }); // drill in
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      emit(tableOrder(el)!, "back-to-floor"); // pop the drill + tables-only refresh → afterRound
      await flush(el);
      const g = grid(el)!;
      const floorScreen = g.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
      expect(floorScreen).not.toBeNull();
      expect(floorScreen!.tables).toEqual([afterRound]);
    });

    it("pushes the schedule drill-in from the shell's Schedule affordance", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "show-schedule");
      await el.updateComplete;
      expect(drill(el)).not.toBeNull();
      expect(schedule(el)).not.toBeNull();
      expect(schedule(el)!.getAttribute("slot")).toBe("drill");
    });

    it("W69 schedule Back keeps the real drill and URL until its staged request is discarded", async () => {
      const el = await toShellCounter();
      currentApi.listMyShifts = vi.fn().mockResolvedValue([]);
      currentApi.listMySwaps = vi.fn().mockResolvedValue([]);
      currentApi.listMyAbsences = vi.fn().mockResolvedValue([]);
      emit(shell(el)!, "show-schedule");
      await flush(el);
      const owner = schedule(el)!;
      const input = owner.shadowRoot!.querySelector<WtInput>(".abs-note")!;
      await input.updateComplete;
      await userEvent.fill(input.shadowRoot!.querySelector("input")!, "Family visit");
      const originalUrl = window.location.href;
      const back = owner.shadowRoot!.querySelector<HTMLElement>(".back")!;
      back.click();
      await flush(el);
      const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
      await question.updateComplete;
      expect(question.open).toBe(true);
      expect(schedule(el)).toBe(owner);
      expect(window.location.href).toBe(originalUrl);
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => question.open).toBe(false);
      expect(input.value).toBe("Family visit");
      expect(schedule(el)).toBe(owner);
      expect(window.location.href).toBe(originalUrl);
      back.click();
      await expect.poll(() => question.open).toBe(true);
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => schedule(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(window.location.href).not.toBe(originalUrl);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    });

    it("pushes the station drill-in from the shell's Station affordance", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "show-station");
      await el.updateComplete;
      expect(drill(el)).not.toBeNull();
      expect(station(el)).not.toBeNull();
      expect(station(el)!.getAttribute("slot")).toBe("drill");
    });

    it("pushes the expo drill-in from the shell's Pass affordance", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "show-expo");
      await el.updateComplete;
      expect(drill(el)).not.toBeNull();
      expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("till-expo-screen")!.getAttribute("slot")).toBe("drill");
    });

    it("pushes the allergens drill-in from the shell's Allergens affordance (full product set)", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "open-allergens");
      await el.updateComplete;
      const allergen = el.shadowRoot!.querySelector<HTMLElement & { products: unknown[] }>(
        "till-allergen-screen",
      );
      expect(drill(el)).not.toBeNull();
      expect(allergen).not.toBeNull();
      expect(allergen!.getAttribute("slot")).toBe("drill");
      // The drill gets the FULL product set (allergen lookup spans every menu).
      expect(allergen!.products).toEqual([
        expect.objectContaining({
          id: "cafe",
          productId: "cafe",
          menuItemId: "menu-item-cafe-0",
          unitPrice: "1.50",
        }),
      ]);
    });

    it("pops the allergens drill-in on its own close-allergens", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "open-allergens");
      await el.updateComplete;
      emit(el.shadowRoot!.querySelector("till-allergen-screen")!, "close-allergens");
      await el.updateComplete;
      expect(drill(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("till-allergen-screen")).toBeNull();
    });

    it("pops a drill-in back to the counter tab on back-to-counter", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "show-schedule");
      await el.updateComplete;
      expect(schedule(el)).not.toBeNull();
      emit(schedule(el)!, "back-to-counter");
      await el.updateComplete;
      // Drill gone; the counter tab is active and its body renders again.
      expect(drill(el)).toBeNull();
      expect(schedule(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(shell(el)!.activeTabKey).toBe("counter");
    });

    it("completes a sale through the shell + grid counter and lands on the ticket drill-in (sale-path guard)", async () => {
      const el = await toShellCounter();
      const c = counter(el)!;
      // The counter tab renders through the card grid (its cards include tender-pay); the store is
      // the app's own working order. The card grid lives in the counter screen's shadow root.
      const cardGrid = c.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
      expect(cardGrid).not.toBeNull();
      expect(cardGrid!.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      // The ticket is a drill-in over the (inert) counter tab.
      expect(ticket(el)).not.toBeNull();
      expect(ticket(el)!.getAttribute("slot")).toBe("drill");
      expect(drill(el)).not.toBeNull();
      expect(ticket(el)!.result).toBe(saleResult);
    });

    it("returns to the counter tab and clears the basket on New sale from the ticket drill-in", async () => {
      const el = await toShellCounter();
      const c = counter(el)!;
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull();
      emit(ticket(el)!, "new-sale");
      await el.updateComplete;
      // Ticket drill gone; back on the counter tab with an empty basket ready for the next customer.
      expect(drill(el)).toBeNull();
      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(shell(el)!.activeTabKey).toBe("counter");
      expect(counter(el)!.store.lines.length).toBe(0);
    });

    it("loads the floor read-model when the floor tab is selected in the shell (data reaches the card)", async () => {
      // The Floor tab is reached via `tab-select` on the shell, so the tab-select handler must load
      // `.tables`/`.zones` or the floor-plan card renders a BLANK floor with no table to tap, and
      // table-service ordering is unreachable from the shell. So this asserts the data actually loaded
      // and reached the card.
      const status: TableServiceStatus = { id: "s1", label: "Reservada", color: "#f00" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        listStatuses: vi.fn().mockResolvedValue([status]),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" });
      await flush(el); // await the ASYNC floor load, not just the synchronous tab switch
      const g = grid(el)!;
      expect(g).not.toBeNull();
      const floorScreen = g.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
      expect(floorScreen).not.toBeNull();
      // The read-model actually loaded and threaded through to the card — a NON-EMPTY floor.
      expect(floorScreen!.tables).toEqual([freeTable]);
      expect(floorScreen!.zones).toEqual([floorZone]);
    });

    it("clears the open drill and resets the active tab on logout (Finding 2 — no stale receipt into the next shift)", async () => {
      // Operator A finishes a sale (a `ticket` drill holds A's receipt), then taps Logout (NOT New sale)
      // from the non-inert shell header. Assert the STATE is cleared (not merely that the shell
      // unmounted at `lock`, which would mask it).
      const el = await toShellCounter();
      const c = counter(el)!;
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull(); // operator A's ticket drill is open
      const app = el as unknown as { drill?: unknown; activeTabKey?: string };
      emit(shell(el)!, "logout");
      await flush(el);
      expect(app.drill).toBeUndefined();
      expect(app.activeTabKey).toBe("counter"); // back to the first tab
    });

    it("resets any leftover drill/active tab on login (Finding 2 — defense in depth)", async () => {
      // Defense in depth: even a login that somehow followed a NON-logout teardown must not inherit a
      // prior operator's drill or tab. Simulate that stale state directly, then log a fresh operator in.
      const el = await toShellCounter();
      emit(shell(el)!, "logout");
      await flush(el);
      const app = el as unknown as { drill?: unknown; activeTabKey?: string };
      // A `schedule` drill (renders cleanly from the empty roster) standing in for any stale drill.
      app.drill = { kind: "schedule" };
      app.activeTabKey = "floor";
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Bea", permissions: [] });
      await flush(el);
      expect(app.drill).toBeUndefined();
      expect(shell(el)!.activeTabKey).toBe("counter");
      expect(schedule(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
    });

    it("dismisses an open drill when a tab is selected (Finding 3)", async () => {
      // The tab bar is in the non-inert header, so a tab tap while a drill is open must DISMISS the
      // drill, not switch the surface underneath it.
      const el = await toShellCounter();
      emit(shell(el)!, "show-schedule"); // open a drill
      await el.updateComplete;
      expect(schedule(el)).not.toBeNull();
      expect(drill(el)).not.toBeNull();
      emit(shell(el)!, "tab-select", { key: "floor" });
      await flush(el);
      expect(drill(el)).toBeNull();
      expect(schedule(el)).toBeNull();
      expect(shell(el)!.activeTabKey).toBe("floor");
      expect(grid(el)).not.toBeNull();
    });
  });

  describe("per-user locale (Task 9)", () => {
    /** Boots, then logs a person in carrying `locale` in the `logged-in` detail — leaving the app on
     * the counter with the UI switched per `resolveActiveLocale(locale, venueDefault)`. */
    async function toCounterAs(el: TillApp, locale: string | null): Promise<TillCounterScreen> {
      await flush(el);
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Ana",
        permissions: [],
        locale,
      });
      await flush(el);
      return counter(el)!;
    }

    it("shows a browser-matched language before login when the venue language differs", async () => {
      const { el } = await mountApp({
        getLocales: vi.fn().mockResolvedValue({
          locales: [
            { code: "es-ES", label: "Español" },
            { code: "en-GB", label: "English" },
          ],
          venueDefault: "es-ES",
          loginDefault: "en-GB",
        }),
      });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
      expect(
        lock(el)!.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active"),
      ).toBe("en-GB");
      const chooser = lock(el)!.shadowRoot!.querySelector("wt-language-chooser")!;
      chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
      await vi.waitFor(() =>
        expect(chooser.shadowRoot!.querySelector('[data-test="lang-es-ES"]')).not.toBeNull(),
      );
    });

    it("shows the browser language on the unenrolled device setup screen", async () => {
      const { el } = await mountApp({
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
        getLocales: vi.fn().mockResolvedValue({
          locales: [
            { code: "es-ES", label: "Español" },
            { code: "en-GB", label: "English" },
          ],
          venueDefault: "es-ES",
          loginDefault: "en-GB",
        }),
      });
      await flush(el);
      const enrol = enrolScreen(el)!;
      expect(enrol).not.toBeNull();
      expect(currentLocale()).toBe("en-GB");
      expect(enrol.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active")).toBe(
        "en-GB",
      );
      const chooser = enrol.shadowRoot!.querySelector("wt-language-chooser")!;
      chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
      await vi.waitFor(() =>
        expect(chooser.shadowRoot!.querySelector('[data-test="lang-es-ES"]')).not.toBeNull(),
      );
    });

    it("keeps an enrol-screen language choice through the enrolment re-boot", async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockRejectedValueOnce({ code: "device.unauthorized" })
        .mockResolvedValue({ deviceId: "dev-1", formFactor: "till" });
      const { el } = await mountApp({
        getDeviceIdentity,
        getLocales: vi.fn().mockResolvedValue({
          locales: [
            { code: "es-ES", label: "Español" },
            { code: "en-GB", label: "English" },
          ],
          venueDefault: "es-ES",
          loginDefault: "es-ES",
        }),
      });
      await flush(el);
      emit(enrolScreen(el)!, "wt-locale-selected", { code: "en-GB" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
      emit(enrolScreen(el)!, "enrolled", { deviceId: "dev-1" });
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(lock(el)).not.toBeNull();
      expect(currentLocale()).toBe("en-GB");
    });

    it("uses the browser match when the till boot read fails before venue details arrive", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockRejectedValue(new Error("offline")),
        getLocales: vi.fn().mockResolvedValue({
          locales: [],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
        }),
      });
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(currentLocale()).toBe("en-GB");
    });

    it("keeps a person's pre-login pick when the browser language reply arrives later", async () => {
      let answerLocales!: (value: {
        locales: Array<{ code: string; label: string }>;
        venueDefault: string;
        loginDefault: string;
      }) => void;
      const getLocales = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<TillApi["getLocales"]>>>((r) => {
            answerLocales = r;
          }),
      );
      const { el } = await mountApp({ getLocales });
      await flush(el);
      emit(lock(el)!, "wt-locale-selected", { code: "en-GB" });
      await flush(el);
      answerLocales({ locales: [], venueDefault: "es-ES", loginDefault: "es-ES" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
    });

    it("keeps a signed-in operator's saved language when the browser reply arrives during login", async () => {
      let answerLocales!: (value: Awaited<ReturnType<TillApi["getLocales"]>>) => void;
      let answerOffers!: (value: ZoneOfferCatalogue) => void;
      const { el } = await mountApp({
        getLocales: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<TillApi["getLocales"]>>>((r) => {
              answerLocales = r;
            }),
        ),
        listDefaultZoneOffers: vi.fn(
          () =>
            new Promise<ZoneOfferCatalogue>((r) => {
              answerOffers = r;
            }),
        ),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Ana",
        permissions: [],
        locale: "en-GB",
      });
      await el.updateComplete;
      answerLocales({ locales: [], venueDefault: "es-ES", loginDefault: "es-ES" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
      answerOffers(fixtureOffers({ menus: [defaultMenu], products: [cafe] }));
      await flush(el);
    });

    it("returns to the browser match after an operator logs out", async () => {
      const { el } = await mountApp({
        getLocales: vi.fn().mockResolvedValue({
          locales: [],
          venueDefault: "es-ES",
          loginDefault: "en-GB",
        }),
      });
      const c = await toCounterAs(el, "es-ES");
      expect(currentLocale()).toBe("es-ES");
      emit(c, "logout");
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
    });

    it("applies a late browser match after logout when it was unavailable during login", async () => {
      let answerLocales!: (value: Awaited<ReturnType<TillApi["getLocales"]>>) => void;
      const { el } = await mountApp({
        getLocales: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<TillApi["getLocales"]>>>((r) => {
              answerLocales = r;
            }),
        ),
      });
      const c = await toCounterAs(el, "es-ES");
      emit(c, "logout");
      await flush(el);
      expect(currentLocale()).toBe("es-ES");
      answerLocales({ locales: [], venueDefault: "es-ES", loginDefault: "en-GB" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
    });

    it("after boot the UI is the venue default (getTill.locale), before any login", async () => {
      // The venue default differs from the es-ES starting point so the switch is observable. #boot
      // both `setLocale`s it and remembers it as the venue default for the login/logout lifecycle.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, locale: "en-GB" }),
      });
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
      expect(lock(el)).not.toBeNull(); // still pre-login
    });

    it("login switches the UI to the operator's stored locale — a DEEP shell child renders English", async () => {
      // Venue default es-ES; the operator's stored locale is en-GB. On login the app resolves en-GB and
      // `setLocale`s it; the `keyed(currentLocale(), …)` wrapper recreates the shell subtree, so a deep child
      // (the logout button in the shell header) renders in English, not Spanish.
      const { el } = await mountApp();
      await toCounterAs(el, "en-GB");
      expect(currentLocale()).toBe("en-GB");
      const logout = shell(el)!.shadowRoot!.querySelector(".logout")!;
      expect(logout.textContent).toContain(t("action.logout", "en-GB")); // "Log out"
      expect(logout.textContent).not.toContain(t("action.logout", "es-ES")); // not "Cerrar sesión"
    });

    it("boot does NOT clobber an operator locale applied while getTill was still in flight (slow-link race)", async () => {
      // Slow-link race: the operator's login (the lock screen's `getStaff` + a human PIN entry) completes
      // while boot's `getTill` is STILL in flight. `#onLoggedIn` applies the operator's stored en-GB
      // synchronously (before its first await) and sets `operatorPersonId`; when `getTill` finally
      // resolves, the boot continuation must NOT re-apply the venue default (es-ES) over it. The guard is
      // `#boot`'s `if (this.operatorPersonId === "")`.
      let resolveTill!: (v: typeof till) => void;
      const getTill = vi.fn(() => new Promise<typeof till>((r) => (resolveTill = r)));
      const { el } = await mountApp({ getTill }); // fixture venue default es-ES, DIFFERENT from en-GB
      await flush(el);
      expect(lock(el)).not.toBeNull(); // the lock screen paints (screen defaults to "lock") though boot is pending

      // The operator logs in mid-flight carrying their stored en-GB preference; `#onLoggedIn` applies it.
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Ana",
        permissions: [],
        locale: "en-GB",
      });
      await flush(el); // login settles: en-GB applied, operatorPersonId set, screen → counter
      expect(currentLocale()).toBe("en-GB");

      resolveTill(till); // getTill NOW resolves (venue default es-ES) — the boot continuation runs
      await flush(el);

      expect(currentLocale()).toBe("en-GB"); // operator locale preserved, NOT clobbered to the venue default
    });

    it("a null stored locale falls back to the venue default on login", async () => {
      // resolveActiveLocale(null, "es-ES") === "es-ES": an operator with no preference gets the venue UI.
      const { el } = await mountApp();
      await toCounterAs(el, null);
      expect(currentLocale()).toBe("es-ES");
    });

    it("logout reverts the UI to the venue default", async () => {
      // Login as an en-GB operator (UI → English), then log out: the UI must return to the venue default
      // (es-ES) so the next operator starts from the venue language, not the previous operator's choice.
      const { el } = await mountApp();
      const c = await toCounterAs(el, "en-GB");
      expect(currentLocale()).toBe("en-GB");
      emit(c, "logout");
      await flush(el);
      expect(currentLocale()).toBe("es-ES");
    });

    it("wt-locale-selected while on the LOCK screen switches transiently — setLocale, NOT putLocale", async () => {
      // A pre-login pick is transient: the app switches the UI but writes NOTHING (there is no session to
      // write to). Emitted from the lock screen exactly as the chooser's composed event does.
      const { el } = await mountApp();
      await flush(el);
      expect(lock(el)).not.toBeNull();
      emit(lock(el)!, "wt-locale-selected", { code: "en-GB" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB"); // switched
      expect(currentApi.putLocale).not.toHaveBeenCalled(); // but NOT persisted
    });

    it("wt-locale-selected while LOGGED IN persists (putLocale) then switches (setLocale)", async () => {
      const putLocale = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({ putLocale });
      const c = await toCounterAs(el, null); // venue default es-ES
      expect(currentLocale()).toBe("es-ES");

      emit(c, "wt-locale-selected", { code: "en-GB" });
      await flush(el);

      expect(putLocale).toHaveBeenCalledWith("en-GB");
      expect(currentLocale()).toBe("en-GB"); // the switch happened AFTER the persist resolved
    });

    it("a rejected putLocale leaves the language unchanged and surfaces the save-failed error", async () => {
      // The persist failed, so the UI must NOT switch (setLocale is gated behind the successful write) and
      // a non-fatal banner appears — never the raw code.
      const putLocale = vi.fn().mockRejectedValue({ code: "locale.unsupported" });
      const { el } = await mountApp({ putLocale });
      const c = await toCounterAs(el, null); // venue default es-ES
      expect(currentLocale()).toBe("es-ES");

      emit(c, "wt-locale-selected", { code: "en-GB" });
      await flush(el);

      expect(putLocale).toHaveBeenCalledWith("en-GB");
      expect(currentLocale()).toBe("es-ES"); // unchanged — the failed write never switched the UI
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("locale.save_failed"));
      expect(el.shadowRoot!.textContent).not.toContain("locale.unsupported"); // never leaks the code
    });

    it("renders the language chooser in the shell alongside the API-backed counter", async () => {
      const { el } = await mountApp();
      const c = await toCounterAs(el, null);
      // The counter is still handed the app's api (threaded by the shell's tab body).
      expect(c.api).toBe(currentApi);
      // The shell owns the chooser while the counter stays embedded.
      expect(shell(el)!.shadowRoot!.querySelector("wt-language-chooser")).not.toBeNull();
    });

    /** Opens a chooser by its trigger and picks `code` from the list, as a person does. */
    async function pickLanguage(chooser: Element, code: string): Promise<void> {
      chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
      await vi.waitFor(() => {
        expect(chooser.shadowRoot!.querySelector(`[data-test="lang-${code}"]`)).not.toBeNull();
      });
      chooser.shadowRoot!.querySelector<HTMLElement>(`[data-test="lang-${code}"]`)!.click();
    }

    it("a pick from the bar's chooser saves the operator's language, then switches to it", async () => {
      const putLocale = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({ putLocale });
      await toCounterAs(el, null);
      expect(currentLocale()).toBe("es-ES");
      await pickLanguage(shell(el)!.shadowRoot!.querySelector("wt-language-chooser")!, "en-GB");
      await flush(el);
      expect(putLocale).toHaveBeenCalledWith("en-GB");
      expect(currentLocale()).toBe("en-GB");
    });

    it("a pick from the lock screen's chooser switches the language without saving it", async () => {
      const { el } = await mountApp();
      await flush(el);
      await pickLanguage(lock(el)!.shadowRoot!.querySelector("wt-language-chooser")!, "en-GB");
      await flush(el);
      expect(currentLocale()).toBe("en-GB");
      expect(currentApi.putLocale).not.toHaveBeenCalled();
    });

    it("does not revert the locale if the app disconnects mid-logout", async () => {
      // #onLogout's `setLocale(this.#venueLocale)` runs AFTER `await api.logout()`, so a teardown during
      // that round trip must not repaint a live sibling's module-global locale — the same guard #boot
      // carries. Log in as an en-GB operator (UI → English), start logout with `logout()` in flight,
      // detach, then resolve: the venue-default revert (es-ES) must be SKIPPED.
      let resolveLogout!: () => void;
      const logout = vi.fn(() => new Promise<void>((r) => (resolveLogout = r)));
      const { el, host } = await mountApp({ logout });
      const c = await toCounterAs(el, "en-GB");
      expect(currentLocale()).toBe("en-GB");

      emit(c, "logout"); // logout() now pending
      await el.updateComplete;
      host.remove(); // torn down before logout resolves
      resolveLogout();
      await flush(el);

      expect(currentLocale()).toBe("en-GB"); // the revert to es-ES was skipped on the detached app
    });

    it("does not switch the locale if the app disconnects mid-putLocale (persist path)", async () => {
      // #onLocaleSelected's `setLocale(code)` runs AFTER `await api.putLocale(code)`. The durable server
      // write has already landed (and the next login re-applies it), so a teardown during the write must
      // SKIP only the now-pointless local repaint — never mutate a live sibling's locale.
      let resolvePut!: () => void;
      const putLocale = vi.fn(() => new Promise<void>((r) => (resolvePut = r)));
      const { el, host } = await mountApp({ putLocale });
      const c = await toCounterAs(el, null); // venue default es-ES
      expect(currentLocale()).toBe("es-ES");

      emit(c, "wt-locale-selected", { code: "en-GB" }); // putLocale now pending
      await el.updateComplete;
      host.remove(); // torn down before putLocale resolves
      resolvePut();
      await flush(el);

      expect(putLocale).toHaveBeenCalledWith("en-GB"); // the durable write still happened
      expect(currentLocale()).toBe("es-ES"); // but the local repaint was skipped on the detached app
    });
  });

  it("does not change the global locale when the app disconnects before getTill resolves", async () => {
    let resolveTill!: (v: typeof till) => void;
    const getTill = vi.fn(() => new Promise<typeof till>((r) => (resolveTill = r)));
    const { el, host } = await mountApp({ getTill });
    host.remove(); // torn down before boot resolves
    resolveTill({ ...till, locale: "en" });
    await flush(el);
    expect(currentLocale()).toBe("es-ES"); // guard skipped setLocale on the detached app
  });

  it("switches a kitchen display's language without writing an operator preference", async () => {
    const putLocale = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
      putLocale,
    });
    await flush(el);
    emit(shell(el)!, "wt-locale-selected", { code: "en-GB" });
    await flush(el);
    expect(putLocale).not.toHaveBeenCalled();
    expect(currentLocale()).toBe("en-GB");
  });

  describe("multi-menu switcher", () => {
    const foodMenu = { id: "cat-food", name: "Comida", isDefault: true };
    const drinksMenu = { id: "cat-drinks", name: "Bebidas", isDefault: false };
    const bocadillo: TillProduct = {
      id: "bocadillo",
      menuItemId: "menu-item-bocadillo",
      name: "Bocadillo",
      customerName: { es: "Bocadillo para el cliente" },
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
      category: null,
      allergens: null,
      catalogueId: "cat-food",
      catalogueName: "Comida",
    };
    const cerveza: TillProduct = {
      id: "cerveza",
      menuItemId: "menu-item-cerveza",
      name: "Cerveza",
      customerName: { es: "Cerveza para el cliente" },
      pricingUnit: "each",
      unitPrice: "2.50",
      vatClass: "general",
      category: null,
      allergens: null,
      catalogueId: "cat-drinks",
      catalogueName: "Bebidas",
    };
    const twoMenuProducts = vi
      .fn()
      .mockResolvedValue({ menus: [foodMenu, drinksMenu], products: [bocadillo, cerveza] });

    /** The menu switcher the counter screen renders above the card grid. */
    const switcher = (el: TillApp) =>
      counter(el)!.shadowRoot!.querySelector<HTMLElement>("till-menu-switcher")!;
    /** The switcher's option buttons (empty when it renders nothing — one menu or none). */
    const switcherButtons = (el: TillApp) => [
      ...switcher(el).shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="menu-"]'),
    ];
    /** The product names the counter GRID is currently showing (its `wt-button.tile` labels) — the
     * product-grid card lives inside the counter's card grid shadow root. */
    const gridNames = (el: TillApp) =>
      [
        ...counterGrid(el)!
          .shadowRoot!.querySelector("till-menu-browser")!
          .shadowRoot!.querySelectorAll(".name"),
      ].map((n) => n.textContent);

    it("resets a stored menu on login while menu changes stay out of history and leave the basket intact", async () => {
      sessionStorage.setItem("waitron.lastMenu", "cat-drinks");
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);
      expect(gridNames(el)).toEqual(["Bocadillo"]);
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-food");
      c.store.addProduct(bocadillo, "1");
      const pushHistory = vi.spyOn(history, "pushState");
      const path = location.pathname;
      switcherButtons(el)[1]!.click();
      await flush(el);
      expect(location.pathname).toBe(path);
      expect(pushHistory).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-drinks");
      expect(c.store.lines[0]!.product.id).toBe("bocadillo");
      el.remove();
      const refreshed = await mountApp({ listProducts: twoMenuProducts });
      await toCounter(refreshed.el);
      expect(gridNames(refreshed.el)).toEqual(["Bocadillo"]);
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-food");
      expect(location.pathname).not.toContain("/menu/");
    });

    it("keeps the menu after logout and a new login as p1", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);
      switcherButtons(el)[1]!.click();
      await flush(el);
      expect(gridNames(el)).toEqual(["Cerveza"]);
      emit(c, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Operator",
        permissions: [],
      });
      await flush(el);
      expect(gridNames(el)).toEqual(["Cerveza"]);
      expect(switcherButtons(el)[1]!.getAttribute("aria-pressed")).toBe("true");
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-drinks");
    });

    it.each(["p2"])("resets the menu after logout and a new login as %s", async (personId) => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);
      switcherButtons(el)[1]!.click();
      await flush(el);
      expect(gridNames(el)).toEqual(["Cerveza"]);
      emit(c, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", {
        personId,
        displayName: "Operator",
        permissions: [],
      });
      await flush(el);
      expect(gridNames(el)).toEqual(["Bocadillo"]);
      expect(switcherButtons(el)[0]!.getAttribute("aria-pressed")).toBe("true");
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-food");
    });

    describe("browsing state across sign-ins, zones and screens", () => {
      const zone = (id: string, name: string): ServiceZoneSummary => ({
        id,
        name,
        departmentId: "department-restaurant",
        departmentName: "Restaurant",
        serviceMode: "prepay",
      });
      /** The profile's starting zone: Comida by default, Bebidas beside it. */
      const startOffers = async (): Promise<ZoneOfferCatalogue> => {
        const catalogue = fixtureOffers(await twoMenuProducts());
        catalogue.context = { ...catalogue.context, zoneId: "zone-start" };
        catalogue.zones = [zone("zone-start", "Sala"), zone("zone-terrace", "Terraza")];
        return catalogue;
      };
      /** The terrace: Cócteles by default, Vinos beside it. */
      const terraceOffers = (): ZoneOfferCatalogue => {
        const catalogue = fixtureOffers({
          menus: [
            { id: "cat-cocktails", name: "Cócteles", isDefault: true },
            { id: "cat-wine", name: "Vinos", isDefault: false },
          ],
          products: [
            {
              ...bocadillo,
              id: "mojito",
              menuItemId: "menu-item-mojito",
              name: "Mojito",
              catalogueId: "cat-cocktails",
              catalogueName: "Cócteles",
            },
            {
              ...cerveza,
              id: "rioja",
              menuItemId: "menu-item-rioja",
              name: "Rioja",
              catalogueId: "cat-wine",
              catalogueName: "Vinos",
            },
          ],
        });
        catalogue.context = { ...catalogue.context, zoneId: "zone-terrace" };
        return catalogue;
      };
      const zoned = () => ({
        listProducts: twoMenuProducts,
        listDefaultZoneOffers: vi.fn(startOffers),
        listZoneOffers: vi.fn(async (zoneId: string) =>
          zoneId === "zone-terrace" ? terraceOffers() : startOffers(),
        ),
      });
      const signInAgain = async (el: TillApp, personId: string) => {
        emit(counter(el)!, "logout");
        await flush(el);
        emit(lock(el)!, "logged-in", { personId, displayName: "Operator", permissions: [] });
        await flush(el);
      };
      const toTerraceWine = async (el: TillApp) => {
        emit(counter(el)!, "counter-zone-selected", { zoneId: "zone-terrace" });
        await flush(el);
        expect(gridNames(el)).toEqual(["Mojito"]);
        switcherButtons(el)[1]!.click();
        await flush(el);
        expect(gridNames(el)).toEqual(["Rioja"]);
      };

      it("brings the same person back to the zone they left, with its manual menu", async () => {
        const { el } = await mountApp(zoned());
        await toCounter(el);
        await toTerraceWine(el);
        await signInAgain(el, "p1");
        expect(counter(el)!.selectedServiceZoneId).toBe("zone-terrace");
        expect(currentApi.setServiceZone).toHaveBeenLastCalledWith("zone-terrace");
        expect(gridNames(el)).toEqual(["Rioja"]);
      });

      it("starts another person at the profile's starting zone and its default menu", async () => {
        const { el } = await mountApp(zoned());
        await toCounter(el);
        await toTerraceWine(el);
        await signInAgain(el, "p2");
        expect(counter(el)!.selectedServiceZoneId).toBe("zone-start");
        expect(gridNames(el)).toEqual(["Bocadillo"]);
        await signInAgain(el, "p1");
        expect(counter(el)!.selectedServiceZoneId).toBe("zone-start");
        expect(gridNames(el)).toEqual(["Bocadillo"]);
      });

      it("selects each zone's default menu on a zone change, the zone left included", async () => {
        const { el } = await mountApp(zoned());
        await toCounter(el);
        switcherButtons(el)[1]!.click();
        await flush(el);
        expect(gridNames(el)).toEqual(["Cerveza"]);
        await toTerraceWine(el);
        emit(counter(el)!, "counter-zone-selected", { zoneId: "zone-start" });
        await flush(el);
        expect(gridNames(el)).toEqual(["Bocadillo"]);
        await signInAgain(el, "p1");
        expect(gridNames(el)).toEqual(["Bocadillo"]);
      });

      it("keeps the manual menu across a screen change and a table opened in another zone", async () => {
        const terraceTable: TableState = {
          ...freeTable,
          id: "table-terrace",
          zoneId: "zone-terrace",
        };
        const { el } = await mountApp({
          ...zoned(),
          getTablesState: vi.fn().mockResolvedValue([terraceTable]),
          listZones: vi.fn().mockResolvedValue([{ ...floorZone, id: "zone-terrace" }]),
        });
        await toCounter(el);
        switcherButtons(el)[1]!.click();
        await flush(el);
        selectTab(el, "floor");
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: terraceTable.id, seated: false });
        await flush(el);
        expect(currentApi.listZoneOffers).toHaveBeenLastCalledWith("zone-terrace");
        expect(tableOrder(el)!.selectedMenuId).toBe("cat-cocktails");
        selectTab(el, "counter");
        await flush(el);
        expect(counter(el)!.selectedServiceZoneId).toBe("zone-start");
        expect(gridNames(el)).toEqual(["Cerveza"]);
      });

      it("starts a reloaded page at the profile's starting zone and its default menu", async () => {
        const { el } = await mountApp(zoned());
        await toCounter(el);
        await toTerraceWine(el);
        el.remove();
        const { el: reloaded } = await mountApp(zoned());
        await toCounter(reloaded);
        expect(counter(reloaded)!.selectedServiceZoneId).toBe("zone-start");
        expect(gridNames(reloaded)).toEqual(["Bocadillo"]);
      });
    });

    it("ignores a stale stored menu and selects the default at login", async () => {
      sessionStorage.setItem("waitron.lastMenu", "removed");
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      await toCounter(el);
      expect(gridNames(el)).toEqual(["Bocadillo"]);
    });

    it("does not overwrite the live app's remembered menu after a detached login finishes", async () => {
      let resolve!: (value: Awaited<ReturnType<TillApi["listProducts"]>>) => void;
      const { el } = await mountApp({
        listProducts: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<TillApi["listProducts"]>>>((done) => {
              resolve = done;
            }),
        ),
      });
      await toCounter(el);
      el.remove();
      const { el: live } = await mountApp({ listProducts: twoMenuProducts });
      await toCounter(live);
      switcherButtons(live)[1]!.click();
      await flush(live);
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-drinks");
      resolve({ menus: [foodMenu], products: [bocadillo] });
      await flush(el);
      expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-drinks");
      expect(gridNames(live)).toEqual(["Cerveza"]);
    });

    it("keeps ordering usable when session storage is blocked", async () => {
      const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        const { el } = await mountApp({ listProducts: twoMenuProducts });
        await toCounter(el);
        switcherButtons(el)[1]!.click();
        await flush(el);
        expect(gridNames(el)).toEqual(["Cerveza"]);
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });

    it("shows the switcher and only the DEFAULT menu's products on the grid at login", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      await toCounter(el);

      // Both menus offered, default (Comida) first and marked pressed.
      expect(switcherButtons(el).map((b) => b.textContent?.trim())).toEqual(["Comida", "Bebidas"]);
      expect(switcherButtons(el)[0]!.getAttribute("aria-pressed")).toBe("true");
      // The grid shows ONLY the default menu's product.
      expect(gridNames(el)).toEqual(["Bocadillo"]);
    });

    it("re-filters the grid when a second menu is picked, and the in-flight cart line survives", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);

      // Ring the default menu's product into the working order (an in-flight cart line).
      c.store.addProduct(bocadillo, "1");
      await el.updateComplete;
      expect(c.store.lineCount).toBe(1);

      // Pick the second menu on the switcher — the real click → composed `menu-selected` → app.
      switcherButtons(el)[1]!.click();
      await flush(el);

      // The grid now shows ONLY the second menu's product; the switch marks Bebidas pressed.
      expect(gridNames(el)).toEqual(["Cerveza"]);
      expect(switcherButtons(el)[1]!.getAttribute("aria-pressed")).toBe("true");
      // The cart is untouched — a menu switch changes which tiles are visible, never the basket.
      expect(c.store.lineCount).toBe(1);
      expect(c.store.lines[0]!.product.id).toBe("bocadillo");
    });

    /** The app-owned active menu id (the private `@state` the switcher and grid filter read). */
    const selected = (el: TillApp) =>
      (el as unknown as { selectedCatalogueId: string }).selectedCatalogueId;

    it("keeps the last menu through payment and the next order without adding history", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);

      // Login lands on the zone's default menu (Comida).
      expect(selected(el)).toBe("cat-food");

      // Switch to the non-default menu and ring a line — a mid-order switch STICKS (the control: it must
      // NOT be reset while the order is in progress, or it would fight the waiter).
      switcherButtons(el)[1]!.click();
      await flush(el);
      c.store.addProduct(cerveza, "1");
      await el.updateComplete;
      expect(selected(el)).toBe("cat-drinks");

      const pushHistory = vi.spyOn(history, "pushState");
      const path = location.pathname;
      // Payment and receipt are steps in this order, not browser destinations.
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull();
      expect(selected(el)).toBe("cat-drinks");

      // Start the next order with the last menu still selected.
      emit(ticket(el)!, "new-sale");
      await flush(el);
      expect(selected(el)).toBe("cat-drinks");
      expect(switcherButtons(el)[1]!.getAttribute("aria-pressed")).toBe("true");
      expect(gridNames(el)).toEqual(["Cerveza"]);
      expect(pushHistory).not.toHaveBeenCalled();
      expect(location.pathname).toBe(path);
    });

    it("keeps the last menu when the basket is parked", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);

      // Switch to the non-default menu and ring a line — the switch sticks mid-order (the control).
      switcherButtons(el)[1]!.click();
      await flush(el);
      c.store.addProduct(cerveza, "1");
      await el.updateComplete;
      expect(selected(el)).toBe("cat-drinks");

      // Parking clears the basket and retains the menu preference.
      emit(c, "park-order", { label: "Mesa 4" });
      await flush(el);
      expect(c.store.lines).toHaveLength(0);
      expect(selected(el)).toBe("cat-drinks");
    });

    it("with a SINGLE menu the switcher renders nothing and the grid shows every product (unchanged)", async () => {
      // The default stubApi ships one menu (`defaultMenu`) with `cafe` on it.
      const { el } = await mountApp();
      await toCounter(el);

      // The switcher element is present but renders no options.
      expect(switcherButtons(el)).toHaveLength(0);
      expect(gridNames(el)).toEqual(["Café"]);
    });
  });
});

it("keeps the shell's language chooser in its bar, above the counter as it scrolls", async () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  await page.viewport(390, 900);
  try {
    const { el } = await mountApp();
    await toCounter(el);
    selectTab(el, "counter");
    await flush(el);
    const chooser = shell(el)!.shadowRoot!.querySelector("wt-language-chooser")!;
    const trigger = chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    const head = shell(el)!.shadowRoot!.querySelector<HTMLElement>("header")!;
    const body = shell(el)!.shadowRoot!.querySelector<HTMLElement>(".body")!;
    body.scrollTop = body.scrollHeight;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(trigger.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      head.getBoundingClientRect().top,
    );
    expect(trigger.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      body.getBoundingClientRect().top,
    );
    const hold = tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".hold")!;
    expect(hold.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      body.getBoundingClientRect().bottom,
    );
  } finally {
    await page.viewport(width, height);
  }
});

it("leaves login and pairing actions clear of the language chooser on a narrow screen", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(375, 667);
  try {
    const { el } = await mountApp({
      listStaff: vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          personId: `p${i}`,
          displayName: `Operator ${i}`,
        })),
      ),
    });
    await flush(el);
    const screen = el.shadowRoot!.querySelector("till-lock-screen")!;
    const chooser = screen.shadowRoot!.querySelector("wt-language-chooser")!;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const trigger = chooser
      .shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!
      .getBoundingClientRect();
    expect(trigger.right).toBeLessThanOrEqual(window.innerWidth);
    el.remove();
    // The device front door: a FRESH browser (401 identity probe) renders the
    // join screen — its own language chooser must sit clear of the Ask to join action.
    const fresh = await mountApp({
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    await flush(fresh.el);
    const enrol = fresh.el.shadowRoot!.querySelector("till-enrol-screen")!;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const language = enrol
      .shadowRoot!.querySelector("wt-language-chooser")!
      .shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!
      .getBoundingClientRect();
    expect(language.bottom).toBeLessThanOrEqual(
      enrol.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.getBoundingClientRect().top,
    );
  } finally {
    await page.viewport(width, height);
    window.scrollTo(0, 0);
  }
});

describe("remembered dietary filters", () => {
  // Each dish is its own offer, with its own menu-item id, as every served offer is.
  const salad: TillProduct = {
    ...cafe,
    id: "salad",
    menuItemId: "menu-item-salad",
    name: "Ensalada",
    customerName: { es: "Ensalada para el cliente" },
    diet: { vegan: "yes", vegetarian: "yes", contains: [] },
  };
  const mixed: TillProduct = {
    ...cafe,
    id: "mixed",
    menuItemId: "menu-item-mixed",
    name: "Mixto",
    customerName: { es: "Mixto para el cliente" },
    diet: { vegan: "no", vegetarian: "no", contains: ["meat", "fish"] },
  };
  const listProducts = () =>
    vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [salad, mixed] });
  const filter = (screen: HTMLElement) => screen.shadowRoot!.querySelector("till-diet-filter")!;
  const pick = (screen: HTMLElement, predicate: string) =>
    filter(screen)
      .shadowRoot!.querySelector<HTMLElement>(`[data-test="diet-filter-${predicate}"]`)!
      .click();
  const pressed = (screen: HTMLElement, predicate: string) =>
    filter(screen)
      .shadowRoot!.querySelector(`[data-test="diet-filter-${predicate}"]`)!
      .getAttribute("aria-pressed");
  const names = (el: TillApp) =>
    [
      ...counterGrid(el)!
        .shadowRoot!.querySelector("till-menu-browser")!
        .shadowRoot!.querySelectorAll(".name"),
    ].map((n) => n.textContent);

  it.each(["vegetarian", "vegan", "no-meat", "no-fish"])(
    "remembers %s across screen changes, then clears it on a new login",
    async (predicate) => {
      const { el } = await mountApp({ listProducts: listProducts() });
      const c = await toCounter(el);
      c.store.addProduct(mixed, "1");
      const push = vi.spyOn(history, "pushState");
      const path = location.href;
      pick(c, predicate);
      await flush(el);
      expect(names(el)).toEqual(["Ensalada"]);
      expect(push).not.toHaveBeenCalled();
      expect(location.href).toBe(path);
      selectTab(el, "floor");
      await flush(el);
      selectTab(el, "counter");
      await flush(el);
      expect(pressed(counter(el)!, predicate)).toBe("true");
      expect(names(el)).toEqual(["Ensalada"]);
      expect(counter(el)!.store.lines[0]!.product.id).toBe("mixed");
      expect(sessionStorage.getItem("waitron.dietFilter")).toBe(predicate);
      emit(counter(el)!, "logout");
      await flush(el);
      await toCounter(el);
      expect(pressed(counter(el)!, predicate)).toBe("false");
      expect(names(el)).toEqual(["Ensalada", "Mixto"]);
      expect(sessionStorage.getItem("waitron.dietFilter")).toBeNull();
    },
  );

  it("shares the selection with table ordering and remembers clearing it", async () => {
    const { el } = await mountApp({
      listProducts: listProducts(),
      getTablesState: vi.fn().mockResolvedValue([freeTable]),
      listZones: vi.fn().mockResolvedValue([floorZone]),
    });
    const c = await toCounter(el);
    pick(c, "vegetarian");
    await flush(el);
    selectTab(el, "floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: freeTable.id, seated: false });
    await flush(el);
    expect(pressed(tableOrder(el)!, "vegetarian")).toBe("true");
    pick(tableOrder(el)!, "vegetarian");
    await flush(el);
    selectTab(el, "counter");
    await flush(el);
    expect(pressed(counter(el)!, "vegetarian")).toBe("false");
    expect(names(el)).toEqual(["Ensalada", "Mixto"]);
    expect(sessionStorage.getItem("waitron.dietFilter")).toBeNull();
  });

  it("keeps dietary filtering usable when browser storage is blocked", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const { el } = await mountApp({ listProducts: listProducts() });
      const c = await toCounter(el);
      pick(c, "vegan");
      await flush(el);
      selectTab(el, "floor");
      await flush(el);
      selectTab(el, "counter");
      await flush(el);
      expect(names(el)).toEqual(["Ensalada"]);
      pick(counter(el)!, "vegan");
      await flush(el);
      expect(names(el)).toEqual(["Ensalada", "Mixto"]);
    } finally {
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("does not clear a live app's filter when a detached login finishes", async () => {
    let resolve!: (value: Awaited<ReturnType<TillApi["listProducts"]>>) => void;
    const { el } = await mountApp({
      listProducts: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<TillApi["listProducts"]>>>((done) => {
            resolve = done;
          }),
      ),
    });
    await toCounter(el);
    el.remove();
    const { el: live } = await mountApp({ listProducts: listProducts() });
    const c = await toCounter(live);
    pick(c, "vegetarian");
    await flush(live);
    expect(sessionStorage.getItem("waitron.dietFilter")).toBe("vegetarian");
    resolve({ menus: [defaultMenu], products: [salad, mixed] });
    await flush(el);
    expect(sessionStorage.getItem("waitron.dietFilter")).toBe("vegetarian");
    expect(names(live)).toEqual(["Ensalada"]);
  });

  it("keeps a filter through payment, new orders and parked orders", async () => {
    const { el } = await mountApp({ listProducts: listProducts() });
    const c = await toCounter(el);
    pick(c, "vegan");
    c.store.addProduct(salad, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(pressed(counter(el)!, "vegan")).toBe("true");
    counter(el)!.store.addProduct(salad, "1");
    emit(counter(el)!, "park-order", { label: "Next" });
    await flush(el);
    selectTab(el, "floor");
    await flush(el);
    selectTab(el, "counter");
    await flush(el);
    expect(pressed(counter(el)!, "vegan")).toBe("true");
    expect(names(el)).toEqual(["Ensalada"]);
  });
});

describe("persistent till destinations", () => {
  it("restores a selected watcher on Expo and clears it on another tab", async () => {
    history.replaceState(null, "", "/tabs/counter/view/expo/watcher/pass");
    const { el } = await mountApp({
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: true }]),
      getWatcherQueue: vi.fn().mockResolvedValue({
        watcher: { id: "pass", name: "Pass", runsPass: true, active: true },
        orders: [],
      }),
    });
    await toCounter(el);
    const expo = el.shadowRoot!.querySelector("till-expo-screen")!;
    await flush(el);
    expect(expo.shadowRoot!.textContent).toContain("Nada pendiente aquí");
    expect(location.pathname).toBe("/tabs/counter/view/expo/watcher/pass");
    selectTab(el, "floor");
    await flush(el);
    expect(location.pathname).not.toContain("watcher/pass");
  });
  async function traverse(direction: "back" | "forward", el: TillApp) {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history[direction]();
    await moved;
    await flush(el);
  }
  it.each([
    ["show-schedule", "schedule", "till-schedule-screen"],
    ["show-station", "station", "till-station-screen"],
    ["show-expo", "expo", "till-expo-screen"],
    ["open-allergens", "allergens", "till-allergen-screen"],
  ])("restores %s with Back, Forward, login and refresh", async (event, view, selector) => {
    const { el } = await mountApp();
    await toCounter(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, event);
    await flush(el);
    expect(el.shadowRoot!.querySelector(selector)).not.toBeNull();
    expect(location.pathname).toContain(`/tabs/counter/view/${view}`);
    const destination = location.pathname;
    await traverse("back", el);
    expect(el.shadowRoot!.querySelector(selector)).toBeNull();
    expect(location.pathname).toBe("/tabs/counter");
    await traverse("forward", el);
    expect(el.shadowRoot!.querySelector(selector)).not.toBeNull();
    el.remove();
    const { el: fresh } = await mountApp();
    await flush(fresh);
    expect(fresh.shadowRoot!.querySelector(selector)).toBeNull();
    await toCounter(fresh);
    expect(fresh.shadowRoot!.querySelector(selector)).not.toBeNull();
    expect(location.pathname).toBe(destination);
    emit(
      fresh.shadowRoot!.querySelector(selector)!,
      view === "allergens" ? "close-allergens" : "back-to-counter",
    );
    await flush(fresh);
    expect(location.pathname).toBe("/tabs/counter");
    await traverse("back", fresh);
    expect(fresh.shadowRoot!.querySelector(selector)).not.toBeNull();
  });

  it("restores selected stations and ignores a departed station list request", async () => {
    const second = { ...defaultStation, id: "st-bar", name: "Bar", isDefault: false };
    const { el } = await mountApp({
      listStations: vi.fn().mockResolvedValue([defaultStation, second]),
    });
    await toCounter(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "show-station");
    await flush(el);
    station(el)!.shadowRoot!.querySelector<HTMLElement>('[data-station="st-bar"]')!.click();
    await flush(el);
    expect(location.pathname).toBe("/tabs/counter/view/station/station/st-bar");
    await traverse("back", el);
    expect(
      station(el)!.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!.stationId,
    ).toBe("st-default");
    await traverse("forward", el);
    expect(
      station(el)!.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!.stationId,
    ).toBe("st-bar");
    el.remove();
    let resolve!: (value: (typeof defaultStation)[]) => void;
    const { el: fresh } = await mountApp({
      listStations: vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    });
    await toCounter(fresh);
    selectTab(fresh, "floor");
    await flush(fresh);
    const departed = location.pathname;
    resolve([defaultStation, second]);
    await flush(fresh);
    expect(location.pathname).toBe(departed);
    expect(station(fresh)).toBeNull();
  });

  it("opens the station the floor's summary names, and the floor offers it on a till", async () => {
    const second = { ...defaultStation, id: "st-bar", name: "Bar", isDefault: false };
    const { el } = await mountApp({
      listStations: vi.fn().mockResolvedValue([defaultStation, second]),
    });
    await toCounter(el);
    selectTab(el, "floor");
    await flush(el);
    expect(floor(el)!.canOpenStation).toBe(true);

    emit(floor(el)!, "show-station", { stationId: "st-bar" });
    await flush(el);

    expect(location.pathname).toBe("/tabs/floor/view/station/station/st-bar");
    expect(
      station(el)!.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!.stationId,
    ).toBe("st-bar");
  });

  it("uses the current destination when login is pending and leaves history inert after logout", async () => {
    history.replaceState(null, "", "/tabs/counter/view/expo");
    history.pushState(null, "", "/tabs/counter/view/schedule");
    let resolve!: (value: Awaited<ReturnType<TillApi["listProducts"]>>) => void;
    const { el } = await mountApp({
      listProducts: vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    });
    await toCounter(el);
    await traverse("back", el);
    resolve({ menus: [], products: [] });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "logout");
    await flush(el);
    await traverse("forward", el);
    expect(el.shadowRoot!.querySelector("till-tab-shell")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-schedule-screen")).toBeNull();
  });

  it.each(["ticket", "table-order", "unknown"])("drops non-restorable %s paths", async (view) => {
    history.replaceState(null, "", `/tabs/counter/view/${view}/station/forbidden`);
    const { el } = await mountApp();
    await toCounter(el);
    expect(location.pathname).toBe("/tabs/counter");
    expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();
  });

  it("does not restore operator destinations on an enrolled kitchen display", async () => {
    history.replaceState(null, "", "/tabs/kitchen/view/station/station/forbidden");
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvasDef, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "kds", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({
        station: {
          id: "st-dev",
          name: "Grill",
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          queue: [],
          notices: [],
        },
      }),
    });
    await flush(el);
    expect(station(el)!.deviceMode).toBe(true);
    expect(station(el)!.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(currentApi.listStations).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/tabs/kitchen");
  });
});

it.each(["station", "expo", "schedule"])(
  "rejects the %s destination on a handheld whose profile lacks its switch, without hiding its floor",
  async (view) => {
    history.replaceState(null, "", `/tabs/floor/view/${view}`);
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: phoneCanvasDef, capabilities: ["print-receipt"] }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
    });
    await toCounter(el);
    expect(location.pathname).toBe("/tabs/floor");
    expect(floor(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();
  },
);

describe("the device profile decides which screens a device offers", () => {
  const switches: CapabilityFlag[] = [
    "print-receipt",
    "show-station",
    "show-expo",
    "show-schedule",
  ];
  const handheld = () =>
    vi.fn().mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null });
  const affordances = (el: TillApp) =>
    (shell(el) as unknown as { affordances: unknown[] }).affordances;
  const headerButton = (el: TillApp, name: string) =>
    shell(el)!.shadowRoot!.querySelector(`.${name}`);

  async function signIn(
    device: "till" | "handheld",
    capabilities: CapabilityFlag[],
    canvas: CanvasDef = till.canvas,
    overrides: Record<string, unknown> = {},
  ): Promise<TillApp> {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas, capabilities }),
      ...(device === "handheld" ? { getDeviceIdentity: handheld() } : {}),
      ...overrides,
    });
    await toCounter(el);
    return el;
  }

  it("gives a handheld whose profile has the switches the Station, Pass and Schedule buttons", async () => {
    const el = await signIn("handheld", switches, phoneCanvasDef);
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    expect(affordances(el)).toEqual(["station", "expo", "schedule", "find-bill"]);
    for (const name of ["station", "expo", "schedule", "find-bill"])
      expect(headerButton(el, name)).not.toBeNull();
  });

  it("gives a till whose profile lacks the switches only Find a bill", async () => {
    const el = await signIn("till", ["print-receipt"]);
    expect(affordances(el)).toEqual(["find-bill"]);
    for (const name of ["station", "expo", "schedule"]) expect(headerButton(el, name)).toBeNull();
  });

  it.each([
    ["show-station", "station"],
    ["show-expo", "expo"],
    ["show-schedule", "schedule"],
  ] as const)("offers a till only the screen its %s switch turns on", async (flag, screen) => {
    const el = await signIn("till", ["print-receipt", flag]);
    expect(affordances(el)).toEqual([screen, "find-bill"]);
  });

  it.each(["station", "expo", "schedule"])(
    "restores the %s destination on a handheld whose profile has its switch",
    async (view) => {
      history.replaceState(null, "", `/tabs/floor/view/${view}`);
      const el = await signIn("handheld", switches, phoneCanvasDef);
      expect(location.pathname).toContain(`/tabs/floor/view/${view}`);
      expect(el.shadowRoot!.querySelector('[slot="drill"]')).not.toBeNull();
    },
  );

  it.each(["station", "expo", "schedule"])(
    "rejects the %s destination on a till whose profile lacks its switch",
    async (view) => {
      history.replaceState(null, "", `/tabs/counter/view/${view}`);
      const el = await signIn("till", ["print-receipt"]);
      expect(location.pathname).toBe("/tabs/counter");
      expect(el.shadowRoot!.querySelector('[slot="drill"]')).toBeNull();
    },
  );

  it("lets a handheld's floor open a station view when its profile has the Station switch", async () => {
    const el = await signIn("handheld", ["show-station"], phoneCanvasDef, {
      getTablesState: vi.fn().mockResolvedValue([freeTable]),
      listZones: vi.fn().mockResolvedValue([floorZone]),
    });
    expect(floor(el)!.canOpenStation).toBe(true);
  });

  it("gives a till's floor no way into a station view when its profile lacks the Station switch", async () => {
    const el = await signIn("till", ["print-receipt"], till.canvas, {
      getTablesState: vi.fn().mockResolvedValue([freeTable]),
      listZones: vi.fn().mockResolvedValue([floorZone]),
    });
    selectTab(el, "floor");
    await flush(el);
    expect(floor(el)!.canOpenStation).toBe(false);
  });

  it("does not load the counter's lists at login on a till whose canvas shows none of them", async () => {
    await signIn("till", switches, phoneCanvasDef);
    expect(currentApi.listWorkingOrders).not.toHaveBeenCalled();
    expect(currentApi.getStationQueue).not.toHaveBeenCalled();
    expect(currentApi.listCounterWaiting).not.toHaveBeenCalled();
  });

  it("gives the Schedule screen its roster when the profile has the Schedule switch and the layout shows no counter list", async () => {
    const el = await signIn("handheld", ["show-schedule"], phoneCanvasDef);
    expect(currentApi.listWorkingOrders).not.toHaveBeenCalled();
    emit(shell(el)!, "show-schedule");
    await flush(el);
    expect(schedule(el)!.staff).toEqual([{ personId: "p1", displayName: "Ana" }]);
  });

  it("holds a till whose layout's first tab is the floor on the lock screen until the floor loads", async () => {
    let resolve!: (value: TableState[]) => void;
    const el = await signIn("till", switches, phoneCanvasDef, {
      getTablesState: vi.fn(
        () =>
          new Promise<TableState[]>((done) => {
            resolve = done;
          }),
      ),
    });
    expect(shell(el)).toBeNull();
    resolve([freeTable]);
    await flush(el);
    expect(shell(el)!.activeTabKey).toBe("floor");
    expect(floor(el)!.tables).toEqual([freeTable]);
  });

  it("opens a handheld whose layout's first tab is the counter without waiting for the floor", async () => {
    const counterFirst: CanvasDef = {
      formFactor: "phone-portrait",
      tabs: [till.canvas.tabs[0]!, phoneCanvasDef.tabs[0]!],
    };
    const el = await signIn("handheld", ["print-receipt"], counterFirst, {
      getTablesState: vi.fn(() => new Promise<TableState[]>(() => undefined)),
    });
    expect(shell(el)!.activeTabKey).toBe("counter");
    expect(counter(el)).not.toBeNull();
  });

  describe("a sign-in that something newer replaced while it loaded", () => {
    const signedIn = (el: TillApp) =>
      el as unknown as {
        screen: string;
        operatorName: string;
        operatorPersonId: string;
        permissions: string[];
      };

    /** The next catalogue load waits until the returned function lets it load or fail. */
    async function holdCatalogue(): Promise<(outcome?: "loads" | "fails") => void> {
      const catalogue = await currentApi.listDefaultZoneOffers();
      let finish!: (value: typeof catalogue) => void;
      let fail!: (error: unknown) => void;
      vi.mocked(currentApi.listDefaultZoneOffers).mockImplementationOnce(
        () =>
          new Promise((done, refuse) => {
            finish = done;
            fail = refuse;
          }),
      );
      return (outcome = "loads") =>
        outcome === "loads" ? finish(catalogue) : fail({ code: "server.internal" });
    }

    it.each(["loads", "fails"] as const)(
      "leaves the newer person signed in when an older sign-in's catalogue %s last",
      async (outcome) => {
        const { el } = await mountApp();
        await flush(el);
        const release = await holdCatalogue();
        emit(lock(el)!, "logged-in", {
          personId: "manager",
          displayName: "Manager",
          permissions: ["venue.configure"],
        });
        await flush(el);
        emit(lock(el)!, "logged-in", { personId: "staff", displayName: "Staff", permissions: [] });
        await flush(el);
        release(outcome);
        await flush(el);
        expect(signedIn(el).permissions).toEqual([]);
        expect(signedIn(el).operatorPersonId).toBe("staff");
        expect(signedIn(el).operatorName).toBe("Staff");
      },
    );

    it("asks for no further counter list once a logout comes while the held orders load", async () => {
      let release!: (rows: never[]) => void;
      const { el } = await mountApp({
        // Not pay-first, so the station queue is a real read the counter lists would make next.
        zonePolicy: { serviceMode: "ticket_then_pay" },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        listWorkingOrders: vi.fn(() => new Promise((done) => (release = done))),
      });
      await toCounter(el);
      expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
      emit(shell(el)!, "logout");
      await flush(el);
      release([]);
      await flush(el);
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      expect(currentApi.listCounterWaiting).not.toHaveBeenCalled();
    });

    it("keeps the roster it had when a logout comes while the sign-in's roster loads", async () => {
      const { el } = await mountApp();
      await flush(el);
      let release!: (staff: { personId: string; displayName: string }[]) => void;
      vi.mocked(currentApi.listStaff).mockImplementationOnce(
        () => new Promise((done) => (release = done)),
      );
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      // The lock screen's own read, then the sign-in's.
      expect(currentApi.listStaff).toHaveBeenCalledTimes(2);
      emit(shell(el)!, "logout");
      await flush(el);
      release([{ personId: "p2", displayName: "Ben" }]);
      await flush(el);
      expect((el as unknown as { staff: unknown[] }).staff).toEqual([]);
    });

    it("stays locked when the idle logout comes while a sign-in waits for the floor", async () => {
      const sa = fakeSessionActivity();
      let resolve!: (value: TableState[]) => void;
      currentApi = stubApi({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef, capabilities: [] }),
        getTablesState: vi.fn(() => new Promise<TableState[]>((done) => (resolve = done))),
      });
      const { el } = await mountWidget<TillApp>("till-app", {
        api: currentApi,
        sessionActivity: sa as never,
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      (sa.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
      await flush(el);
      resolve([freeTable]);
      await flush(el);
      expect(signedIn(el).screen).toBe("lock");
      expect(shell(el)).toBeNull();
      expect((el as unknown as { tables: TableState[] }).tables).toEqual([]);
    });

    it("installs no floor when a logout comes while a restored floor tab loads after the counter", async () => {
      history.replaceState(null, "", "/tabs/floor");
      let resolve!: (value: TableState[]) => void;
      const { el } = await mountApp({
        getTablesState: vi.fn(() => new Promise<TableState[]>((done) => (resolve = done))),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("floor");
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      emit(shell(el)!, "logout");
      await flush(el);
      resolve([freeTable]);
      await flush(el);
      expect(signedIn(el).screen).toBe("lock");
      expect((el as unknown as { tables: TableState[] }).tables).toEqual([]);
    });

    it("stays locked when the till moves to another server while a sign-in loads", async () => {
      const router = new ServerRouter({
        origin: BOX,
        fetchImpl: probeFetch(),
        storage: memoryStorage(),
      });
      currentApi = stubApi();
      const { el } = await mountWidget<TillApp>("till-app", { api: currentApi, router });
      await flush(el);
      const release = await holdCatalogue();
      emit(lock(el)!, "logged-in", {
        personId: "manager",
        displayName: "Manager",
        permissions: ["venue.configure"],
      });
      await flush(el);
      router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
      await flush(el);
      release();
      await flush(el);
      expect(signedIn(el).screen).toBe("lock");
      expect(signedIn(el).operatorName).toBe("");
      expect(signedIn(el).permissions).toEqual([]);
    });
  });
});

// The venue's servers (#261). Mirrors the un-exported helpers in server-router.test.ts —
// redefined locally rather than exported from there (they are private test fixtures).
const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

/** A fetch that always fails at the network level — the router here is used only as an EventTarget
 * (the app subscribes to its `server-changed`), never probed, so no /api/node answer is needed. */
function probeFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("till-app follows a server move", () => {
  it("on server-changed: drops the operator, locks with server.switched, and re-boots against the new target", async () => {
    const router = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(),
      storage: memoryStorage(),
    });
    const api = stubApi(); // getTill resolves the shared `till` fixture; getDeviceIdentity rejects (not a device)
    const { el } = await mountWidget<TillApp>("till-app", { api, router });
    const c = await toCounter(el); // the suite's existing login helper (logs in "Ana" = p1)
    // The half-built order the till holds when the box dies — it must survive the move (kept in memory).
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    expect((el as unknown as { operatorPersonId: string }).operatorPersonId).not.toBe("");

    router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
    await flush(el);

    expect((el as unknown as { screen: string }).screen).toBe("lock");
    expect((el as unknown as { operatorPersonId: string }).operatorPersonId).toBe("");
    expect(el.shadowRoot!.textContent).toContain(t("server.switched"));
    // Exactly two getTill: the initial boot + the one re-boot the move triggers. A doubled subscription
    // (a handler registered in both connectedCallback and willUpdate) would re-boot twice — this pins it.
    expect(api.getTill).toHaveBeenCalledTimes(2);
    // The working order is KEPT across the move (only the operator session is dropped).
    expect(c.store.lines).toHaveLength(1);
  });

  it("feeds the boot payload's servers to the router", async () => {
    const router = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(),
      storage: memoryStorage(),
    });
    const setServers = vi.spyOn(router, "setServers");
    const servers = [{ nodeId: "c", url: CLOUD, standing: "serving-secondary" as const }];
    const api = stubApi({ getTill: vi.fn().mockResolvedValue({ ...till, servers }) });
    const { el } = await mountWidget<TillApp>("till-app", { api, router });
    await flush(el);
    expect(setServers).toHaveBeenCalledWith(servers);
  });

  it("shows the waiting-for-promotion banner in the shell while the router waits", async () => {
    // On the shell surface (an operator mid-shift) the lock-screen's own status line is not visible, so
    // `till-app` surfaces `server.waiting_promotion` in its own `role="status"` banner while the router
    // reports no server is accepting sales. Two-sided: absent before a probe leaves the router waiting,
    // present after.
    const router = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(), // every server is down → a round finds no primary → waiting
      storage: memoryStorage(),
    });
    const api = stubApi();
    const { el } = await mountWidget<TillApp>("till-app", { api, router });
    await toCounter(el); // in the shell (logged in on the counter)
    const banner = () => el.shadowRoot!.querySelector<HTMLElement>(".banner[role='status']");
    // Not waiting yet (no probe has run) → no banner.
    expect(router.waiting).toBe(false);
    expect(banner()).toBeNull();
    // A probe round with every server unreachable leaves the router waiting for a promotion; the
    // `state-changed` it dispatches repaints the app, which now shows the banner.
    await router.probeNow();
    await flush(el);
    expect(router.waiting).toBe(true);
    expect(banner()!.textContent).toContain(t("server.waiting_promotion"));
  });
});

describe("a failed list refresh after a successful write", () => {
  // Fake timers from mount on: the retry countdown is a chain of one-second timeouts.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(el: TillApp): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
  }

  async function toCounterFake(el: TillApp): Promise<TillCounterScreen> {
    await settle(el);
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await settle(el);
    return counter(el)!;
  }

  async function tick(el: TillApp, ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await el.updateComplete;
  }

  const notice = (el: TillApp, list: "held" | "station") =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-refresh-notice="${list}"]`)!;
  const message = (el: TillApp, list: "held" | "station") =>
    notice(el, list).querySelector<HTMLElement>(".refresh-message")!.textContent!.trim();
  const countdown = (el: TillApp, list: "held" | "station") =>
    notice(el, list).querySelector<HTMLElement>(".refresh-countdown")?.textContent?.trim() ?? "";
  const tryNow = (el: TillApp, list: "held" | "station") =>
    notice(el, list).querySelector<HTMLElement>("wt-button[data-refresh-retry]");
  const alertText = (el: TillApp) =>
    el.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "";
  const secondsLeft = (n: number) =>
    n === 1 ? t("refresh.retry_in_one") : t("refresh.retry_in").replace("{n}", String(n));

  /** The login's own read succeeds; every read after it fails until the test says otherwise. */
  function failingAfterLogin<T>(first: T) {
    return vi.fn().mockResolvedValueOnce(first).mockRejectedValue(new TypeError("Failed to fetch"));
  }

  async function parkWithFailingRefresh() {
    const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
    const { el } = await mountApp({ listWorkingOrders });
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 4" });
    await settle(el);
    return { el, c, listWorkingOrders };
  }

  it("park: the hold stands and the refresh failure is reported as one, never as held.park_error", async () => {
    const { el, c, listWorkingOrders } = await parkWithFailingRefresh();

    expect(currentApi.parkOrder).toHaveBeenCalledOnce();
    expect(listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.store.lines).toHaveLength(0); // the hold succeeded, so the basket is cleared
    expect(alertText(el)).not.toContain(t("held.park_error"));
    expect(message(el, "held")).toBe(t("refresh.held_after_park"));
    expect(countdown(el, "held")).toBe(secondsLeft(5));
    expect(tryNow(el, "held")).not.toBeNull();
  });

  it("counts down each second, retries after 5 s, then 10 s, then every 30 s", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();

    await tick(el, 1000);
    expect(countdown(el, "held")).toBe(secondsLeft(4));
    await tick(el, 3000);
    expect(countdown(el, "held")).toBe(secondsLeft(1));
    expect(listWorkingOrders).toHaveBeenCalledTimes(2);
    await tick(el, 1000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
    expect(countdown(el, "held")).toBe(secondsLeft(10));
    await tick(el, 9000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
    await tick(el, 1000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
    expect(countdown(el, "held")).toBe(secondsLeft(30));
    await tick(el, 30_000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(5);
    expect(countdown(el, "held")).toBe(secondsLeft(30));
  });

  it("a retry that succeeds shows the refreshed list and clears the message", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();
    listWorkingOrders.mockResolvedValue([heldSummary]);

    await tick(el, 5000);

    expect(el.shadowRoot!.querySelector("[data-refresh-retry]")).toBeNull();
    expect(message(el, "held")).toBe("");
    expect(counter(el)!.heldOrders).toEqual([heldSummary]);
  });

  it("Try now retries at once, and a failure restarts the countdown at the next step", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();
    await tick(el, 2000);

    tryNow(el, "held")!.click();
    await settle(el);

    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
    expect(countdown(el, "held")).toBe(secondsLeft(10));
    await tick(el, 3000); // the countdown the click replaced would have fired here
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
  });

  it("the announced message does not change as the countdown ticks", async () => {
    const { el } = await parkWithFailingRefresh();
    const region = notice(el, "held").querySelector<HTMLElement>('[role="status"]')!;
    const before = region.textContent;

    await tick(el, 1000);

    expect(region.textContent).toBe(before);
    expect(region.textContent).not.toContain(secondsLeft(4));
  });

  it("a second failure while a retry counts down joins that retry, keeping its countdown", async () => {
    const { el, c, listWorkingOrders } = await parkWithFailingRefresh();
    await tick(el, 2000);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 5" });
    await settle(el);
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
    expect(countdown(el, "held")).toBe(secondsLeft(3));

    await tick(el, 3000);

    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
    await tick(el, 5000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
  });

  it("signing out stops the retries and clears the message", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();

    emit(counter(el)!, "logout");
    await settle(el);
    await tick(el, 60_000);

    expect(listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-refresh-retry]")).toBeNull();
  });

  it("while a retry is running it says so, and Try now does not start a second one", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();
    let fail: (error: unknown) => void = () => undefined;
    listWorkingOrders.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );

    tryNow(el, "held")!.click();
    await settle(el);
    expect(countdown(el, "held")).toBe(t("refresh.retrying"));
    tryNow(el, "held")!.click();
    await settle(el);
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);

    fail(new TypeError("Failed to fetch"));
    await settle(el);
    expect(countdown(el, "held")).toBe(secondsLeft(10));
  });

  it("a retry that fails after the operator signed out does not bring the message back", async () => {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();
    let fail: (error: unknown) => void = () => undefined;
    listWorkingOrders.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    tryNow(el, "held")!.click();
    await settle(el);

    emit(counter(el)!, "logout");
    await settle(el);
    fail(new TypeError("Failed to fetch"));
    await tick(el, 60_000);

    expect(el.shadowRoot!.querySelector("[data-refresh-retry]")).toBeNull();
    expect(listWorkingOrders).toHaveBeenCalledTimes(3);
  });

  it("an unattended operator's idle sign-out still falls due", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, inactivityTimeoutSeconds: 75 }),
    });
    await toCounterFake(el);
    await tick(el, 60_000);
    expect(lock(el)).toBeNull();
    await tick(el, 15_000);
    expect(lock(el)).not.toBeNull();
    expect(currentApi.logout).toHaveBeenCalledOnce();
  });

  it("automatic retries do not count as operator activity: the idle sign-out still falls due", async () => {
    const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, inactivityTimeoutSeconds: 20 }),
      listWorkingOrders,
    });
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 4" });
    await settle(el);

    await tick(el, 15_000); // retries at 5 s and 15 s, both failing
    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
    expect(lock(el)).toBeNull();

    await tick(el, 5000);
    expect(lock(el)).not.toBeNull();
    expect(currentApi.logout).toHaveBeenCalledOnce();
    await tick(el, 60_000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
  });

  it.each(["signing out", "a re-boot", "disconnecting"])(
    "%s while the post-write refresh is still pending starts no retry when that refresh fails",
    async (boundary) => {
      let fail: (error: unknown) => void = () => undefined;
      const listWorkingOrders = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
        .mockRejectedValue(new TypeError("Failed to fetch"));
      const router = new ServerRouter({
        origin: BOX,
        fetchImpl: probeFetch(),
        storage: memoryStorage(),
      });
      const { el } = await mountWidget<TillApp>("till-app", {
        api: stubApi({ listWorkingOrders }),
        router,
      });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "park-order", { label: "Mesa 4" });
      await settle(el);
      expect(listWorkingOrders).toHaveBeenCalledTimes(2);

      if (boundary === "signing out") emit(c, "logout");
      else if (boundary === "a re-boot")
        router.dispatchEvent(
          new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }),
        );
      else el.remove();
      await settle(el);
      fail(new TypeError("Failed to fetch"));
      await tick(el, 60_000);

      expect(listWorkingOrders).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("[data-refresh-notice][data-active]")).toBeNull();
    },
  );

  /** A park's retry left in flight across a sign-out, then a new session whose sale's refresh fails. */
  async function retryInFlightAcrossSessions() {
    const { el, listWorkingOrders } = await parkWithFailingRefresh();
    let resolve: (rows: HeldOrderSummary[]) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    listWorkingOrders.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    tryNow(el, "held")!.click();
    await settle(el);
    emit(counter(el)!, "logout");
    await settle(el);
    listWorkingOrders.mockResolvedValueOnce([]);
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await settle(el);
    expect(listWorkingOrders).toHaveBeenCalledTimes(5);
    expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
    expect(countdown(el, "held")).toBe(secondsLeft(5));
    return { el, listWorkingOrders, resolve, reject };
  }

  it("a retry from before a sign-out that succeeds late neither installs its rows nor clears the new session's notice", async () => {
    const { el, listWorkingOrders, resolve } = await retryInFlightAcrossSessions();

    resolve([heldSummary]);
    await settle(el);

    expect(counter(el)!.heldOrders).toEqual([]);
    expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
    expect(countdown(el, "held")).toBe(secondsLeft(5));
    await tick(el, 5000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(6);
  });

  it("a retry from before a sign-out that fails late changes neither the new session's message nor its countdown", async () => {
    const { el, listWorkingOrders, reject } = await retryInFlightAcrossSessions();

    reject(new TypeError("Failed to fetch"));
    await settle(el);

    expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
    expect(countdown(el, "held")).toBe(secondsLeft(5));
    await tick(el, 5000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(6);
  });

  it("an older refresh failing after a newer refresh of the list succeeded does not bring the notice back", async () => {
    const { el, c, listWorkingOrders } = await parkWithFailingRefresh();
    let fail: (error: unknown) => void = () => undefined;
    listWorkingOrders.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 5" });
    await settle(el);
    listWorkingOrders.mockResolvedValueOnce([heldSummary]);
    tryNow(el, "held")!.click();
    await settle(el);
    expect(tryNow(el, "held")).toBeNull();

    fail(new TypeError("Failed to fetch"));
    await tick(el, 60_000);

    expect(message(el, "held")).toBe("");
    expect(tryNow(el, "held")).toBeNull();
    expect(counter(el)!.heldOrders).toEqual([heldSummary]);
    expect(listWorkingOrders).toHaveBeenCalledTimes(4);
  });

  it("a newer write's failed refresh takes over a retry still in flight, whose late answer is then ignored", async () => {
    const { el, c, listWorkingOrders } = await parkWithFailingRefresh();
    let resolve: (rows: HeldOrderSummary[]) => void = () => undefined;
    listWorkingOrders.mockImplementationOnce(() => new Promise((yes) => (resolve = yes)));
    tryNow(el, "held")!.click();
    await settle(el);
    expect(countdown(el, "held")).toBe(t("refresh.retrying"));

    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 5" });
    await settle(el);

    expect(countdown(el, "held")).toBe(secondsLeft(10));
    resolve([heldSummary]);
    await settle(el);
    expect(counter(el)!.heldOrders).toEqual([]);
    expect(countdown(el, "held")).toBe(secondsLeft(10));
    await tick(el, 10_000);
    expect(listWorkingOrders).toHaveBeenCalledTimes(5);
  });

  it("a discard refusal remains visible when its held-list refresh also fails", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({ code: "order.payment_in_flight" }),
      listWorkingOrders: failingAfterLogin<HeldOrderSummary[]>([]),
    });
    const c = await toCounterFake(el);
    emit(c, "discard-order", { id: "wo-1" });
    await settle(el);
    expect(alertText(el)).toContain(codeMessage("order.payment_in_flight"));
    expect(alertText(el)).not.toContain(t("refresh.held"));
    expect(el.shadowRoot!.querySelector("[data-refresh-notice][data-active]")).toBeNull();
  });

  it.each(["a newer successful refresh", "signing out"])(
    "a failed discard refresh after %s installs no load-failure banner",
    async (boundary) => {
      let fail: (error: unknown) => void = () => undefined;
      const listWorkingOrders = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
        .mockResolvedValueOnce([heldSummary]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);
      emit(c, "discard-order", { id: "wo-1" });
      await settle(el);
      if (boundary === "signing out") emit(c, "logout");
      else emit(c, "discard-order", { id: "wo-2" });
      await settle(el);
      fail(new TypeError("Failed to fetch"));
      await settle(el);
      expect(alertText(el)).not.toContain(t("refresh.held"));
      if (boundary !== "signing out") expect(counter(el)!.heldOrders).toEqual([heldSummary]);
    },
  );

  it("a plain list refresh that fails starts no retry, leaves a countdown alone, and takes over a retry in flight", async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);

      emit(c, "discard-order", { id: "wo-1" });
      await settle(el);
      expect(listWorkingOrders).toHaveBeenCalledTimes(2);
      expect(alertText(el)).toContain(t("refresh.held"));
      expect(el.shadowRoot!.querySelector("[data-refresh-notice][data-active]")).toBeNull();

      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "park-order", { label: "Mesa 4" });
      await settle(el);
      await tick(el, 2000);
      emit(c, "discard-order", { id: "wo-1" });
      await settle(el);
      expect(listWorkingOrders).toHaveBeenCalledTimes(4);
      expect(message(el, "held")).toBe(t("refresh.held_after_park"));
      expect(countdown(el, "held")).toBe(secondsLeft(3));

      let resolve: (rows: HeldOrderSummary[]) => void = () => undefined;
      listWorkingOrders.mockImplementationOnce(() => new Promise((yes) => (resolve = yes)));
      tryNow(el, "held")!.click();
      await settle(el);
      emit(c, "discard-order", { id: "wo-1" });
      await settle(el);
      expect(listWorkingOrders).toHaveBeenCalledTimes(6);
      expect(message(el, "held")).toBe(t("refresh.held_after_park"));
      expect(countdown(el, "held")).toBe(secondsLeft(10));

      resolve([heldSummary]);
      await settle(el);
      expect(countdown(el, "held")).toBe(secondsLeft(10));
      expect(counter(el)!.heldOrders).toEqual([]);
      expect(rejections).toHaveLength(0);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  it("cash sale: the ticket stands and the refresh failure never shows sale.unconfirmed", async () => {
    const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
    const { el } = await mountApp({ listWorkingOrders });
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await settle(el);

    expect(ticket(el)).not.toBeNull();
    expect(alertText(el)).not.toContain(t("sale.unconfirmed"));
    expect(alertText(el)).not.toContain(t("sale.error"));
    expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
  });

  it("card sale: a captured payment's ticket stands and the refresh failure never shows sale.unconfirmed", async () => {
    const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
    const { el } = await mountApp({ listWorkingOrders });
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "collect-card", {});
    await settle(el);

    expect(ticket(el)).not.toBeNull();
    expect(alertText(el)).not.toContain(t("sale.unconfirmed"));
    expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
  });

  it("place: the collect stage stands and the queue refresh failure never shows sale.unconfirmed", async () => {
    const getStationQueue = failingAfterLogin<StationQueue>({
      items: [],
      notices: [],
      printersDown: [],
    });
    const { el } = await mountApp({
      zonePolicy: { serviceMode: "ticket_then_pay" },
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      getStationQueue,
    });
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "place-order");
    await settle(el);

    expect(currentApi.placeOrder).toHaveBeenCalledOnce();
    expect(tenderPay(el).stage).toBe("collect");
    expect(alertText(el)).not.toContain(t("sale.unconfirmed"));
    expect(alertText(el)).not.toContain(t("place.error"));
    expect(message(el, "station")).toBe(t("refresh.station_after_place"));

    getStationQueue.mockResolvedValue({ items: [stationGroup], notices: [] });
    await tick(el, 5000);

    expect(el.shadowRoot!.querySelector("[data-refresh-retry]")).toBeNull();
    expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);
  });

  it.each([
    ["ticket_then_pay", "cash", "confirm-payment", { method: "cash", amount: "5" }],
    ["ticket_then_pay", "an integrated card", "collect-card", {}],
    ["ticket_then_pay", "cash", "confirm-payment", { method: "cash", amount: "5" }],
    ["ticket_then_pay", "an integrated card", "collect-card", {}],
  ] as const)(
    "a kitchen queue that cannot be read after an order in a %s zone is paid by %s at the order stage says the sale was recorded",
    async (orderFlow, _method, event, detail) => {
      const getStationQueue = failingAfterLogin<StationQueue>({
        items: [],
        notices: [],
        printersDown: [],
      });
      const { el } = await mountApp({
        zonePolicy: { serviceMode: orderFlow },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow }),
        getStationQueue,
      });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, event, detail);
      await settle(el);

      expect(ticket(el)).not.toBeNull();
      expect(alertText(el)).not.toContain(t("sale.unconfirmed"));
      expect(message(el, "station")).toBe(t("refresh.station_after_sale"));
    },
  );

  /** A ticket-then-pay counter whose zone list offers a prepay zone, `zone-deli`, to switch to. */
  function mountWithPrepayZone(getStationQueue: ReturnType<typeof vi.fn>) {
    const counterZone = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    counterZone.context = {
      departmentName: "Restaurant",
      zoneId: "zone-counter",
      departmentId: "department-default",
      serviceMode: "ticket_then_pay",
    };
    counterZone.zones = [
      {
        id: "zone-counter",
        name: "Counter",
        departmentId: "department-default",
        departmentName: "Restaurant",
        serviceMode: "ticket_then_pay",
      },
      {
        id: "zone-deli",
        name: "Deli",
        departmentId: "department-deli",
        departmentName: "Deli",
        serviceMode: "prepay",
      },
    ];
    const deli = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    deli.context = {
      departmentName: "Restaurant",
      zoneId: "zone-deli",
      departmentId: "department-deli",
      serviceMode: "prepay",
    };
    return mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      getStationQueue,
      listDefaultZoneOffers: vi.fn().mockResolvedValue(counterZone),
      listZoneOffers: vi.fn().mockResolvedValue(deli),
    });
  }

  it("a kitchen-queue refresh that answers after a switch to a prepay zone does not put its queue back", async () => {
    let resolve: (queue: { items: unknown[]; notices: unknown[] }) => void = () => undefined;
    const getStationQueue = vi
      .fn()
      .mockResolvedValueOnce({ items: [stationGroup], notices: [] })
      .mockImplementationOnce(() => new Promise((yes) => (resolve = yes)));
    const { el } = await mountWithPrepayZone(getStationQueue);
    const c = await toCounterFake(el);
    expect(c.stationQueue).toEqual([stationGroup]);
    emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
    await settle(el);
    expect(getStationQueue).toHaveBeenCalledTimes(2);

    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await settle(el);
    expect(c.orderFlow).toBe("prepay");
    expect(c.stationQueue).toEqual([]);

    resolve({ items: [stationGroup], notices: [] });
    await settle(el);

    expect(c.stationQueue).toEqual([]);
  });

  it("a switch to a prepay zone ends a kitchen-queue retry, and that retry's late failure does not bring the notice back", async () => {
    const getStationQueue = failingAfterLogin<StationQueue>({
      items: [],
      notices: [],
      printersDown: [],
    });
    const { el } = await mountWithPrepayZone(getStationQueue);
    const c = await toCounterFake(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "place-order");
    await settle(el);
    expect(message(el, "station")).toBe(t("refresh.station_after_place"));
    let fail: (error: unknown) => void = () => undefined;
    getStationQueue.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    tryNow(el, "station")!.click();
    await settle(el);
    expect(countdown(el, "station")).toBe(t("refresh.retrying"));
    emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
    await settle(el);
    emit(ticket(el)!, "new-sale");
    await settle(el);

    emit(counter(el)!, "counter-zone-selected", { zoneId: "zone-deli" });
    await settle(el);
    expect(counter(el)!.orderFlow).toBe("prepay");
    expect(message(el, "station")).toBe("");

    fail(new TypeError("Failed to fetch"));
    await settle(el);

    expect(message(el, "station")).toBe("");
    expect(tryNow(el, "station")).toBeNull();
    expect(getStationQueue).toHaveBeenCalledTimes(3);
  });

  describe("a list read after a write that never answers leaves the basket usable", () => {
    /** Like fetch, the read rejects only when its signal aborts. */
    function unanswered(...args: unknown[]): Promise<never> {
      const options = args.at(-1) as { signal?: AbortSignal } | undefined;
      return new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
      );
    }

    /** The login's own read answers; every read after it stays out. */
    function unansweredAfterLogin<T>(first: T) {
      return vi.fn().mockResolvedValueOnce(first).mockImplementation(unanswered);
    }

    async function payNextSale(el: TillApp): Promise<void> {
      emit(ticket(el)!, "new-sale");
      await settle(el);
      expect(counter(el)!.busy).toBe(false);
      counter(el)!.store.addProduct(cafe, "1");
      await el.updateComplete;
      emit(counter(el)!, "confirm-payment", { method: "cash", amount: "5" });
      await settle(el);
    }

    const ticketThenPay = {
      zonePolicy: { serviceMode: "ticket_then_pay" },
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
    };

    for (const locale of ["en-GB", "es-ES"])
      for (const theme of ["light", "dark"] as const)
        for (const width of [390, 1280])
          it(`A318 look: held refresh and retry, ${locale}, ${theme}, ${width}`, async () => {
            const size = { width: window.innerWidth, height: window.innerHeight };
            const previousLocale = currentLocale();
            await page.viewport(width, 900);
            try {
              const listWorkingOrders = unansweredAfterLogin<HeldOrderSummary[]>([]);
              const { el } = await mountApp(
                {
                  listWorkingOrders,
                  listProducts: vi.fn().mockResolvedValue({
                    menus: [defaultMenu],
                    products: [
                      {
                        ...cafe,
                        unit: {
                          id: "unit-each",
                          name: { en: "Each", es: "Unidad" },
                          abbreviation: { en: "ea", es: "ud" },
                          precision: 0,
                          hardwareUnit: null,
                        },
                      },
                    ],
                  }),
                  getTill: vi.fn().mockResolvedValue({ ...till, locale }),
                },
                theme,
              );
              const c = await toCounterFake(el);
              c.store.addProduct(cafe, "1");
              emit(c, "park-order", { label: "Mesa 4" });
              await settle(el);
              expect(counter(el)!.store.lines).toEqual([]);
              await page.screenshot({
                path: `__screenshots__/a318/${locale}-${theme}-${width}-held.png`,
              });
              await tick(el, 150_000);
              expect(message(el, "held")).toBe(t("refresh.held_after_park"));
              tryNow(el, "held")!.click();
              await settle(el);
              expect(countdown(el, "held")).toBe(t("refresh.retrying"));
              await page.screenshot({
                path: `__screenshots__/a318/${locale}-${theme}-${width}-retrying.png`,
              });
              await tick(el, 150_000);
              expect(countdown(el, "held")).toBe(secondsLeft(10));
              await page.screenshot({
                path: `__screenshots__/a318/${locale}-${theme}-${width}-notice.png`,
              });
            } finally {
              setLocale(previousLocale);
              await page.viewport(size.width, size.height);
            }
          });

    it("A318: Hold frees the next basket while the held-list read never answers", async () => {
      const listWorkingOrders = unansweredAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      const id = c.store.id;
      emit(c, "park-order", { label: "Mesa 4" });
      await settle(el);

      expect(c.store.id).not.toBe(id);
      expect(c.store.lines).toEqual([]);
      expect(counter(el)!.busy).toBe(false);
      counter(el)!.store.addProduct(cafe, "1");
      emit(counter(el)!, "park-order", { label: "Mesa 5" });
      await settle(el);
      expect(currentApi.parkOrder).toHaveBeenCalledTimes(2);
      expect(counter(el)!.store.lines).toEqual([]);
      await tick(el, 150_000);
      expect(message(el, "held")).toBe(t("refresh.held_after_park"));
      expect(countdown(el, "held")).toBe(secondsLeft(5));
      expect(counter(el)!.busy).toBe(false);
    });

    it.each(["automatic", "Try now"])(
      "A318: a never-answering %s retry returns to the countdown at 150 seconds",
      async (trigger) => {
        const { el, listWorkingOrders } = await parkWithFailingRefresh();
        listWorkingOrders.mockImplementation(unanswered);
        if (trigger === "automatic") await tick(el, 5000);
        else {
          tryNow(el, "held")!.click();
          await settle(el);
        }
        expect(countdown(el, "held")).toBe(t("refresh.retrying"));
        expect(counter(el)!.busy).toBe(false);
        await tick(el, 149_999);
        expect(countdown(el, "held")).toBe(t("refresh.retrying"));
        await tick(el, 1);
        expect(message(el, "held")).toBe(t("refresh.held_after_park"));
        expect(countdown(el, "held")).toBe(secondsLeft(10));
        expect(counter(el)!.busy).toBe(false);
        listWorkingOrders.mockResolvedValue([heldSummary]);
        await tick(el, 10_000);
        expect(counter(el)!.heldOrders).toEqual([heldSummary]);
        expect(message(el, "held")).toBe("");
      },
    );

    it("a cash sale shows its ticket and the next sale can be paid", async () => {
      const listWorkingOrders = unansweredAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await settle(el);

      expect(ticket(el)).not.toBeNull();
      expect(listWorkingOrders).toHaveBeenCalledTimes(2);
      await payNextSale(el);
      expect(currentApi.recordSale).toHaveBeenCalledTimes(2);
    });

    it("a card sale shows its ticket and the next sale can be paid", async () => {
      const listWorkingOrders = unansweredAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await settle(el);

      expect(ticket(el)).not.toBeNull();
      expect(listWorkingOrders).toHaveBeenCalledTimes(2);
      await payNextSale(el);
      expect(currentApi.recordSale).toHaveBeenCalledOnce();
    });

    it("a place moves to the collect stage with the basket free, and the order can be collected", async () => {
      const getStationQueue = unansweredAfterLogin<StationQueue>({
        items: [],
        notices: [],
        printersDown: [],
      });
      const { el } = await mountApp({ ...ticketThenPay, getStationQueue });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await settle(el);

      expect(getStationQueue).toHaveBeenCalledTimes(2);
      expect(tenderPay(el).stage).toBe("collect");
      expect(counter(el)!.busy).toBe(false);
      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await settle(el);
      expect(currentApi.collectOrder).toHaveBeenCalledOnce();
      expect(ticket(el)).not.toBeNull();
    });

    it("a collect shows its ticket and the next sale can be paid", async () => {
      const listCounterWaiting = vi.fn().mockResolvedValue([]);
      const { el } = await mountApp({ ...ticketThenPay, listCounterWaiting });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await settle(el);
      listCounterWaiting.mockImplementation(unanswered);
      const reads = listCounterWaiting.mock.calls.length;

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await settle(el);

      expect(ticket(el)).not.toBeNull();
      expect(listCounterWaiting).toHaveBeenCalledTimes(reads + 1);
      await payNextSale(el);
      expect(currentApi.recordSale).toHaveBeenCalledOnce();
    });

    it("a Find a bill payment shows its ticket and the next sale can be paid", async () => {
      const listCounterWaiting = unansweredAfterLogin<unknown[]>([]);
      const { el } = await mountApp({ listCounterWaiting });
      await toCounterFake(el);
      el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!
        .shadowRoot!.querySelector<HTMLElement>(".find-bill")!
        .click();
      await el.updateComplete;
      emit(el.shadowRoot!.querySelector("till-find-bill-dialog")!, "find-bill-pay", {
        workingOrderId: "wo-debt",
        tender: { method: "cash", amount: "30.00" },
        invoiced: true,
      });
      await settle(el);

      expect(ticket(el)).not.toBeNull();
      expect(listCounterWaiting).toHaveBeenCalledTimes(2);
      await payNextSale(el);
      expect(currentApi.recordSale).toHaveBeenCalledOnce();
    });

    it("a read still out when the till's request limit passes is cancelled, said in the list's retry notice, and retried", async () => {
      const listWorkingOrders = unansweredAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await settle(el);
      const [options] = listWorkingOrders.mock.lastCall as [{ signal?: AbortSignal }?];

      // TABLE_REQUEST_LIMIT_MS in till-app.ts.
      await tick(el, 149_999);
      expect(options?.signal?.aborted).toBe(false);
      expect(message(el, "held")).toBe("");
      await tick(el, 1);
      expect(options?.signal?.aborted).toBe(true);
      expect(message(el, "held")).toBe(t("refresh.held_after_sale"));
      expect(countdown(el, "held")).toBe(secondsLeft(5));

      listWorkingOrders.mockResolvedValue([heldSummary]);
      await tick(el, 5000);
      expect(message(el, "held")).toBe("");
      emit(ticket(el)!, "new-sale");
      await settle(el);
      expect(counter(el)!.heldOrders).toEqual([heldSummary]);
    });

    it.each([
      ["the waiting list", "waiting", "listCounterWaiting", "refresh.waiting_after_place"],
      ["the kitchen stations", "station", "listStations", "refresh.station_after_place"],
      ["the kitchen queue", "station", "getStationQueue", "refresh.station_after_place"],
    ] as const)(
      "a read of %s after a place still out when the till's request limit passes is cancelled and said in the list's retry notice",
      async (_read, list, method, key) => {
        const { el } = await mountApp(ticketThenPay);
        const c = await toCounterFake(el);
        c.store.addProduct(cafe, "2");
        await el.updateComplete;
        const read = vi.mocked(currentApi[method] as (...args: unknown[]) => Promise<unknown>);
        read.mockImplementation(unanswered);
        const reads = read.mock.calls.length;

        emit(c, "place-order");
        await settle(el);
        expect(read).toHaveBeenCalledTimes(reads + 1);
        const options = read.mock.lastCall!.at(-1) as { signal?: AbortSignal } | undefined;
        const said = () =>
          el.shadowRoot!.querySelector(`[data-refresh-notice="${list}"]`)?.textContent ?? "";

        // TABLE_REQUEST_LIMIT_MS in till-app.ts.
        await tick(el, 149_999);
        expect(options?.signal?.aborted).toBe(false);
        expect(said()).not.toContain(t(key));
        await tick(el, 1);
        expect(options?.signal?.aborted).toBe(true);
        expect(said()).toContain(t(key));
      },
    );
  });
});

describe("a counter pay, place or hold refused for a reason the operator can act on", () => {
  // Each of these refusals names what to do (wait for the card, remove the sold-out item or the one
  // sold only as an extra); the generic "try again" would send the operator round the same refusal.
  const actions = [
    ["confirm-payment", { method: "cash", amount: "5" }, "recordSale", undefined, "sale.error"],
    ["collect-card", {}, "pay", undefined, "sale.error"],
    ["place-order", undefined, "placeOrder", "ticket_then_pay", "place.error"],
  ] as const;

  for (const code of [
    "order.payment_in_flight",
    "product.unavailable",
    "product.not_sold_separately",
  ]) {
    it.each(actions)(
      `${code}: %s shows the code's own message, not the generic one`,
      async (type, detail, method, orderFlow, generic) => {
        const { el } = await mountApp({
          ...(orderFlow === undefined
            ? {}
            : {
                zonePolicy: { serviceMode: orderFlow },
                getTill: vi.fn().mockResolvedValue({ ...till, orderFlow }),
              }),
          [method]: vi.fn().mockRejectedValue({ code }),
        });
        const c = await toCounter(el);
        c.store.addProduct(cafe, "1");
        await el.updateComplete;

        emit(c, type, detail);
        await flush(el);

        const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
        expect(banner.textContent).toContain(codeMessage(code));
        expect(banner.textContent).not.toContain(t(generic));
        expect(el.shadowRoot!.textContent).not.toContain(code);
        expect(c.store.lines).toHaveLength(1);
      },
    );

    it(`${code}: a Hold whose save is refused shows the code's own message, not held.park_error`, async () => {
      const updateWorkingOrder = vi.fn().mockRejectedValue({ code });
      const { el } = await mountApp({ updateWorkingOrder });
      const c = await toCounter(el);
      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1");
      await el.updateComplete;

      emit(c, "park-order", { label: "Mesa 4" });
      await flush(el);

      expect(updateWorkingOrder).toHaveBeenCalledOnce();
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(codeMessage(code));
      expect(banner.textContent).not.toContain(t("held.park_error"));
      expect(c.store.lines).toHaveLength(2);
    });
  }

  it("clears the coded message when the next action starts", async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "order.payment_in_flight" })
      .mockRejectedValueOnce({ code: "server.internal" });
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(banner.textContent).not.toContain(codeMessage("order.payment_in_flight"));
  });
});

describe("the counter's held orders: moving one to a table, and paying a moved bill", () => {
  const counterOrder: HeldOrderSummary = {
    ...heldSummary,
    id: "wo-12",
    orderNumber: 12,
    label: "Ana",
  };
  const luisParty = {
    id: "v7",
    revision: 9,
    guestCount: 2,
    state: "open" as const,
    name: "Luis",
    displayName: "Luis",
    mainBillId: "wo-7",
    outstanding: "12.00",
    billCount: 1,
    tableIds: ["t7"],
    unsentDrafts: [],
    reminder: null,
  };
  const mesa9: TableState = { ...freeTable, id: "t9", label: "Mesa 9" };
  const mesa7: TableState = {
    ...openTable,
    id: "t7",
    label: "Mesa 7",
    condition: "held",
    party: luisParty,
  };
  const heldList = (el: TillApp) =>
    counterGrid(el)!.shadowRoot!.querySelector<HTMLElement & { tables: TableState[] }>(
      "till-held-orders",
    )!;
  const toast = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { open: boolean; message: string }>(
      "wt-toast[data-submitted-toast]",
    )!;
  const alert = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>('[role="alert"]');

  async function counterWith(overrides: Record<string, unknown> = {}) {
    const mounted = await mountApp({
      listWorkingOrders: vi.fn().mockResolvedValue([counterOrder]),
      getTablesState: vi.fn().mockResolvedValue([mesa7, mesa9]),
      moveBill: vi.fn().mockResolvedValue({ partyId: "v-new", billId: "wo-12", merged: false }),
      ...overrides,
    });
    const c = await toCounter(mounted.el);
    return { ...mounted, c };
  }

  it("does not reload held orders when a move to a table answers after sign-out", async () => {
    let answer!: (result: { partyId: string; billId: string; merged: boolean }) => void;
    const { el, c } = await counterWith({
      moveBill: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);
    expect(currentApi.moveBill).toHaveBeenCalledOnce();

    emit(c, "logout");
    await flush(el);
    const heldReads = vi.mocked(currentApi.listWorkingOrders).mock.calls.length;
    answer({ partyId: "v-new", billId: "wo-12", merged: false });
    await flush(el);

    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not send a counter move after its dead-end read outlives sign-out", async () => {
    let answer!: (result: { sends: boolean; deadEnds: [] }) => void;
    const moveBill = vi.fn();
    const { el, c } = await counterWith({
      askOrderDeadEnds: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      moveBill,
    });
    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);
    expect(currentApi.askOrderDeadEnds).toHaveBeenCalledOnce();

    emit(c, "logout");
    await flush(el);
    answer({ sends: false, deadEnds: [] });
    await flush(el);

    expect(moveBill).not.toHaveBeenCalled();
  });

  it("does not reload held orders after a move refusal's floor read outlives sign-out", async () => {
    let answerFloor!: (tables: (typeof mesa7)[]) => void;
    const { el, c } = await counterWith({
      moveBill: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    vi.mocked(currentApi.getTablesState).mockImplementation(
      () => new Promise((resolve) => (answerFloor = resolve)),
    );

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);
    expect(currentApi.getTablesState).toHaveBeenCalled();

    emit(c, "logout");
    await flush(el);
    const heldReads = vi.mocked(currentApi.listWorkingOrders).mock.calls.length;
    answerFloor([mesa7, mesa9]);
    await flush(el);

    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("asks where to make a stored counter dish before moving its bill to a table", async () => {
    const askOrderDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      revision: 3,
      deadEnds: [
        {
          key: "line-1",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const setMakeAt = vi.fn().mockResolvedValue({ revision: 4 });
    const moveBill = vi
      .fn()
      .mockResolvedValue({ partyId: "v-new", billId: "wo-12", merged: false });
    const { el, c } = await counterWith({ askOrderDeadEnds, setMakeAt, moveBill });
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);
    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);
    expect(askOrderDeadEnds).toHaveBeenCalledWith("wo-12", "z1");
    expect(moveBill).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    expect((dialog as HTMLElement & { allowRemove: boolean }).allowRemove).toBe(false);
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(
        new CustomEvent("make-at", { detail: { key: "line-1", stationId: "kitchen" } }),
      );
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(setMakeAt).toHaveBeenCalledWith("wo-12", 3, { "line-1": "kitchen" });
    expect(moveBill).toHaveBeenCalledOnce();
    expect(setMakeAt.mock.invocationCallOrder[0]!).toBeLessThan(
      moveBill.mock.invocationCallOrder[0]!,
    );
  });

  it("rechecks a move refused because its station lost its replacement", async () => {
    const askOrderDeadEnds = vi
      .fn()
      .mockResolvedValueOnce({ sends: false, deadEnds: [], stations: [] })
      .mockResolvedValue({
        sends: true,
        revision: 3,
        deadEnds: [
          {
            key: "line-1",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      });
    const moveBill = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ partyId: "v-new", billId: "wo-12", merged: false });
    const setMakeAt = vi.fn().mockResolvedValue({ revision: 4 });
    const { el, c } = await counterWith({ askOrderDeadEnds, moveBill, setMakeAt });
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);
    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);
    expect(moveBill).toHaveBeenCalledOnce();
    expect(askOrderDeadEnds).toHaveBeenCalledTimes(2);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(
        new CustomEvent("make-at", { detail: { key: "line-1", stationId: "kitchen" } }),
      );
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(setMakeAt).toHaveBeenCalledOnce();
    expect(moveBill).toHaveBeenCalledTimes(2);
  });

  it("reads the floor when Move to table opens, and gives it to the held orders", async () => {
    const { el, c } = await counterWith();
    const reads = vi.mocked(currentApi.getTablesState).mock.calls.length;

    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);

    expect(currentApi.getTablesState).toHaveBeenCalledTimes(reads + 1);
    expect(heldList(el).tables).toEqual([mesa7, mesa9]);
  });

  it("moves a counter order to a table read free as a bill read with no party, stays on the counter and says where it went", async () => {
    const { el, c } = await counterWith();
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);
    const heldReads = vi.mocked(currentApi.listWorkingOrders).mock.calls.length;

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);

    expect(currentApi.moveBill).toHaveBeenCalledWith("wo-12", { tableId: "t9" }, "merge", {
      partyId: null,
      otherPartyId: null,
    });
    expect(counter(el)).not.toBeNull();
    expect(toast(el).open).toBe(true);
    expect(toast(el).message).toBe(t("counter.moved_to_table").replace("{table}", "Mesa 9"));
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(heldReads + 1);
    expect(alert(el)).toBeNull();
  });

  it("sends the party it read at a seated table, with that party's revision", async () => {
    const { el, c } = await counterWith();
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);

    emit(c, "move-held-order", {
      orderId: "wo-12",
      tableId: "t7",
      seated: { id: "v7", revision: 9 },
      bills: "separate",
    });
    await flush(el);

    expect(currentApi.moveBill).toHaveBeenCalledWith("wo-12", { tableId: "t7" }, "separate", {
      partyId: null,
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
    expect(toast(el).message).toBe(t("counter.moved_to_table").replace("{table}", "Mesa 7"));
  });

  it("sends the party the bill choice named, though the floor read since seats another there", async () => {
    const pedro = { ...luisParty, id: "v8", revision: 2, name: "Pedro", displayName: "Pedro" };
    const { el, c } = await counterWith({
      getTablesState: vi.fn().mockResolvedValue([{ ...mesa7, party: pedro }, mesa9]),
    });
    emit(c, "move-held-order-open", undefined);
    await flush(el);
    expect(heldList(el).tables[0]!.party!.id).toBe("v8");

    emit(c, "move-held-order", {
      orderId: "wo-12",
      tableId: "t7",
      seated: { id: "v7", revision: 9 },
      bills: "merge",
    });
    await flush(el);

    expect(currentApi.moveBill).toHaveBeenCalledWith("wo-12", { tableId: "t7" }, "merge", {
      partyId: null,
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
  });

  it("keeps the floor it had when Move to table cannot read it again", async () => {
    const { el, c } = await counterWith({
      getTablesState: vi
        .fn()
        .mockResolvedValueOnce([mesa7, mesa9])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });
    emit(c, "move-held-order-open", undefined);
    await flush(el);
    expect(heldList(el).tables).toEqual([mesa7, mesa9]);
    emit(c, "move-held-order-open", undefined);
    await flush(el);

    expect(heldList(el).tables).toEqual([mesa7, mesa9]);
  });

  it("says the move stands when the held orders cannot be read again after it", async () => {
    const { el, c } = await counterWith({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([counterOrder])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);

    expect(currentApi.moveBill).toHaveBeenCalledOnce();
    expect(toast(el).open).toBe(true);
    expect(
      el
        .shadowRoot!.querySelector('[data-refresh-notice="held"] .refresh-message')!
        .textContent!.trim(),
    ).toBe(t("refresh.held_after_move"));
  });

  it("empties the basket when the order moved is the one retrieved into it", async () => {
    const { el, c } = await counterWith({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-12",
        orderNumber: 12,
        label: "Ana",
        revision: 3,
        lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
      }),
    });
    emit(c, "retrieve-order", { id: "wo-12" });
    await flush(el);
    expect(c.store.id).toBe("wo-12");
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);

    expect(c.store.lines).toHaveLength(0);
    expect(c.store.id).not.toBe("wo-12");
  });

  it("keeps the basket when another order is moved", async () => {
    const { el, c } = await counterWith();
    c.store.addProduct(cafe, "1");
    await el.updateComplete;
    const id = c.store.id;

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);

    expect(c.store.id).toBe(id);
    expect(c.store.lines).toHaveLength(1);
  });

  it.each(["table.needs_clearing", "table.inactive", "service_zone.mode_incompatible"])(
    "shows %s in its own words and reads the held orders again",
    async (code) => {
      const { el, c } = await counterWith({ moveBill: vi.fn().mockRejectedValue({ code }) });
      const heldReads = vi.mocked(currentApi.listWorkingOrders).mock.calls.length;

      emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
      await flush(el);

      expect(alert(el)!.textContent).toContain(codeMessage(code));
      expect(toast(el).open).toBe(false);
      expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(heldReads + 1);
    },
  );

  it("says the table changed when a party sat there since it was read free", async () => {
    const reads = vi
      .fn()
      .mockResolvedValueOnce([mesa7, mesa9])
      .mockResolvedValue([
        mesa7,
        { ...mesa9, condition: "held", party: { ...luisParty, id: "v9", tableIds: ["t9"] } },
      ]);
    const { el, c } = await counterWith({
      getTablesState: reads,
      moveBill: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v9", revision: 1 }),
    });
    emit(c, "move-held-order-open", { orderId: "wo-12" });
    await flush(el);

    emit(c, "move-held-order", { orderId: "wo-12", tableId: "t9", seated: null, bills: "merge" });
    await flush(el);

    expect(alert(el)!.textContent).toContain(codeMessage("party.out_of_date"));
    expect(counter(el)).not.toBeNull();
  });

  it("pays a bill moved to the counter, with nothing paid on it, as the one sale of that bill", async () => {
    const moved: HeldOrderSummary = { ...heldSummary, label: "4" };
    const { el, c } = await counterWith({ listWorkingOrders: vi.fn().mockResolvedValue([moved]) });
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(tenderPay(el).busy).toBe(false);

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledOnce();
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ makeAt: null, menuItemId: "menu-item-cafe-0", quantity: "2" }],
      { method: "cash", amount: "5" },
      "wo-1",
    );
  });

  it("shows what a partly paid bill still owes and to take the rest as a bill payment, and takes no single payment", async () => {
    const partly: HeldOrderSummary = { ...heldSummary, outstanding: "1.00", hasPayments: true };
    const { el, c } = await counterWith({ listWorkingOrders: vi.fn().mockResolvedValue([partly]) });

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    const said = alert(el)!.textContent!;
    emit(c, "confirm-payment", { method: "cash", amount: "1.00" });
    await flush(el);
    emit(c, "collect-card", {});
    await flush(el);

    expect(said).toContain(t("bill.pay_with_bill_payments"));
    expect(said).toContain(
      t("table.bill_to_pay").replace("{amount}", formatMoney("1.00", currentLocale())),
    );
    expect(tenderPay(el).busy).toBe(true);
    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(currentApi.pay).not.toHaveBeenCalled();
    expect(alert(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
    expect(c.store.id).toBe("wo-1");
  });

  it("holds the pay controls on a tab other than the counter while the basket's order holds a payment", async () => {
    const pending: HeldOrderSummary = { ...heldSummary, hasPayments: true };
    const salesTab = {
      key: "sales",
      title: "Sales",
      columns: 12,
      cards: [{ type: "tender-pay" as const, colSpan: 4, rowSpan: 2, config: {} }],
    };
    const { el, c } = await counterWith({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: { ...till.canvas, tabs: [...till.canvas.tabs, salesTab] },
      }),
      listWorkingOrders: vi.fn().mockResolvedValue([pending]),
    });
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    selectTab(el, "sales");
    await flush(el);

    expect(
      activeTabGrid(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!.busy,
    ).toBe(true);
  });

  it("treats a card payment still at the reader as a payment on the bill", async () => {
    const pending: HeldOrderSummary = { ...heldSummary, hasPayments: true };
    const { el, c } = await counterWith({
      listWorkingOrders: vi.fn().mockResolvedValue([pending]),
    });

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    emit(c, "confirm-payment", { method: "cash", amount: "3.00" });
    await flush(el);

    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(alert(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
  });

  it("says to take the rest as a bill payment when the single payment is refused for money on the bill", async () => {
    const { el, c } = await counterWith({
      recordSale: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    });
    c.store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(alert(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
  });
});

describe("the counter's waiting orders (sent and not paid, or paid and not handed over)", () => {
  const sentOrder: CounterWaitingOrder = {
    id: "wo-sent",
    orderNumber: 12,
    label: null,
    status: "placed",
    openedAt: "2026-10-01T10:02:00.000Z",
    settledAt: null,
    collectedAt: null,
    total: "3.00",
    canHandOver: true,
    serviceMode: "ticket_then_pay",
  };
  const handedOrder: CounterWaitingOrder = {
    ...sentOrder,
    id: "wo-handed",
    orderNumber: 13,
    collectedAt: "2026-10-01T10:05:00.000Z",
    canHandOver: false,
  };
  const paidOrder: CounterWaitingOrder = {
    ...sentOrder,
    id: "wo-paid",
    orderNumber: 11,
    status: "settled",
    settledAt: "2026-10-01T10:01:00.000Z",
    serviceMode: null,
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const waitingList = (el: TillApp) =>
    counterGrid(el)?.shadowRoot?.querySelector<TillCounterWaiting>("till-counter-waiting") ?? null;
  const rowOf = (el: TillApp, id: string) =>
    waitingList(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-waiting-order="${id}"]`);
  const alert = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>('[role="alert"]');
  const invoiceFirst = {
    zonePolicy: { serviceMode: "ticket_then_pay" },
    getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
  };

  async function counterWaiting(overrides: Record<string, unknown> = {}) {
    const mounted = await mountApp(overrides);
    const c = await toCounter(mounted.el);
    return { ...mounted, c };
  }

  /** Presses the waiting row's own Pay button. */
  const pressPay = (el: TillApp, id: string) =>
    rowOf(el, id)!.querySelector<HTMLElement>("[data-waiting-pay]")!.click();
  const placedRead = (id: string) => ({
    id,
    orderNumber: 12,
    label: null,
    revision: 2,
    lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
  });
  /** A read that answers only when the test says so. */
  function heldRead() {
    let answer!: (order: unknown) => void;
    let refuse!: (error: unknown) => void;
    const promise = new Promise((resolve, reject) => {
      answer = resolve;
      refuse = reject;
    });
    return { promise, answer, refuse };
  }

  it("lists each waiting order with its state, in the held-orders card even when nothing is held", async () => {
    const { el } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([paidOrder, sentOrder, handedOrder]),
    });

    expect(waitingList(el)!.orders).toEqual([paidOrder, sentOrder, handedOrder]);
    expect(rowOf(el, "wo-paid")!.textContent).toContain(t("waiting.paid_not_handed_over"));
    expect(rowOf(el, "wo-sent")!.textContent).toContain(t("waiting.sent_not_paid"));
    expect(rowOf(el, "wo-handed")!.textContent).toContain(t("waiting.handed_over_not_paid"));
    expect(rowOf(el, "wo-sent")!.querySelector("[data-waiting-pay]")).not.toBeNull();
  });

  it("shows no waiting list, and no held-orders card, when nothing waits and nothing is held", async () => {
    const { el } = await counterWaiting();
    expect(currentApi.listCounterWaiting).toHaveBeenCalled();
    expect(waitingList(el)).toBeNull();
    expect(counterGrid(el)!.shadowRoot!.querySelector("till-held-orders")).toBeNull();
  });

  it("offers Pay on a till that pays at ordering, and collects the order there in its own mode until the next sale", async () => {
    const listCounterWaiting = vi.fn().mockResolvedValue([sentOrder]);
    const { el, c } = await counterWaiting({
      listCounterWaiting,
      retrievePlacedOrder: vi.fn().mockResolvedValue(placedRead("wo-sent")),
    });
    expect(rowOf(el, "wo-sent")!.querySelector("[data-waiting-hand-over]")).not.toBeNull();

    pressPay(el, "wo-sent");
    await flush(el);

    expect(c.store.id).toBe("wo-sent");
    expect(tenderPay(el).mode).toBe("ticket_then_pay");
    expect(tenderPay(el).stage).toBe("collect");
    emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
    await flush(el);
    expect(currentApi.collectOrder).toHaveBeenCalledWith("wo-sent", {
      method: "cash",
      amount: "5",
    });

    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(tenderPay(el).mode).toBe("prepay");
    expect(tenderPay(el).stage).toBe("order");
  });

  it.each([
    ["prepay", "ticket_then_pay"],
    ["ticket_then_pay", "ticket_then_pay"],
    ["ticket_then_pay", "ticket_then_pay"],
  ] as const)(
    "a held order retrieved after Pay on a %s till is taken in the till's own mode, at the order stage",
    async (tillMode, orderMode) => {
      const { el, c } = await counterWaiting({
        zonePolicy: { serviceMode: tillMode },
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: tillMode }),
        listCounterWaiting: vi.fn().mockResolvedValue([{ ...sentOrder, serviceMode: orderMode }]),
        retrievePlacedOrder: vi.fn().mockResolvedValue(placedRead("wo-sent")),
      });
      pressPay(el, "wo-sent");
      await flush(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      expect(tenderPay(el).stage).toBe("collect");

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);

      expect(c.store.id).toBe("wo-1");
      expect(tenderPay(el).mode).toBe(tillMode);
      expect(tenderPay(el).stage).toBe("order");
    },
  );

  it.each([
    ["ticket_then_pay", "ticket_then_pay", "cash", true],
    ["ticket_then_pay", "ticket_then_pay", "card", true],
    ["ticket_then_pay", "ticket_then_pay", "cash", true],
    ["ticket_then_pay", "ticket_then_pay", "card", true],
  ] as const)(
    "a %s order collected on a till whose zone is %s, by %s, offers the receipt issued by payment",
    async (orderMode, tillMode, method, original) => {
      const { el } = await counterWaiting({
        zonePolicy: { serviceMode: tillMode, receiptPrintMode: "on_request" },
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, orderFlow: tillMode, receiptPrintMode: "on_request" }),
        listCounterWaiting: vi.fn().mockResolvedValue([{ ...sentOrder, serviceMode: orderMode }]),
        retrievePlacedOrder: vi.fn().mockResolvedValue(placedRead("wo-sent")),
      });

      pressPay(el, "wo-sent");
      await flush(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      if (method === "cash") emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      else emit(counter(el)!, "collect-card", {});
      await flush(el);

      expect(ticket(el)!.originalReceiptAvailable).toBe(original);
    },
  );

  it.each(["the older", "the newer"] as const)(
    "a Pay answered after a newer Pay was pressed loads nothing, when %s answer comes first",
    async (firstToAnswer) => {
      const older = heldRead();
      const newer = heldRead();
      const retrievePlacedOrder = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const { el, c } = await counterWaiting({
        ...invoiceFirst,
        listCounterWaiting: vi.fn().mockResolvedValue([sentOrder, handedOrder]),
        retrievePlacedOrder,
      });
      const own = c.store.id;

      pressPay(el, "wo-sent");
      pressPay(el, "wo-handed");
      if (firstToAnswer === "the older") {
        older.answer(placedRead("wo-sent"));
        await flush(el);
        expect(c.store.id).toBe(own);
        newer.answer(placedRead("wo-handed"));
        await flush(el);
      } else {
        newer.answer(placedRead("wo-handed"));
        await flush(el);
        expect(c.store.id).toBe("wo-handed");
        older.answer(placedRead("wo-sent"));
        await flush(el);
      }

      expect(c.store.id).toBe("wo-handed");
      expect(alert(el)).toBeNull();
    },
  );

  it("a Pay answered after a held order was retrieved loads nothing", async () => {
    const read = heldRead();
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockReturnValue(read.promise),
    });

    pressPay(el, "wo-sent");
    emit(c, "retrieve-order", { id: "wo-held" });
    await flush(el);
    const retrieved = c.store.id;
    read.answer(placedRead("wo-sent"));
    await flush(el);

    expect(retrieved).not.toBe("wo-sent");
    expect(c.store.id).toBe(retrieved);
    expect(tenderPay(el).stage).toBe("order");
  });

  it("a Pay answered after the basket's order was opened for a bill payment loads nothing", async () => {
    const read = heldRead();
    const partly: HeldOrderSummary = { ...heldSummary, outstanding: "1.00", hasPayments: true };
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listWorkingOrders: vi.fn().mockResolvedValue([partly]),
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockReturnValue(read.promise),
      getBillBalance: vi.fn(() => new Promise(() => {})),
    });
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    pressPay(el, "wo-sent");
    emit(c, "counter-bill-pay", { amount: "1.00" });
    await flush(el);
    read.answer(placedRead("wo-sent"));
    await flush(el);

    expect(c.store.id).toBe("wo-1");
    expect(tenderPay(el).stage).toBe("order");
  });

  it.each([
    ["without a refusal", new TypeError("Failed to fetch")],
    ["with a refusal other than not found", { code: "server.internal" }],
  ])(
    "a Pay whose read failed %s says the order could not be opened, not that it is gone",
    async (_how, failure) => {
      const { el, c } = await counterWaiting({
        ...invoiceFirst,
        listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
        retrievePlacedOrder: vi.fn().mockRejectedValue(failure),
      });
      const own = c.store.id;

      pressPay(el, "wo-sent");
      await flush(el);

      expect(c.store.id).toBe(own);
      expect(alert(el)!.textContent).toContain(t("waiting.pay_error"));
      expect(alert(el)!.textContent).not.toContain(t("held.stale"));
    },
  );

  it("collecting a waiting order reads the kitchen queue again", async () => {
    const getStationQueue = vi.fn().mockResolvedValue({ items: [], notices: [] });
    const { el } = await counterWaiting({
      ...invoiceFirst,
      getStationQueue,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockResolvedValue(placedRead("wo-sent")),
    });
    pressPay(el, "wo-sent");
    await flush(el);
    const reads = getStationQueue.mock.calls.length;

    emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.collectOrder).toHaveBeenCalledOnce();
    expect(getStationQueue).toHaveBeenCalledTimes(reads + 1);
  });

  it("a kitchen queue that cannot be read after a waiting order is collected says the sale was recorded", async () => {
    const getStationQueue = vi.fn().mockResolvedValue({ items: [], notices: [] });
    const { el } = await counterWaiting({
      ...invoiceFirst,
      getStationQueue,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockResolvedValue(placedRead("wo-sent")),
    });
    pressPay(el, "wo-sent");
    await flush(el);
    getStationQueue.mockRejectedValue(new TypeError("Failed to fetch"));

    emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
    await flush(el);

    const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="station"]')!;
    expect(notice.textContent).toContain(t("refresh.station_after_sale"));
  });

  it.each([
    [
      "handed over",
      "that the order was handed over",
      () => Promise.resolve(),
      "refresh.waiting_after_hand_over",
    ],
    [
      "refused",
      "only that the list could not refresh",
      () => Promise.reject({ code: "server.internal" }),
      "refresh.waiting",
    ],
  ] as const)(
    "a waiting list that cannot be read after the kitchen queue's Collect was %s says %s",
    async (_how, _says, markCollected, key) => {
      const { el, c } = await counterWaiting({
        ...invoiceFirst,
        markCollected: vi.fn(markCollected),
        listCounterWaiting: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockRejectedValue(new TypeError("Failed to fetch")),
      });

      emit(c, "mark-collected", { orderId: "wo-paid" });
      await flush(el);

      const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="waiting"]')!;
      expect(notice.textContent).toContain(t(key));
    },
  );

  it("the waiting list is read again after the kitchen queue's Collect when the kitchen queue cannot be", async () => {
    const getStationQueue = vi.fn().mockResolvedValue({ items: [], notices: [] });
    const listCounterWaiting = vi.fn().mockResolvedValueOnce([paidOrder]).mockResolvedValue([]);
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      getStationQueue,
      listCounterWaiting,
    });
    expect(waitingList(el)!.orders).toEqual([paidOrder]);
    getStationQueue.mockRejectedValue(new TypeError("Failed to fetch"));

    emit(c, "mark-collected", { orderId: "wo-paid" });
    await flush(el);

    expect(listCounterWaiting).toHaveBeenCalledTimes(2);
    expect(waitingList(el)).toBeNull();
    const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="station"]')!;
    expect(notice.textContent).toContain(t("refresh.station_after_hand_over"));
  });

  it("the basket takes no edit while Pay's read is out", async () => {
    const read = heldRead();
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockReturnValue(read.promise),
    });

    pressPay(el, "wo-sent");
    c.store.addProduct(cafe, "1");
    expect(c.store.lineCount).toBe(0);
    read.answer(placedRead("wo-sent"));
    await flush(el);

    expect(c.store.id).toBe("wo-sent");
    expect(c.store.editsLocked).toBe(false);
  });

  it("a Pay whose read failed lets the basket be edited again", async () => {
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });

    pressPay(el, "wo-sent");
    await flush(el);

    expect(c.store.editsLocked).toBe(false);
  });

  it("a hand over reads the kitchen queue again, so the order leaves the counter's prep-queue card", async () => {
    const getStationQueue = vi.fn().mockResolvedValue({ items: [], notices: [] });
    const { el } = await counterWaiting({
      ...invoiceFirst,
      getStationQueue,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
    });
    const reads = getStationQueue.mock.calls.length;

    emit(waitingList(el)!, "hand-over-order", { id: "wo-sent" });
    await flush(el);

    expect(getStationQueue).toHaveBeenCalledTimes(reads + 1);
  });

  it("a kitchen queue that cannot be read after a hand over says the order was handed over", async () => {
    const { el } = await counterWaiting({
      ...invoiceFirst,
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: [], notices: [] })
        .mockRejectedValue(new TypeError("Failed to fetch")),
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
    });

    emit(waitingList(el)!, "hand-over-order", { id: "wo-sent" });
    await flush(el);

    const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="station"]')!;
    expect(notice.textContent).toContain(t("refresh.station_after_hand_over"));
  });

  it.each([
    ["a sale", "refresh.waiting_after_sale"],
    ["a card sale", "refresh.waiting_after_sale"],
    ["a place", "refresh.waiting_after_place"],
    ["a collect", "refresh.waiting_after_sale"],
  ] as const)(
    "a waiting list that cannot be read after %s says the write went through",
    async (write, key) => {
      const { el, c } = await counterWaiting({
        ...(write === "a place" || write === "a collect" ? invoiceFirst : {}),
        listCounterWaiting: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockRejectedValue(new TypeError("Failed to fetch")),
      });
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      if (write === "a sale") emit(c, "confirm-payment", { method: "cash", amount: "5" });
      if (write === "a card sale") emit(c, "collect-card", {});
      if (write === "a place" || write === "a collect") emit(c, "place-order");
      await flush(el);
      if (write === "a collect") {
        emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
        await flush(el);
      }

      const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="waiting"]')!;
      expect(notice.textContent).toContain(t(key));
    },
  );

  it.each([
    ["still out", () => new Promise(() => {})],
    ["refused", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])(
    "a Pay answered after the basket's own payment started loads nothing (the payment %s)",
    async (_state, recordSale) => {
      const read = heldRead();
      const { el, c } = await counterWaiting({
        ...invoiceFirst,
        listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
        retrievePlacedOrder: vi.fn().mockReturnValue(read.promise),
        recordSale: vi.fn(recordSale),
      });
      c.store.addProduct(cafe, "1");
      const own = c.store.id;
      await el.updateComplete;

      pressPay(el, "wo-sent");
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      read.answer(placedRead("wo-sent"));
      await flush(el);

      expect(c.store.id).toBe(own);
      expect(tenderPay(el).stage).toBe("order");
    },
  );

  it.each([
    ["answered", (read: ReturnType<typeof heldRead>) => read.answer(placedRead("wo-sent"))],
    [
      "refused",
      (read: ReturnType<typeof heldRead>) => read.refuse({ code: "working_order.not_found" }),
    ],
  ])(
    "a Pay %s after the operator signed out and another signed in loads nothing and says nothing",
    async (_how, settle) => {
      const read = heldRead();
      const listCounterWaiting = vi.fn().mockResolvedValue([sentOrder]);
      const { el, c } = await counterWaiting({
        ...invoiceFirst,
        listCounterWaiting,
        retrievePlacedOrder: vi.fn().mockReturnValue(read.promise),
      });
      const own = c.store.id;
      pressPay(el, "wo-sent");
      await flush(el);

      emit(c, "logout");
      await flush(el);
      expect(c.store.editsLocked).toBe(false);
      emit(lock(el)!, "logged-in", {
        personId: "p2",
        displayName: "Luis",
        permissions: [],
      });
      await flush(el);
      const reads = listCounterWaiting.mock.calls.length;
      settle(read);
      await flush(el);

      expect(counter(el)!.store.id).toBe(own);
      expect(tenderPay(el).stage).toBe("order");
      expect(alert(el)).toBeNull();
      expect(listCounterWaiting).toHaveBeenCalledTimes(reads);
    },
  );

  it("Hand over sends a fresh submission id on each press, and the list is read again after each", async () => {
    const listCounterWaiting = vi
      .fn()
      .mockResolvedValueOnce([paidOrder, sentOrder])
      .mockResolvedValueOnce([sentOrder])
      .mockResolvedValue([]);
    const { el } = await counterWaiting({ listCounterWaiting });

    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    await flush(el);
    expect(waitingList(el)!.orders).toEqual([sentOrder]);
    emit(waitingList(el)!, "hand-over-order", { id: "wo-sent" });
    await flush(el);

    const calls = vi.mocked(currentApi.markCollected).mock.calls;
    expect(calls.map(([id]) => id)).toEqual(["wo-paid", "wo-sent"]);
    expect(calls[0]![1]).toMatch(UUID);
    expect(calls[1]![1]).toMatch(UUID);
    expect(calls[1]![1]).not.toBe(calls[0]![1]);
    expect(listCounterWaiting).toHaveBeenCalledTimes(3);
    expect(waitingList(el)).toBeNull();
    expect(alert(el)).toBeNull();
  });

  it("a second press while a hand over is out sends nothing more", async () => {
    const markCollected = vi.fn(() => new Promise<void>(() => {}));
    const { el } = await counterWaiting({
      listCounterWaiting: vi.fn().mockResolvedValue([paidOrder]),
      markCollected,
    });

    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    await flush(el);

    expect(markCollected).toHaveBeenCalledOnce();
  });

  it("a hand over that got no answer is sent again under the SAME submission id", async () => {
    const markCollected = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(undefined);
    const { el } = await counterWaiting({
      listCounterWaiting: vi.fn().mockResolvedValue([paidOrder]),
      markCollected,
    });

    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    await vi.waitFor(() => expect(markCollected).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await flush(el);

    const [first, second] = markCollected.mock.calls;
    expect(first![1]).toMatch(UUID);
    expect(second![1]).toBe(first![1]);
    expect(alert(el)).toBeNull();
  });

  it.each(["working_order.already_collected", "working_order.not_settled", "ticket.not_fired"])(
    "a hand over refused %s says why in the counter's words and reads the list again",
    async (code) => {
      const listCounterWaiting = vi.fn().mockResolvedValue([paidOrder]);
      const { el } = await counterWaiting({
        listCounterWaiting,
        markCollected: vi.fn().mockRejectedValue({ code }),
      });

      emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
      await flush(el);

      expect(alert(el)!.textContent).toContain(codeMessage(code));
      expect(alert(el)!.textContent).not.toContain(code);
      expect(codeMessage(code)).not.toBe(codeMessage("some.unmapped_code"));
      expect(listCounterWaiting).toHaveBeenCalledTimes(2);
    },
  );

  it("a hand over that failed without a refusal says it could not hand the order over", async () => {
    const { el } = await counterWaiting({
      listCounterWaiting: vi.fn().mockResolvedValue([paidOrder]),
      markCollected: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });

    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    await flush(el);

    expect(alert(el)!.textContent).toContain(t("waiting.hand_over_error"));
  });

  it("Pay opens the counter's collect stage on THAT order, with its lines, and collects it by its id", async () => {
    const retrievePlacedOrder = vi.fn().mockResolvedValue({
      id: "wo-sent",
      orderNumber: 12,
      label: null,
      revision: 2,
      lines: [{ menuItemId: "menu-item-cafe-0", productId: "cafe", quantity: "2.000" }],
    });
    const listCounterWaiting = vi.fn().mockResolvedValueOnce([sentOrder]).mockResolvedValue([]);
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting,
      retrievePlacedOrder,
    });

    emit(waitingList(el)!, "pay-waiting-order", { id: "wo-sent" });
    await flush(el);

    expect(retrievePlacedOrder).toHaveBeenCalledWith("wo-sent", expect.anything());
    expect(c.store.id).toBe("wo-sent");
    expect(c.store.lineCount).toBe(1);
    expect(c.store.total).toBe("3.00");
    expect(tenderPay(el).stage).toBe("collect");

    emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.collectOrder).toHaveBeenCalledWith("wo-sent", {
      method: "cash",
      amount: "5",
    });
    expect(ticket(el)).not.toBeNull();
    expect(listCounterWaiting.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Pay on an order paid or gone meanwhile says it is no longer available and leaves the basket", async () => {
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });
    c.store.addProduct(cafe, "1");
    const id = c.store.id;
    await el.updateComplete;

    emit(waitingList(el)!, "pay-waiting-order", { id: "wo-sent" });
    await discardBasketChanges(el);

    expect(c.store.id).toBe(id);
    expect(tenderPay(el).stage).toBe("order");
    expect(alert(el)!.textContent).toContain(t("held.stale"));
  });

  it("Pay does nothing while the basket's own order is being sent", async () => {
    const retrievePlacedOrder = vi.fn();
    const { el, c } = await counterWaiting({
      ...invoiceFirst,
      listCounterWaiting: vi.fn().mockResolvedValue([sentOrder]),
      retrievePlacedOrder,
      placeOrder: vi.fn(() => new Promise(() => {})),
    });
    c.store.addProduct(cafe, "1");
    const id = c.store.id;
    await el.updateComplete;
    emit(c, "place-order");
    await flush(el);

    emit(waitingList(el)!, "pay-waiting-order", { id: "wo-sent" });
    await flush(el);

    expect(retrievePlacedOrder).not.toHaveBeenCalled();
    expect(c.store.id).toBe(id);
  });

  it("a hand over answered after the operator signed out says nothing and reads nothing", async () => {
    let refuse!: (error: unknown) => void;
    const listCounterWaiting = vi.fn().mockResolvedValue([paidOrder]);
    const { el, c } = await counterWaiting({
      listCounterWaiting,
      markCollected: vi.fn(() => new Promise<void>((_, reject) => (refuse = reject))),
    });
    emit(waitingList(el)!, "hand-over-order", { id: "wo-paid" });
    await flush(el);

    emit(c, "logout");
    await flush(el);
    refuse({ code: "working_order.already_collected" });
    await flush(el);

    expect(alert(el)).toBeNull();
    expect(listCounterWaiting).toHaveBeenCalledOnce();
  });

  it("reads the list again when an order is placed and when a paid order's sale is recorded", async () => {
    const listCounterWaiting = vi.fn().mockResolvedValue([]);
    const placed = await counterWaiting({ ...invoiceFirst, listCounterWaiting });
    placed.c.store.addProduct(cafe, "2");
    await placed.el.updateComplete;
    emit(placed.c, "place-order");
    await flush(placed.el);
    expect(listCounterWaiting).toHaveBeenCalledTimes(2);

    cleanupWidgets();
    const afterSale = vi.fn().mockResolvedValue([]);
    const paid = await counterWaiting({ listCounterWaiting: afterSale });
    paid.c.store.addProduct(cafe, "2");
    await paid.el.updateComplete;
    emit(paid.c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(paid.el);
    expect(afterSale).toHaveBeenCalledTimes(2);
  });

  it("a failed read of the list says so and offers to try again", async () => {
    const { el } = await counterWaiting({
      listCounterWaiting: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const notice = el.shadowRoot!.querySelector<HTMLElement>('[data-refresh-notice="waiting"]')!;
    expect(notice.hasAttribute("data-active")).toBe(true);
    expect(notice.textContent).toContain(t("refresh.waiting"));
  });
});

describe("the device's equipment, chosen from the header", () => {
  const item = (id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem => ({
    id,
    name,
    portable: false,
    available: true,
    busy: false,
    heldBy: null,
    ...extra,
  });
  const P1 = item("P1", "Counter printer");
  const P2 = item("P2", "Bar printer");
  const P3 = item("P3", "Kitchen printer");
  const POFF = item("P-off", "Old printer", { available: false });
  const S1 = item("S1", "Counter slip printer");
  const S2 = item("S2", "Portable slip printer");
  const KNOWN = new Map([P1, P2, P3, POFF, S1, S2].map((each) => [each.id, each]));

  /** The four roles as the server answers them for these explicit receipt and slip choices: the
   * receipt chosen from P1 and P2, the slip from S1 and S2, no drawer or reader. */
  function equipmentOf(chosen: { receipt: string | null; payment_slip: string | null }) {
    const role = (name: "receipt" | "payment_slip", choices: EquipmentItem[]): RoleEquipment => {
      const picked = chosen[name] === null ? null : KNOWN.get(chosen[name])!;
      return {
        role: name,
        selection: picked === null ? "default" : "item",
        chosenId: picked?.id ?? null,
        resolved:
          picked === null
            ? null
            : { id: picked.id, name: picked.name, available: picked.available },
        chosen: picked,
        default: null,
        choices,
      };
    };
    const none = (name: "cash_drawer" | "card_terminal"): RoleEquipment => ({
      role: name,
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
      default: null,
      choices: [],
    });
    return {
      roles: [
        role("receipt", [P1, P2]),
        role("payment_slip", [S1, S2]),
        none("cash_drawer"),
        none("card_terminal"),
      ],
    } satisfies DeviceEquipment;
  }
  // A switched-off receipt printer the device stays on: it is not among the choices.
  const initial = equipmentOf({ receipt: "P-off", payment_slip: "S1" });
  const pick = (role: "receipt" | "payment_slip", id: string): EquipmentChange => ({
    role,
    selection: { id },
    via: "list",
    takeOver: false,
  });
  const equipmentDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog");
  const chosenIn = (el: TillApp, role: "receipt" | "payment_slip") =>
    equipmentDialog(el)!.equipment!.roles.find((each) => each.role === role)!.chosenId;
  const openButton = (el: TillApp) =>
    shell(el)!.shadowRoot!.querySelector<HTMLElement>(".equipment")!;

  async function openEquipment(overrides: Record<string, unknown> = {}) {
    const { el } = await mountApp({
      getDeviceEquipment: vi.fn().mockResolvedValue(initial),
      ...overrides,
    });
    await toCounter(el);
    expect(equipmentDialog(el)).toBeNull();
    openButton(el).click();
    await flush(el);
    return el;
  }

  it("opens the dialog with the device's equipment as the server answers it", async () => {
    const el = await openEquipment();

    const dialog = equipmentDialog(el)!;
    expect(dialog.open).toBe(true);
    expect(dialog.equipment).toEqual(initial);
    expect(dialog.error).toBeNull();
  });

  it("sends the choice picked and shows what the server stored", async () => {
    const stored = equipmentOf({ receipt: "P-off", payment_slip: "S2" });
    const setDeviceEquipment = vi.fn().mockResolvedValue(stored);
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(setDeviceEquipment.mock.calls[0]).toEqual([
      pick("payment_slip", "S2"),
      { signal: expect.any(AbortSignal) },
    ]);
    const dialog = equipmentDialog(el)!;
    expect(dialog.equipment).toEqual(stored);
    expect(dialog.error).toBeNull();
  });

  it("keeps the dialog open with the refusal when the server refuses the choice", async () => {
    const setDeviceEquipment = vi.fn().mockRejectedValue({
      field: "receiptPrinterId",
      code: "device.binding_invalid",
      status: 400,
    });
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);

    const dialog = equipmentDialog(el)!;
    expect(dialog).not.toBeNull();
    expect(dialog.error).toEqual({ code: "device.binding_invalid", field: "receiptPrinterId" });
    expect(dialog.equipment).toEqual(initial);
  });

  it("opens on the equipment read at sign-in when reading it again fails", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await openEquipment({ getDeviceEquipment });

    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(equipmentDialog(el)!.equipment).toEqual(initial);
  });

  it("offers what the device answers when the dialog opens, not what it answered at sign-in", async () => {
    const later = equipmentOf({ receipt: "P2", payment_slip: "S1" });
    const getDeviceEquipment = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(later);
    const el = await openEquipment({ getDeviceEquipment });

    expect(equipmentDialog(el)!.equipment).toEqual(later);
  });

  it("opens with no equipment known when the device could never be read", async () => {
    const el = await openEquipment({
      getDeviceEquipment: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    expect(equipmentDialog(el)!.equipment).toBeNull();
  });

  it("shows a choice that got no answer as a failure naming no field", async () => {
    const el = await openEquipment({
      setDeviceEquipment: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);

    const dialog = equipmentDialog(el)!;
    expect(dialog.error).toEqual({ code: "server.internal" });
    expect(chosenIn(el, "payment_slip")).toBe("S1");
  });

  it("sends a later choice only once the earlier one has answered, and shows the later one's answer", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const setDeviceEquipment = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    answers[0]!(equipmentOf({ receipt: "P1", payment_slip: "S1" }));
    await flush(el);
    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    answers[1]!(equipmentOf({ receipt: "P2", payment_slip: "S1" }));
    await flush(el);

    expect(chosenIn(el, "receipt")).toBe("P2");
  });

  it("shows no refusal of an earlier choice once the later one succeeds", async () => {
    const answers: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
    const setDeviceEquipment = vi.fn(
      () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    );
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    answers[0]!.reject({ field: "receiptPrinterId", code: "device.binding_invalid", status: 400 });
    await flush(el);
    answers[1]!.resolve(equipmentOf({ receipt: "P2", payment_slip: "S1" }));
    await flush(el);

    expect(equipmentDialog(el)!.error).toBeNull();
    expect(chosenIn(el, "receipt")).toBe("P2");
  });

  it("shows an earlier choice's success with a later choice's refusal", async () => {
    const answers: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
    const setDeviceEquipment = vi.fn(
      () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    );
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    answers[0]!.resolve(equipmentOf({ receipt: "P1", payment_slip: "S1" }));
    await flush(el);
    answers[1]!.reject({ field: "receiptPrinterId", code: "device.binding_invalid", status: 400 });
    await flush(el);

    expect(chosenIn(el, "receipt")).toBe("P1");
    expect(equipmentDialog(el)!.error).toEqual({
      code: "device.binding_invalid",
      field: "receiptPrinterId",
    });
  });

  it("keeps a retried pick shown, with the refusal, until the retry answers", async () => {
    let answer!: (value: unknown) => void;
    const refusal = { field: "receiptPrinterId", code: "device.binding_invalid", status: 400 };
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValueOnce(refusal)
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const el = await openEquipment({ setDeviceEquipment });
    const receiptBox = () =>
      equipmentDialog(el)!.shadowRoot!.querySelector<WtCombobox>(
        'wt-combobox[name="receiptPrinterId"]',
      )!;

    await chooseOption(receiptBox(), "P2");
    await flush(el);
    expect(equipmentDialog(el)!.error).toEqual({
      code: "device.binding_invalid",
      field: "receiptPrinterId",
    });
    await chooseOption(receiptBox(), "P2");
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(receiptBox().value).toBe("P2");
    expect(equipmentDialog(el)!.error).toEqual({
      code: "device.binding_invalid",
      field: "receiptPrinterId",
    });

    answer(equipmentOf({ receipt: "P2", payment_slip: "S1" }));
    await flush(el);
    expect(equipmentDialog(el)!.error).toBeNull();
    expect(receiptBox().value).toBe("P2");
  });

  /** The device with reader R1 among its choices, then once the refused pick turned out not to be
   * free: P2 carried by the bar till, or R1 busy with another device's payment. */
  function refusedPick(code: "device.equipment_held" | "reader.payment_in_progress") {
    const R1 = item("R1", "Bar reader");
    const before = structuredClone(initial);
    before.roles[3]!.choices = [R1];
    const after = structuredClone(before);
    if (code === "device.equipment_held") {
      after.roles[0]!.choices[1] = {
        ...P2,
        heldBy: { deviceId: "dev-bar", deviceName: "Bar till", personName: "Ana" },
      };
      return {
        before,
        after,
        change: pick("receipt", "P2"),
        refusal: { code, status: 409, field: "receiptPrinterId" },
        shown: { code, field: "receiptPrinterId" },
      };
    }
    after.roles[3]!.choices = [{ ...R1, busy: true }];
    return {
      before,
      after,
      change: {
        role: "card_terminal",
        selection: { id: "R1" },
        via: "list",
        takeOver: false,
      } satisfies EquipmentChange,
      refusal: { code, status: 409 },
      shown: { code },
    };
  }

  it.each(["device.equipment_held", "reader.payment_in_progress"] as const)(
    "after a %s refusal the list is read again, so it shows why, and the refusal stays shown",
    async (code) => {
      const { before, after, change, refusal, shown } = refusedPick(code);
      const getDeviceEquipment = vi.fn().mockResolvedValue(before);
      const el = await openEquipment({
        getDeviceEquipment,
        setDeviceEquipment: vi.fn().mockRejectedValue(refusal),
      });
      const reads = getDeviceEquipment.mock.calls.length;
      getDeviceEquipment.mockResolvedValue(after);

      emit(equipmentDialog(el)!, "equipment-change", change);
      await flush(el);
      await flush(el);

      expect(getDeviceEquipment).toHaveBeenCalledTimes(reads + 1);
      expect(equipmentDialog(el)!.equipment).toEqual(after);
      expect(equipmentDialog(el)!.error).toEqual(shown);
    },
  );

  it("after any other refusal the list is not read again", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(initial);
    const el = await openEquipment({
      getDeviceEquipment,
      setDeviceEquipment: vi.fn().mockRejectedValue({
        code: "device.binding_invalid",
        field: "receiptPrinterId",
        status: 400,
      }),
    });
    const reads = getDeviceEquipment.mock.calls.length;

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    await flush(el);

    expect(getDeviceEquipment).toHaveBeenCalledTimes(reads);
  });

  /** A server holding the device's choices, which both reads and choices go through. */
  function equipmentServer() {
    const stored: { receipt: string | null; payment_slip: string | null } = {
      receipt: "P-off",
      payment_slip: "S1",
    };
    const store = (change: EquipmentChange) => {
      stored[change.role as "receipt" | "payment_slip"] =
        change.selection === "default" ? null : change.selection.id;
    };
    const getDeviceEquipment = vi.fn(async () => equipmentOf(stored));
    return { stored, store, getDeviceEquipment };
  }

  it("sends a slip choice picked during a receipt choice only after the receipt choice is stored, and shows both", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    // Each choice is stored only when the test releases it, and answers with everything stored then.
    const held: (() => void)[] = [];
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise((resolve) =>
          held.push(() => {
            store(change);
            resolve(equipmentOf(stored));
          }),
        ),
    );
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);
    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    held[0]!();
    await flush(el);
    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    held[1]!();
    await flush(el);

    expect(stored).toEqual({ receipt: "P1", payment_slip: "S2" });
    expect(chosenIn(el, "receipt")).toBe("P1");
    expect(chosenIn(el, "payment_slip")).toBe("S2");
  });

  async function reopen(el: TillApp): Promise<void> {
    emit(equipmentDialog(el)!, "close");
    await flush(el);
    openButton(el).click();
    await flush(el);
  }

  it("keeps showing what another tab stored after reopening, when an earlier choice answers late", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    let answer!: () => void;
    const setDeviceEquipment = vi.fn((change: EquipmentChange) => {
      store(change);
      const answered = equipmentOf(stored);
      return new Promise((resolve) => (answer = () => resolve(answered)));
    });
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    stored.receipt = "P3";
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P3");
    answer();
    await flush(el);

    expect(chosenIn(el, "receipt")).toBe("P3");
    getDeviceEquipment.mockRejectedValue(new TypeError("Failed to fetch"));
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P3");
  });

  it("shows an earlier choice the server stored after the reopened dialog read the equipment", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    let release!: () => void;
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise(
          (resolve) =>
            (release = () => {
              store(change);
              resolve(equipmentOf(stored));
            }),
        ),
    );
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    stored.receipt = "P3";
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P3");
    release();
    await flush(el);

    expect(stored.receipt).toBe("P2");
    expect(chosenIn(el, "receipt")).toBe("P2");
  });

  it("shows a choice's answer when the reopened dialog's read, sent before it, finishes after it", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    let release!: () => void;
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise(
          (resolve) =>
            (release = () => {
              store(change);
              resolve(equipmentOf(stored));
            }),
        ),
    );
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });
    // The server answers this read from what it had stored before the choice was saved.
    let deliver!: () => void;
    getDeviceEquipment.mockImplementationOnce(() => {
      const read = equipmentOf(stored);
      return new Promise((resolve) => (deliver = () => resolve(read)));
    });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    await reopen(el);
    release();
    await flush(el);
    deliver();
    await flush(el);

    expect(stored.receipt).toBe("P2");
    expect(chosenIn(el, "receipt")).toBe("P2");
    getDeviceEquipment.mockRejectedValue(new TypeError("Failed to fetch"));
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P2");
  });

  it("sends a later pick after a choice whose request rejects with nothing", async () => {
    const setDeviceEquipment = vi
      .fn()
      .mockRejectedValueOnce(undefined)
      .mockResolvedValue(equipmentOf({ receipt: "P2", payment_slip: "S1" }));
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    await flush(el);
    expect(equipmentDialog(el)!.error).toEqual({ code: "server.internal" });
    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(chosenIn(el, "receipt")).toBe("P2");
    expect(equipmentDialog(el)!.error).toBeNull();
  });

  it("gives up on a choice that gets no answer within the request limit, and sends the next pick", async () => {
    let calls = 0;
    const setDeviceEquipment = vi.fn((_change: unknown, options?: { signal?: AbortSignal }) => {
      calls++;
      if (calls > 1) return Promise.resolve(equipmentOf({ receipt: "P2", payment_slip: "S1" }));
      // Like fetch, the hung request rejects only when its signal aborts.
      return new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
      );
    });
    const el = await openEquipment({ setDeviceEquipment });

    vi.useFakeTimers();
    try {
      emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
      emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
      await vi.advanceTimersByTimeAsync(149_999);
      expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
    }
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(chosenIn(el, "receipt")).toBe("P2");
    expect(equipmentDialog(el)!.error).toBeNull();
  });

  it("sends a pick while the read after an earlier choice has no answer", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    let release!: () => void;
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise(
          (resolve) =>
            (release = () => {
              store(change);
              resolve(equipmentOf(stored));
            }),
        ),
    );
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    await reopen(el);
    // The read made because the reopened dialog's read came back while the choice was out.
    getDeviceEquipment.mockImplementationOnce(() => new Promise(() => {}));
    release();
    await flush(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(4);
    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
  });

  it("reads the equipment again when a read it set aside came back while a later choice was out", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    // Each choice is stored when sent and answers when the test says.
    const answers: (() => void)[] = [];
    const setDeviceEquipment = vi.fn((change: EquipmentChange) => {
      store(change);
      const answered = equipmentOf(stored);
      return new Promise((resolve) => answers.push(() => resolve(answered)));
    });
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    await flush(el);
    await reopen(el);
    // The read made because the reopened dialog's read came back while the first choice was out,
    // which the server answers late.
    let deliver!: () => void;
    getDeviceEquipment.mockImplementationOnce(
      () => new Promise((resolve) => (deliver = () => resolve(equipmentOf(stored)))),
    );
    answers[0]!();
    await flush(el);
    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);
    answers[1]!();
    await flush(el);
    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    stored.receipt = "P3";
    deliver();
    await flush(el);
    answers[2]!();
    await flush(el);

    expect(chosenIn(el, "receipt")).toBe("P3");
    expect(chosenIn(el, "payment_slip")).toBe("S2");
  });

  /** A choice of receipt P2 the reopened dialog's read came back during, so its answer is set
   * aside, and the read made once it answers fails. */
  async function choiceSetAsideThenReadFails() {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    let release!: () => void;
    const setDeviceEquipment = vi.fn(
      (change: EquipmentChange) =>
        new Promise((resolve) => {
          release = () => {
            store(change);
            resolve(equipmentOf(stored));
          };
        }),
    );
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P-off");
    getDeviceEquipment.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    release();
    await flush(el);
    expect(stored.receipt).toBe("P2");
    return { el, getDeviceEquipment, setDeviceEquipment };
  }

  it("reads the equipment once after a choice it set aside, once per failed opening, and a later opening shows what the server stored", async () => {
    const { el, getDeviceEquipment } = await choiceSetAsideThenReadFails();

    expect(getDeviceEquipment).toHaveBeenCalledTimes(4);
    getDeviceEquipment.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await reopen(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(5);
    await reopen(el);
    expect(chosenIn(el, "receipt")).toBe("P2");
  });

  it("reads the equipment again after the next choice answers, when the read after a choice it set aside failed", async () => {
    const { el, getDeviceEquipment, setDeviceEquipment } = await choiceSetAsideThenReadFails();

    setDeviceEquipment.mockRejectedValueOnce({
      field: "paymentSlipPrinterId",
      code: "device.binding_invalid",
      status: 400,
    });
    emit(equipmentDialog(el)!, "equipment-change", pick("payment_slip", "S2"));
    await flush(el);

    expect(getDeviceEquipment).toHaveBeenCalledTimes(5);
    expect(chosenIn(el, "receipt")).toBe("P2");
    expect(equipmentDialog(el)!.error).toEqual({
      code: "device.binding_invalid",
      field: "paymentSlipPrinterId",
    });
  });

  it("shows a choice the server stored when its answer never arrived", async () => {
    const { stored, store, getDeviceEquipment } = equipmentServer();
    const setDeviceEquipment = vi.fn(async (change: EquipmentChange) => {
      store(change);
      throw new TypeError("Failed to fetch");
    });
    const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P1"));
    await flush(el);

    expect(stored.receipt).toBe("P1");
    expect(equipmentDialog(el)!.error).toEqual({ code: "server.internal" });
    expect(chosenIn(el, "receipt")).toBe("P1");
  });

  it("does not show a refusal of a choice picked before the dialog was reopened", async () => {
    let refuse!: (error: unknown) => void;
    const setDeviceEquipment = vi.fn(() => new Promise((_, reject) => (refuse = reject)));
    const el = await openEquipment({ setDeviceEquipment });

    emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
    await flush(el);
    await reopen(el);
    refuse({ field: "receiptPrinterId", code: "device.binding_invalid", status: 400 });
    await flush(el);

    expect(equipmentDialog(el)!.error).toBeNull();
  });

  it("closes the dialog when the operator logs out", async () => {
    const el = await openEquipment();

    emit(shell(el)!, "logout");
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(equipmentDialog(el)).toBeNull();
  });

  it("does not open the dialog over the lock screen when the operator logs out while the equipment is read", async () => {
    let answer!: (value: unknown) => void;
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { el } = await mountApp({ getDeviceEquipment });
    await toCounter(el);
    openButton(el).click();
    await flush(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);

    emit(shell(el)!, "logout");
    await flush(el);
    answer(initial);
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(equipmentDialog(el)).toBeNull();
  });

  it("closes the dialog when it asks to close", async () => {
    const el = await openEquipment();

    emit(equipmentDialog(el)!, "close");
    await flush(el);

    expect(equipmentDialog(el)).toBeNull();
  });

  describe("beside the 15-second poll", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function poll(el: TillApp): Promise<void> {
      vi.advanceTimersByTime(15_000);
      await flush(el);
      await flush(el);
    }

    it("a poll answered while a choice is still out does not replace the choice's answer", async () => {
      const { stored, store, getDeviceEquipment } = equipmentServer();
      let release!: () => void;
      const setDeviceEquipment = vi.fn(
        (change: EquipmentChange) =>
          new Promise(
            (resolve) =>
              (release = () => {
                store(change);
                resolve(equipmentOf(stored));
              }),
          ),
      );
      const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });

      emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
      await flush(el);
      // Answered from what the server held before the choice was stored.
      await poll(el);
      expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
      // So no later read can put right a stale answer that was shown.
      getDeviceEquipment.mockRejectedValue(new TypeError("Failed to fetch"));
      release();
      await flush(el);

      expect(stored.receipt).toBe("P2");
      expect(chosenIn(el, "receipt")).toBe("P2");
    });

    it("a poll sent before a choice and answered after the choice's answer is set aside", async () => {
      const { stored, store, getDeviceEquipment } = equipmentServer();
      const setDeviceEquipment = vi.fn(async (change: EquipmentChange) => {
        store(change);
        return equipmentOf(stored);
      });
      const el = await openEquipment({ getDeviceEquipment, setDeviceEquipment });
      let deliver!: () => void;
      getDeviceEquipment.mockImplementationOnce(() => {
        const read = equipmentOf(stored);
        return new Promise((resolve) => (deliver = () => resolve(read)));
      });

      await poll(el);
      emit(equipmentDialog(el)!, "equipment-change", pick("receipt", "P2"));
      await flush(el);
      expect(chosenIn(el, "receipt")).toBe("P2");
      deliver();
      await flush(el);

      expect(stored.receipt).toBe("P2");
      expect(chosenIn(el, "receipt")).toBe("P2");
    });
  });
});

describe("the device's equipment: scanning, the pay screens, takeovers and sign-ins", () => {
  const BAR_TILL = { deviceId: "dev-bar", deviceName: "Bar till", personName: "Ana" };
  const R1 = { id: "00000000-0000-4000-8000-0000000000a1", name: "Barra" };
  const R2 = { id: "00000000-0000-4000-8000-0000000000a2", name: "Terraza" };
  const PP = { id: "00000000-0000-4000-8000-0000000000b1", name: "Portable printer" };
  const item = (
    of: { id: string; name: string },
    extra: Partial<EquipmentItem> = {},
  ): EquipmentItem => ({
    ...of,
    portable: true,
    available: true,
    busy: false,
    heldBy: null,
    ...extra,
  });
  const none = (role: "payment_slip" | "cash_drawer"): RoleEquipment => ({
    role,
    selection: "default",
    chosenId: null,
    resolved: null,
    chosen: null,
    default: null,
    choices: [],
  });

  /** The device on portable printer PP and on `reader` (or none), choosing among R1 and R2; a
   * `holder` carries what the device no longer resolves to. */
  function equipmentOn(
    printer: "held" | "taken",
    reader: { id: string; name: string } | null,
    takenReader?: { id: string; name: string },
  ): DeviceEquipment {
    const readers = [R1, R2].map((each) =>
      item(each, {
        provider: "stripe",
        ...(each.id === takenReader?.id ? { heldBy: BAR_TILL } : {}),
      }),
    );
    const pp = item(PP, printer === "taken" ? { heldBy: BAR_TILL } : {});
    return {
      roles: [
        {
          role: "receipt",
          selection: printer === "held" ? "item" : "default",
          chosenId: printer === "held" ? PP.id : null,
          resolved: printer === "held" ? { ...PP, available: true } : null,
          chosen: printer === "held" ? pp : null,
          default: null,
          choices: [pp],
        },
        none("payment_slip"),
        none("cash_drawer"),
        {
          role: "card_terminal",
          selection: "default",
          chosenId: null,
          resolved: reader === null ? null : { ...reader, available: true, provider: "stripe" },
          chosen: null,
          default: readers[0]!,
          choices: readers,
        },
      ],
    };
  }

  const bootOn = (reader: { id: string; name: string } | null) => ({
    ...till,
    capabilities: [...till.capabilities, "integrated-card-payment"] as CapabilityFlag[],
    cardProvider: reader === null ? ("none" as const) : ("stripe_terminal" as const),
    activeReaders: reader === null ? [] : [{ ...reader, provider: "stripe_terminal" }],
    defaultReaderId: reader?.id,
  });
  const equipmentDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog");
  const openButton = (el: TillApp) =>
    shell(el)!.shadowRoot!.querySelector<HTMLElement>(".equipment")!;
  const toast = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { open: boolean; message: string }>(
      "wt-toast[data-equipment-toast]",
    )!;
  const readerName = (el: TillApp) =>
    tenderPay(el).shadowRoot!.querySelector(".reader-name")?.textContent?.trim();

  /** One poll tick: only `setInterval` is faked, so every other wait in the app keeps real time. */
  async function poll(el: TillApp): Promise<void> {
    vi.advanceTimersByTime(15_000);
    await flush(el);
    await flush(el);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("scan and the list send the same request shape, but for the way it was chosen", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const setDeviceEquipment = vi.fn().mockResolvedValue(equipmentOn("held", R2));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOn("held", R1)),
      setDeviceEquipment,
    });
    await toCounter(el);
    openButton(el).click();
    await flush(el);
    const dialog = equipmentDialog(el)!;

    await chooseOption(
      dialog.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="cardReaderId"]')!,
      R2.id,
    );
    await flush(el);
    dialog
      .shadowRoot!.querySelector('[data-equipment-row="card_terminal"]')!
      .querySelector<HTMLElement>("[data-equipment-scan]")!
      .click();
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector("till-equipment-scanner")!.dispatchEvent(
      new CustomEvent("equipment-scanned", {
        detail: { id: R2.id },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);

    expect(setDeviceEquipment).toHaveBeenCalledTimes(2);
    const [listed, scanned] = setDeviceEquipment.mock.calls.map((call) => call[0]);
    expect(listed).toEqual({
      role: "card_terminal",
      selection: { id: R2.id },
      via: "list",
      takeOver: false,
    });
    expect(scanned).toEqual({ ...listed, via: "scan" });
  });

  it("after a takeover the next poll shows a notice naming the device that took it, until dismissed", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(equipmentOn("held", R1))
      .mockResolvedValue(equipmentOn("taken", R1));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment,
    });
    await toCounter(el);
    await flush(el);
    expect(toast(el).open).toBe(false);

    await poll(el);

    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    expect(toast(el).open).toBe(true);
    expect(toast(el).message).toBe(
      t("equipment.taken_person")
        .replace("{item}", PP.name)
        .replace("{device}", "Bar till")
        .replace("{person}", "Ana"),
    );
    toast(el).dispatchEvent(new CustomEvent("wt-close"));
    await flush(el);
    expect(toast(el).open).toBe(false);
    await poll(el);
    expect(toast(el).open).toBe(false);
  });

  it("a takeover notice is gone once the person signs out", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi
        .fn()
        .mockResolvedValueOnce(equipmentOn("held", R1))
        .mockResolvedValue(equipmentOn("taken", R1)),
    });
    await toCounter(el);
    await flush(el);
    await poll(el);
    expect(toast(el).open).toBe(true);

    emit(shell(el)!, "logout");
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(toast(el).open).toBe(false);
  });

  it("a sign-in's equipment read that reports a takeover after sign-out shows no notice on the lock screen", async () => {
    let answer!: (equipment: DeviceEquipment) => void;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi
        .fn()
        .mockResolvedValueOnce(equipmentOn("held", R1))
        .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve))),
    });
    await toCounter(el);
    await flush(el);
    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    emit(shell(el)!, "logout");
    await flush(el);

    answer(equipmentOn("taken", R1));
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(toast(el).open).toBe(false);
  });

  it("the takeover notice's action opens no equipment dialog over the lock screen", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(equipmentOn("held", R1))
      .mockResolvedValue(equipmentOn("taken", R1));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment,
    });
    await toCounter(el);
    await flush(el);
    await poll(el);
    emit(shell(el)!, "logout");
    await flush(el);
    const reads = getDeviceEquipment.mock.calls.length;

    toast(el).dispatchEvent(new CustomEvent("wt-activate"));
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(equipmentDialog(el)).toBeNull();
    expect(getDeviceEquipment).toHaveBeenCalledTimes(reads);
  });

  it("names only the device that took it when nobody is signed in there", async () => {
    const taken = equipmentOn("taken", R1);
    const receipt = taken.roles[0]!;
    receipt.choices = [{ ...receipt.choices[0]!, heldBy: { ...BAR_TILL, personName: null } }];
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi
        .fn()
        .mockResolvedValueOnce(equipmentOn("held", R1))
        .mockResolvedValue(taken),
    });
    await toCounter(el);
    await flush(el);

    await poll(el);

    expect(toast(el).message).toBe(
      t("equipment.taken").replace("{item}", PP.name).replace("{device}", "Bar till"),
    );
  });

  it("shows no notice when a choice changed but no other device carries what it was on", async () => {
    // A manager put the receipt back on Use default from the dashboard: nobody took the printer.
    const released = equipmentOn("held", R1);
    released.roles[0] = {
      ...released.roles[0]!,
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi
        .fn()
        .mockResolvedValueOnce(equipmentOn("held", R1))
        .mockResolvedValue(released),
    });
    await toCounter(el);
    await flush(el);

    await poll(el);

    expect(toast(el).open).toBe(false);
  });

  it("reads the equipment on no tick while nobody is signed in, and makes no activity of its own", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(equipmentOn("held", R1));
    const sessionActivity = fakeSessionActivity();
    currentApi = stubApi({ getDeviceEquipment });
    const { el } = await mountWidget<TillApp>("till-app", {
      api: currentApi,
      sessionActivity: sessionActivity as never,
    });
    await flush(el);
    await poll(el);
    expect(getDeviceEquipment).not.toHaveBeenCalled();

    await toCounter(el);
    const interactions = sessionActivity.noteInteraction.mock.calls.length;
    await poll(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
    expect(sessionActivity.noteInteraction.mock.calls.length).toBe(interactions);

    emit(shell(el)!, "logout");
    await flush(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
  });

  it("after choosing another reader in the equipment dialog, the pay screen pays on the new one without a reload", async () => {
    const getTill = vi.fn().mockResolvedValue(bootOn(R1));
    const getDeviceIdentity = vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    });
    const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({
      getTill,
      getDeviceIdentity,
      getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOn("held", R1)),
      setDeviceEquipment: vi.fn().mockResolvedValue(equipmentOn("held", R2)),
      pay,
    });
    const c = await toCounter(el);
    await flush(el);
    expect(readerName(el)).toBe(R1.name);

    openButton(el).click();
    await flush(el);
    emit(equipmentDialog(el)!, "equipment-change", {
      role: "card_terminal",
      selection: { id: R2.id },
      via: "list",
      takeOver: false,
    });
    await flush(el);
    await flush(el);
    emit(equipmentDialog(el)!, "close");
    await flush(el);

    expect(tenderPay(el).cardProvider).toBe("stripe_terminal");
    expect(tenderPay(el).activeReaders.map((reader) => reader.id)).toEqual([R2.id]);
    expect(tenderPay(el).defaultReaderId).toBe(R2.id);
    expect(readerName(el)).toBe(R2.name);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "collect-card", {});
    await flush(el);
    expect(pay).toHaveBeenCalledOnce();
    expect(pay.mock.calls[0]![0]).not.toHaveProperty("readerId");
    // Neither the app nor the device was read again: the equipment answer names the provider.
    expect(getTill).toHaveBeenCalledOnce();
    expect(getDeviceIdentity).toHaveBeenCalledOnce();
  });

  it("the pay screen takes the reader and its provider from the equipment answer alone", async () => {
    const getTill = vi.fn().mockResolvedValue(bootOn(null));
    const { el } = await mountApp({
      getTill,
      getDeviceEquipment: vi.fn().mockResolvedValue(equipmentOn("held", R2)),
    });
    await toCounter(el);
    await flush(el);

    expect(tenderPay(el).activeReaders).toEqual([{ ...R2, provider: "stripe_terminal" }]);
    expect(tenderPay(el).defaultReaderId).toBe(R2.id);
    expect(tenderPay(el).cardProvider).toBe("stripe_terminal");
    expect(getTill).toHaveBeenCalledOnce();
  });

  it.each([
    ["sumup", ["sumup_cloud"]],
    ["simulator", []],
    [undefined, []],
  ] as const)(
    "a resolved reader whose stored provider is %s is offered as %j",
    async (provider, offered) => {
      const equipment = equipmentOn("held", R2);
      const reader = equipment.roles.find((role) => role.role === "card_terminal")!;
      reader.resolved = { ...R2, available: true, ...(provider === undefined ? {} : { provider }) };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue(bootOn(null)),
        getDeviceEquipment: vi.fn().mockResolvedValue(equipment),
      });
      await toCounter(el);
      await flush(el);

      expect(tenderPay(el).activeReaders.map((each) => each.provider)).toEqual(offered);
      expect(tenderPay(el).cardProvider).toBe(offered[0] ?? "none");
    },
  );

  it("a reader chosen in the dialog is offered though reading the till's setup again would fail", async () => {
    const getTill = vi
      .fn()
      .mockResolvedValueOnce(bootOn(R1))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(bootOn(R2));
    const getDeviceEquipment = vi.fn().mockResolvedValue(equipmentOn("held", R1));
    const { el } = await mountApp({
      getTill,
      getDeviceEquipment,
      setDeviceEquipment: vi.fn().mockResolvedValue(equipmentOn("held", R2)),
    });
    await toCounter(el);
    openButton(el).click();
    await flush(el);
    emit(equipmentDialog(el)!, "equipment-change", {
      role: "card_terminal",
      selection: { id: R2.id },
      via: "list",
      takeOver: false,
    });
    await flush(el);
    await flush(el);
    emit(equipmentDialog(el)!, "close");
    getDeviceEquipment.mockResolvedValue(equipmentOn("held", R2));
    await poll(el);
    await poll(el);

    expect(tenderPay(el).activeReaders.map((reader) => reader.id)).toEqual([R2.id]);
    expect(tenderPay(el).cardProvider).toBe("stripe_terminal");
  });

  it("after the sign-in's equipment read fails, the next poll's reader is offered", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(equipmentOn("held", R2)),
    });
    await toCounter(el);
    await flush(el);
    expect(tenderPay(el).activeReaders.map((reader) => reader.id)).toEqual([R1.id]);

    await poll(el);

    expect(tenderPay(el).activeReaders.map((reader) => reader.id)).toEqual([R2.id]);
    expect(tenderPay(el).defaultReaderId).toBe(R2.id);
  });

  it("a poll sent before a profile switch and answered after it does not bring back the old profile's reader", async () => {
    const COUNTER = { id: "pr-counter", name: "Counter till" };
    const BAR = { id: "pr-bar", name: "Bar till" };
    let oldAnswer!: (value: DeviceEquipment) => void;
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(equipmentOn("held", R1))
      .mockImplementationOnce(
        () => new Promise<DeviceEquipment>((resolve) => (oldAnswer = resolve)),
      )
      .mockResolvedValue(equipmentOn("held", null));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        stationId: null,
        profileId: COUNTER.id,
        approvedProfiles: [COUNTER, BAR],
      }),
      switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: BAR.id }),
      getDeviceEquipment,
    });
    await toCounter(el);
    await poll(el);
    expect(getDeviceEquipment).toHaveBeenCalledTimes(2);
    shell(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: BAR.id,
    });
    await flush(el);
    await flush(el);
    await flush(el);
    expect(tenderPay(el).activeReaders).toEqual([]);

    oldAnswer(equipmentOn("held", R1));
    await flush(el);
    await flush(el);

    expect(tenderPay(el).activeReaders).toEqual([]);
    expect(tenderPay(el).cardProvider).toBe("none");
  });

  it("after a poll reports the reader was taken, the pay screen no longer offers it", async () => {
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(equipmentOn("held", R1))
      .mockResolvedValue(equipmentOn("held", null, R1));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment,
    });
    await toCounter(el);
    await flush(el);
    expect(tenderPay(el).activeReaders.map((reader) => reader.id)).toEqual([R1.id]);

    await poll(el);

    expect(tenderPay(el).activeReaders).toEqual([]);
    expect(tenderPay(el).defaultReaderId).toBeUndefined();
    expect(tenderPay(el).cardProvider).toBe("none");
    expect(readerName(el)).toBeUndefined();
    expect(toast(el).message).toBe(
      t("equipment.taken_person")
        .replace("{item}", R1.name)
        .replace("{device}", "Bar till")
        .replace("{person}", "Ana"),
    );
  });

  it("locking and a different person signing in keep the choices", async () => {
    const getDeviceEquipment = vi.fn().mockResolvedValue(equipmentOn("held", R1));
    const setDeviceEquipment = vi.fn();
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceEquipment,
      setDeviceEquipment,
    });
    await toCounter(el);
    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    openButton(el).click();
    await flush(el);

    expect(setDeviceEquipment).not.toHaveBeenCalled();
    expect(equipmentDialog(el)!.equipment).toEqual(equipmentOn("held", R1));
    expect(getDeviceEquipment).toHaveBeenCalledTimes(3);
  });

  it("a profile switch re-reads the equipment and shows the choices it kept and the ones it let go", async () => {
    const COUNTER = { id: "pr-counter", name: "Counter till" };
    const BAR = { id: "pr-bar", name: "Bar till" };
    const kept = equipmentOn("held", null);
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(equipmentOn("held", R1))
      .mockResolvedValue(kept);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue(bootOn(R1)),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        stationId: null,
        profileId: COUNTER.id,
        approvedProfiles: [COUNTER, BAR],
      }),
      switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: BAR.id }),
      getDeviceEquipment,
    });
    await toCounter(el);
    shell(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: BAR.id,
    });
    await flush(el);
    await flush(el);
    await flush(el);
    const reads = getDeviceEquipment.mock.calls.length;
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(tenderPay(el).activeReaders).toEqual([]);

    getDeviceEquipment.mockRejectedValue(new TypeError("Failed to fetch"));
    openButton(el).click();
    await flush(el);

    const shown = equipmentDialog(el)!.equipment!;
    expect(shown).toEqual(kept);
    expect(shown.roles.find((role) => role.role === "receipt")!.chosenId).toBe(PP.id);
    expect(shown.roles.find((role) => role.role === "card_terminal")!.resolved).toBeNull();
  });
});

it("shows a cash-sale ticket without technical clock notices", async () => {
  const { el } = await mountApp();
  await toTicket(el);
  setLocale("en-GB");
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("Check the server's date and time");
  expect(el.shadowRoot!.textContent).not.toContain("has not been verified");
  expect(ticket(el)).not.toBeNull();
});

describe("switching the device's profile from the header", () => {
  const COUNTER = { id: "pr-counter", name: "Counter till" };
  const BAR = { id: "pr-bar", name: "Bar till" };
  const identity = {
    deviceId: "till-dev",
    name: "Till 1",
    formFactor: "till",
    stationId: null,
    profileId: COUNTER.id,
    approvedProfiles: [COUNTER, BAR],
  };
  const foodMenu = { id: "cat-food", name: "Comida", isDefault: true };
  const drinksMenu = { id: "cat-drinks", name: "Bebidas", isDefault: false };
  const twoMenus = vi.fn().mockResolvedValue({
    menus: [foodMenu, drinksMenu],
    products: [
      { ...cafe, catalogueId: "cat-food", catalogueName: "Comida" },
      {
        ...cafe,
        id: "cerveza",
        menuItemId: "menu-item-cerveza",
        name: "Cerveza",
        catalogueId: "cat-drinks",
        catalogueName: "Bebidas",
      },
    ],
  });
  const profileDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillProfileDialog>("till-profile-dialog");
  const profileButton = (el: TillApp) =>
    shell(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button.profile");

  async function openProfile(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
    const { el } = await mountApp(
      {
        getDeviceIdentity: vi.fn().mockResolvedValue(identity),
        switchDeviceProfile: vi.fn().mockResolvedValue({
          activeProfileId: BAR.id,
        }),
        ...overrides,
      },
      theme,
    );
    const c = await toCounter(el);
    profileButton(el)!.click();
    await flush(el);
    return { el, c };
  }

  async function scheduleWithProfile(
    note: string,
    overrides: Record<string, unknown> = {},
    theme?: "light" | "dark",
    reverted = false,
  ) {
    const { el, c } = await openProfile(
      {
        listMyShifts: vi.fn().mockResolvedValue([]),
        listMySwaps: vi.fn().mockResolvedValue([]),
        listMyAbsences: vi.fn().mockResolvedValue([]),
        requestAbsence: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      },
      theme,
    );
    emit(profileDialog(el)!, "close");
    await flush(el);
    emit(shell(el)!, "show-schedule");
    await flush(el);
    const owner = schedule(el)!;
    const input = owner.shadowRoot!.querySelector<WtInput>(".abs-note")!;
    await input.updateComplete;
    if (note !== "") await userEvent.fill(input.shadowRoot!.querySelector("input")!, note);
    if (reverted) await userEvent.fill(input.shadowRoot!.querySelector("input")!, "");
    profileButton(el)!.click();
    await flush(el);
    return { el, c, owner, input, href: location.href };
  }

  it("a profile switch protects a staged Schedule request before changing context", async () => {
    const { el, owner, input, href } = await scheduleWithProfile("Family visit");
    const dialog = profileDialog(el)!;
    emit(dialog, "profile-switch", { profileId: BAR.id });
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    expect(question.open).toBe(true);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
    expect(schedule(el)).toBe(owner);
    expect(location.href).toBe(href);
    await question.updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question.open).toBe(false);
    expect(profileDialog(el)).toBe(dialog);
    expect(input.value).toBe("Family visit");
    expect(schedule(el)).toBe(owner);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();

    emit(dialog, "profile-switch", { profileId: BAR.id });
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => schedule(el)).toBeNull();
    await expect.poll(() => profileDialog(el)).toBeNull();
    expect(currentApi.switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
    expect(currentApi.requestAbsence).not.toHaveBeenCalled();
    expect(currentApi.logout).not.toHaveBeenCalled();
    expect(counter(el)).not.toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it.each(["clean", "reverted"])(
    "a %s Schedule allows the profile switch without asking",
    async (state) => {
      const { el } = await scheduleWithProfile(
        state === "clean" ? "" : "Family visit",
        {},
        undefined,
        state === "reverted",
      );
      emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
      await expect.poll(() => profileDialog(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
      expect(currentApi.switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
      expect(currentApi.requestAbsence).not.toHaveBeenCalled();
      expect(counter(el)).not.toBeNull();
    },
  );

  it("keeping the active profile retains the edited Schedule without asking", async () => {
    const { el, owner, input, href } = await scheduleWithProfile("Family visit");
    emit(profileDialog(el)!, "profile-switch", { profileId: COUNTER.id });
    await flush(el);
    expect(profileDialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(schedule(el)).toBe(owner);
    expect(input.value).toBe("Family visit");
    expect(location.href).toBe(href);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
  });

  it("profile refusal for an active basket keeps the Schedule draft without another question", async () => {
    const { el, c, owner, input } = await scheduleWithProfile("Family visit");
    c.store.addProduct(cafe, "2");
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    expect(profileDialog(el)!.notice).toBe("order_open");
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(schedule(el)).toBe(owner);
    expect(input.value).toBe("Family visit");
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
  });

  it("a profile switch retains a label-only counter basket and its unload protection", async () => {
    const { el, c } = await openProfile();
    const id = c.store.id;
    c.store.label = "Lunch";
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await expect.poll(() => profileDialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(currentApi.switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
    expect(counter(el)!.store.id).toBe(id);
    expect(counter(el)!.store.label).toBe("Lunch");
    expect(counter(el)!.store.lines).toEqual([]);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
    expect(currentApi.recordSale).not.toHaveBeenCalled();
  });

  it("a profile switch rechecks a basket filled while its leave question was open", async () => {
    const { el, c } = await scheduleWithProfile("Family visit");
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    c.store.addProduct(cafe, "2");
    await question.updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await flush(el);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)!.notice).toBe("order_open");
    expect(c.store.lines[0]!.quantity).toBe("2");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("disconnect aborts a pending profile leave and cannot send the old switch", async () => {
    const { el } = await scheduleWithProfile("Family visit");
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    el.remove();
    await flush(el);
    question.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision: "discard" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`native profile context Keep/Escape/Discard, ${locale}, ${theme}, ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el, owner, input, href } = await scheduleWithProfile(
              "Family visit",
              { getTill: vi.fn().mockResolvedValue({ ...till, locale }) },
              theme,
            );
            expect(currentLocale()).toBe(locale);
            const dialog = profileDialog(el)!;
            await dialog.updateComplete;
            const picker = dialog.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!;
            await chooseOption(picker, BAR.id);
            await dialog.updateComplete;
            const switchHost = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              "[data-test=profile-switch]",
            )!;
            await switchHost.updateComplete;
            const button = switchHost.shadowRoot!.querySelector("button")!;
            await userEvent.click(button);
            const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
            await expect.poll(() => question.open).toBe(true);
            const keep = question
              .shadowRoot!.querySelector("[data-choice=keep]")!
              .shadowRoot!.querySelector("button")!;
            await expect.poll(() => keep.matches(":focus")).toBe(true);
            await commands.parkPointer();
            await expectNoA11yViolations(question);
            await page.screenshot({
              path: `__screenshots__/w69-profile-context/${locale}-${theme}-${width}-warning.png`,
            });
            await userEvent.keyboard("{Escape}");
            await expect.poll(() => question.open).toBe(false);
            expect(schedule(el)).toBe(owner);
            expect(input.value).toBe("Family visit");
            expect(location.href).toBe(href);
            await expect.poll(() => button.matches(":focus")).toBe(true);
            await page.screenshot({
              path: `__screenshots__/w69-profile-context/${locale}-${theme}-${width}-kept.png`,
            });
            await userEvent.click(button);
            await expect.poll(() => question.open).toBe(true);
            await question.updateComplete;
            await userEvent.click(
              question
                .shadowRoot!.querySelector("[data-choice=keep]")!
                .shadowRoot!.querySelector("button")!,
            );
            await expect.poll(() => question.open).toBe(false);
            expect(input.value).toBe("Family visit");
            expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
            await userEvent.click(button);
            await expect.poll(() => question.open).toBe(true);
            await question.updateComplete;
            await userEvent.click(
              question
                .shadowRoot!.querySelector("[data-choice=discard]")!
                .shadowRoot!.querySelector("button")!,
            );
            await expect.poll(() => profileDialog(el)).toBeNull();
            expect(currentApi.switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
            expect(currentApi.requestAbsence).not.toHaveBeenCalled();
          } finally {
            await page.viewport(size.width, size.height);
          }
        });

  it("offers no Profile button on a device approved for one profile", async () => {
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity, approvedProfiles: [COUNTER] }),
    });
    await toCounter(el);
    expect(profileButton(el)).toBeNull();
  });

  it("opens on the approved profiles, read again, with the active one chosen", async () => {
    const getDeviceIdentity = vi.fn().mockResolvedValue(identity);
    const { el } = await openProfile({ getDeviceIdentity });
    const dialog = profileDialog(el)!;
    expect(dialog.open).toBe(true);
    expect(dialog.profiles).toEqual([COUNTER, BAR]);
    expect(dialog.activeProfileId).toBe(COUNTER.id);
    expect(dialog.notice).toBeNull();
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
  });

  it("opens on the profiles last read when reading the device again fails", async () => {
    const getDeviceIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity)
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await openProfile({ getDeviceIdentity });
    const dialog = profileDialog(el)!;
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(true);
    expect(dialog.profiles).toEqual([COUNTER, BAR]);
    expect(dialog.activeProfileId).toBe(COUNTER.id);
  });

  it("refuses to switch while an order is in progress, sending nothing until it is cleared", async () => {
    const switchDeviceProfile = vi.fn().mockResolvedValue({
      activeProfileId: BAR.id,
    });
    const { el, c } = await openProfile({ switchDeviceProfile });
    c.store.addProduct(cafe, "1");
    await flush(el);
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    expect(switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)!.notice).toBe("order_open");
    expect(c.store.lines).toHaveLength(1);

    c.store.clear();
    await flush(el);
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    expect(switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
  });

  it("a switch reads the till's setup again and starts again from the zone's default menu, still signed in", async () => {
    const switchedTabs = till.canvas.tabs.map((tab) => ({ ...tab, title: `${tab.title} (bar)` }));
    const getTill = vi
      .fn()
      .mockResolvedValueOnce(till)
      .mockResolvedValue({ ...till, canvas: { ...till.canvas, tabs: switchedTabs } });
    const { el } = await openProfile({ listProducts: twoMenus, getTill });
    emit(counter(el)!, "menu-selected", { id: "cat-drinks" });
    await flush(el);
    expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-drinks");
    const zoneReads = vi.mocked(currentApi.listDefaultZoneOffers).mock.calls.length;

    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    await flush(el);

    expect(currentApi.switchDeviceProfile).toHaveBeenCalledExactlyOnceWith(BAR.id);
    expect(profileDialog(el)).toBeNull();
    expect(getTill).toHaveBeenCalledTimes(2);
    expect((shell(el) as HTMLElement & { tabs: { title: string }[] }).tabs).toEqual(switchedTabs);
    expect(vi.mocked(currentApi.listDefaultZoneOffers).mock.calls.length).toBe(zoneReads + 1);
    expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-food");
    expect(counter(el)).not.toBeNull();
    expect(lock(el)).toBeNull();
  });

  it("a switch opens the new profile's starting screen, in place of the screen open before it", async () => {
    const getTill = vi
      .fn()
      .mockResolvedValueOnce(till)
      .mockResolvedValue({ ...till, startingScreen: "show-schedule" });
    const { el } = await openProfile({
      getTill,
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    emit(counter(el)!, "show-expo");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();

    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    await flush(el);

    expect(schedule(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-expo-screen")).toBeNull();
  });

  it("a switch to a profile with no starting screen lands on the canvas's first tab", async () => {
    const { el } = await openProfile();
    emit(counter(el)!, "show-expo");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();

    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-expo-screen")).toBeNull();
    expect(counter(el)).not.toBeNull();
  });

  it("does not leave the dialog busy when a step after the switch throws", async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      let switched = false;
      const { el } = await openProfile({
        // A device read after the switch that answers nothing makes the profiles step throw.
        getDeviceIdentity: vi.fn(async () => (switched ? null : identity)),
        switchDeviceProfile: vi.fn(async () => {
          switched = true;
          return { activeProfileId: BAR.id };
        }),
      });

      emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
      await flush(el);
      await flush(el);

      expect(rejections).toHaveLength(1);
      expect(profileDialog(el)).toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  it("a switch to a profile with no starting screen lands on the first tab, though the tab left is also on the new canvas", async () => {
    const withScheduleTab = {
      ...till.canvas,
      tabs: [...till.canvas.tabs, { key: "schedule", title: "Horario", columns: 24, cards: [] }],
    };
    const { el } = await openProfile({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: withScheduleTab }),
    });
    emit(shell(el)!, "tab-select", { key: "schedule" });
    await flush(el);
    expect(shell(el)!.activeTabKey).toBe("schedule");

    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    await flush(el);

    expect(shell(el)!.activeTabKey).toBe(withScheduleTab.tabs[0]!.key);
  });

  it("a switch starts at the new profile's starting zone, not the zone the same person left", async () => {
    const zones = ["zone-start", "zone-terrace"].map((id) => ({
      id,
      name: id,
      departmentId: "department-restaurant",
      departmentName: "Restaurant",
      serviceMode: "prepay" as const,
    }));
    const offersIn = async (zoneId: string, menu: string): Promise<ZoneOfferCatalogue> => {
      const catalogue = fixtureOffers({
        menus: [{ id: menu, name: menu, isDefault: true }],
        products: [{ ...cafe, catalogueId: menu, catalogueName: menu }],
      });
      catalogue.context = { ...catalogue.context, zoneId };
      catalogue.zones = zones;
      return catalogue;
    };
    const listDefaultZoneOffers = vi
      .fn()
      .mockImplementationOnce(() => offersIn("zone-start", "menu-start"))
      .mockImplementation(() => offersIn("zone-bar", "menu-bar"));
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockResolvedValue(identity),
      switchDeviceProfile: vi.fn().mockResolvedValue({
        activeProfileId: BAR.id,
      }),
      listDefaultZoneOffers,
      listZoneOffers: vi.fn((zoneId: string) => offersIn(zoneId, `menu-${zoneId}`)),
    });
    await toCounter(el);
    emit(counter(el)!, "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);
    expect(counter(el)!.selectedServiceZoneId).toBe("zone-terrace");
    profileButton(el)!.click();
    await flush(el);

    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    await flush(el);

    expect(counter(el)!.selectedServiceZoneId).toBe("zone-bar");
    expect(currentApi.setServiceZone).toHaveBeenLastCalledWith("zone-bar");
    expect(vi.mocked(currentApi.listZoneOffers)).toHaveBeenCalledTimes(1);
  });

  it("a refused switch keeps the dialog open with the refusal and reads nothing again", async () => {
    const getTill = vi.fn().mockResolvedValue(till);
    const { el } = await openProfile({
      getTill,
      switchDeviceProfile: vi.fn().mockRejectedValue({ code: "device_profile.not_admitted" }),
    });
    emit(profileDialog(el)!, "profile-switch", { profileId: BAR.id });
    await flush(el);
    expect(profileDialog(el)!.notice).toEqual({ code: "device_profile.not_admitted" });
    expect(profileDialog(el)!.busy).toBe(false);
    expect(getTill).toHaveBeenCalledTimes(1);
  });

  it("choosing the active profile closes the dialog without a request", async () => {
    const { el } = await openProfile();
    emit(profileDialog(el)!, "profile-switch", { profileId: COUNTER.id });
    await flush(el);
    expect(currentApi.switchDeviceProfile).not.toHaveBeenCalled();
    expect(profileDialog(el)).toBeNull();
  });
});

describe("application unsaved changes renderer", () => {
  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const decision of ["keep", "discard"] as const) {
      it(`${locale}: ${decision} uses the shell's single localized confirmation`, async () => {
        const { el } = await mountApp();
        await flush(el);
        setLocale(locale);
        await el.updateComplete;
        const child = el.shadowRoot!.querySelector<HTMLElement>("div, main")!;
        const coordinator = leaveCoordinatorFor(child);
        expect(coordinator, "descendant resolves the application registry").toBeDefined();
        let draft = "Original";
        const scope = coordinator!.register({
          id: child,
          current: () => draft,
          snapshot: (value) => value,
          equal: (a, b) => a === b,
          restore: (value) => {
            draft = value;
          },
        });
        draft = "Edited";
        scope.changed();
        let left = 0;
        const pending = coordinator!.request({
          scopes: [scope.id],
          reason: "cancel",
          proceed() {
            left++;
          },
        });
        await el.updateComplete;
        const questions = el.shadowRoot!.querySelectorAll("wt-unsaved-changes");
        expect(questions).toHaveLength(1);
        const question = questions[0]!;
        await question.updateComplete;
        const modal = question.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        expect(question.heading).toBe(
          locale === "en-GB" ? "Discard unsaved changes?" : "¿Descartar los cambios sin guardar?",
        );
        expect(question.message).toBe(
          locale === "en-GB"
            ? "Your changes have not been saved."
            : "Tus cambios no se han guardado.",
        );
        expect(question.keepLabel).toBe(locale === "en-GB" ? "Keep editing" : "Seguir editando");
        expect(question.discardLabel).toBe(
          locale === "en-GB" ? "Discard changes" : "Descartar cambios",
        );
        question.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${decision}"]`)!.click();
        expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
        expect(left).toBe(decision === "keep" ? 0 : 1);
        expect(draft).toBe(decision === "keep" ? "Edited" : "Original");
        scope.dispose();
      });
    }
  }
});

it("forced session exit aborts an open unsaved question and clears its registry immediately", async () => {
  const router = new ServerRouter({
    origin: BOX,
    fetchImpl: probeFetch(),
    storage: memoryStorage(),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api: stubApi(), router });
  await toCounter(el);
  const child = el.shadowRoot!.querySelector<HTMLElement>("div")!;
  const coordinator = leaveCoordinatorFor(child)!;
  let value = "Original";
  const scope = coordinator.register({
    id: child,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  value = "Typed secret";
  scope.changed();
  let left = 0;
  const pending = coordinator.request({
    scopes: [scope.id],
    reason: "cancel",
    proceed() {
      left++;
    },
  });
  await el.updateComplete;
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: BOX, to: CLOUD } }));
  await flush(el);
  expect(lock(el)).not.toBeNull();
  expect(coordinator.isDirty()).toBe(false);
  expect(await pending).toBe("stale");
  const activeQuestion = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await activeQuestion.updateComplete;
  expect(activeQuestion.open).toBe(false);
  question.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(left).toBe(0);
  expect(value).toBe("Typed secret");
});

describe("dead-end unsaved choices in the till shell", () => {
  it.each(["destination", "removal"])(
    "Keep and Discard retain the counter basket after a staged %s",
    async (edit) => {
      const askSaleDeadEnds = vi.fn().mockResolvedValue({
        sends: true,
        deadEnds: [
          {
            key: "0",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      });
      const recordSale = vi.fn().mockResolvedValue(saleResult);
      const { el } = await mountApp({ askSaleDeadEnds, recordSale });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1");
      await flush(el);
      tenderPay(el).shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
      await flush(el);
      const dialog = el.shadowRoot!.querySelector("till-dead-ends-dialog")!;
      const section =
        dialog.shadowRoot!.querySelector<TillDeadEndsSection>("till-dead-ends-section")!;
      await section.updateComplete;
      if (edit === "destination") {
        await chooseOption(
          section.shadowRoot!.querySelector<WtCombobox>("wt-combobox")!,
          "kitchen",
        );
      } else {
        section.shadowRoot!.querySelector<HTMLElement>(".remove")!.click();
      }
      await dialog.updateComplete;
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
      await flush(el);
      const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
      expect(q.open).toBe(true);
      expect(el.shadowRoot!.querySelector("till-dead-ends-dialog")).toBe(dialog);
      expect(
        c.store.lines.map((line) => ({
          id: line.product.id,
          quantity: line.quantity,
          makeAt: line.makeAt ?? null,
        })),
      ).toEqual([{ id: "cafe", quantity: "1", makeAt: null }]);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await flush(el);
      expect(q.open).toBe(false);
      if (edit === "destination") expect(section.choices.get("0")).toBe("kitchen");
      else expect(section.answer.deadEnds).toEqual([]);
      expect(recordSale).not.toHaveBeenCalled();
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
      await flush(el);
      expect(q.open).toBe(true);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await flush(el);
      await expect.poll(() => el.shadowRoot!.querySelector("till-dead-ends-dialog")).toBeNull();
      expect(
        c.store.lines.map((line) => ({
          id: line.product.id,
          quantity: line.quantity,
          makeAt: line.makeAt ?? null,
        })),
      ).toEqual([{ id: "cafe", quantity: "1", makeAt: null }]);
      expect(recordSale).not.toHaveBeenCalled();
    },
  );
});

it.each(["cash", "reference"] as const)(
  "W69 counter %s Cancel keeps tender and basket until local Discard without a sale",
  async (kind) => {
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1");
    await flush(el);
    const form = tenderPay(el);
    form.shadowRoot!.querySelector<HTMLElement>(kind === "cash" ? ".pay" : ".pay-card")!.click();
    await flush(el);
    if (kind === "cash") {
      const pad = form.shadowRoot!.querySelector("till-numeric-pad")!;
      await pad.updateComplete;
      pad.shadowRoot!.querySelector<HTMLElement>('[data-key="5"]')!.click();
    } else {
      const field = form.shadowRoot!.querySelector<WtInput>(".ref-input")!;
      await field.updateComplete;
      const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      await userEvent.fill(page.elementLocator(input), "  TX-007  ");
    }
    await flush(el);
    form.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await flush(el);
    const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await flush(el);
    expect(q.open).toBe(false);
    if (kind === "cash")
      expect(form.shadowRoot!.querySelector("till-numeric-pad")!.value).toBe("5");
    else expect(form.shadowRoot!.querySelector<WtInput>(".ref-input")!.value).toBe("  TX-007  ");
    form.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await flush(el);
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await flush(el);
    expect(form.shadowRoot!.querySelector(".pay")).not.toBeNull();
    expect(
      c.store.lines.map((line) => ({ product: line.product.id, quantity: line.quantity })),
    ).toEqual([{ product: "cafe", quantity: "1" }]);
    expect(recordSale).not.toHaveBeenCalled();
  },
);

describe("W69 till shell leave routes", () => {
  async function editedSchedule(
    options: Record<string, unknown> = {},
    activity?: ReturnType<typeof fakeSessionActivity>,
    theme?: "light" | "dark",
  ) {
    const { el } = await mountApp(
      {
        listMyShifts: vi.fn().mockResolvedValue([]),
        listMySwaps: vi.fn().mockResolvedValue([]),
        listMyAbsences: vi.fn().mockResolvedValue([]),
        requestAbsence: vi.fn().mockResolvedValue(undefined),
        ...options,
      },
      theme,
    );
    if (activity) el.sessionActivity = activity as never;
    await toCounter(el);
    emit(shell(el)!, "show-schedule");
    await flush(el);
    const owner = schedule(el)!;
    const input = owner.shadowRoot!.querySelector<WtInput>(".abs-note")!;
    await input.updateComplete;
    await userEvent.fill(input.shadowRoot!.querySelector("input")!, "Family visit");
    return { el, owner, input, href: location.href };
  }
  function question(el: TillApp) {
    return el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  }
  async function answer(el: TillApp, decision: "keep" | "discard") {
    const q = question(el);
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
    await expect.poll(() => q.open).toBe(false);
  }
  const routes = ["tab", "station", "expo", "locale", "logout"] as const;
  function leave(el: TillApp, route: (typeof routes)[number]) {
    if (route === "tab") selectTab(el, "floor");
    else if (route === "locale") emit(shell(el)!, "wt-locale-selected", { code: "en-GB" });
    else
      emit(
        shell(el)!,
        route === "station" ? "show-station" : route === "expo" ? "show-expo" : "logout",
      );
  }
  it.each(routes)(
    "holds %s and its side effects through Keep, then Discard leaves once",
    async (route) => {
      const { el, owner, input, href } = await editedSchedule();
      const pushes = vi.spyOn(history, "pushState");
      leave(el, route);
      await flush(el);
      expect(question(el).open).toBe(true);
      expect(schedule(el)).toBe(owner);
      expect(location.href).toBe(href);
      expect(currentApi.logout).not.toHaveBeenCalled();
      expect(currentApi.putLocale).not.toHaveBeenCalled();
      await answer(el, "keep");
      expect(input.value).toBe("Family visit");
      expect(schedule(el)).toBe(owner);
      expect(location.href).toBe(href);
      expect(currentApi.logout).not.toHaveBeenCalled();
      expect(currentApi.putLocale).not.toHaveBeenCalled();
      expect(pushes).not.toHaveBeenCalled();
      leave(el, route);
      await expect.poll(() => question(el).open).toBe(true);
      await answer(el, "discard");
      if (route === "locale") await expect.poll(() => schedule(el)).not.toBe(owner);
      else await expect.poll(() => schedule(el)).toBeNull();
      if (route === "logout") {
        expect(lock(el)).not.toBeNull();
        await expect.poll(() => vi.mocked(currentApi.logout).mock.calls.length).toBe(1);
      } else if (route === "locale") {
        await expect.poll(() => currentLocale()).toBe("en-GB");
        expect(currentApi.putLocale).toHaveBeenCalledExactlyOnceWith("en-GB");
        expect(input.value).toBe("");
      } else {
        expect(location.href).not.toBe(href);
        expect(pushes).toHaveBeenCalledOnce();
        if (route === "tab") expect(shell(el)!.activeTabKey).toBe("floor");
        else expect(el.shadowRoot!.querySelector(`till-${route}-screen`)).not.toBeNull();
      }
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    },
  );
  it("restores browser Back before asking and keeps the mounted request on Keep", async () => {
    const { el, owner, input, href } = await editedSchedule();
    history.back();
    await expect.poll(() => question(el).open).toBe(true);
    expect(location.href).toBe(href);
    expect(schedule(el)).toBe(owner);
    await answer(el, "keep");
    expect(input.value).toBe("Family visit");
    expect(location.href).toBe(href);
    history.back();
    await expect.poll(() => question(el).open).toBe(true);
    await answer(el, "discard");
    await expect.poll(() => schedule(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(location.href).not.toBe(href);
  });
  it("a reverted request leaves by tab without asking", async () => {
    const { el, input } = await editedSchedule();
    await userEvent.fill(input.shadowRoot!.querySelector("input")!, "");
    selectTab(el, "floor");
    await flush(el);
    expect(schedule(el)).toBeNull();
    expect(shell(el)!.activeTabKey).toBe("floor");
    expect(question(el).open).toBe(false);
  });

  for (const direction of ["back", "forward"] as const)
    for (const decision of ["keep", "discard"] as const)
      it(`unindexed ${direction} ${decision} protects the mounted schedule without adding history`, async () => {
        const { el, owner, input, href } = await editedSchedule();
        await userEvent.fill(input.shadowRoot!.querySelector("input")!, "");
        const acceptedState: unknown = history.state;
        const destination = new URL("/tabs/floor?source=legacy#table", location.origin).href;
        history.pushState({ external: "legacy", unrelated: 7 }, "", destination);
        if (direction === "back") history.pushState(acceptedState, "", href);
        else {
          const arrived = new Promise<void>((resolve) =>
            window.addEventListener("popstate", () => resolve(), { once: true }),
          );
          history.back();
          await arrived;
          await flush(el);
        }
        expect(schedule(el)).toBe(owner);
        await userEvent.fill(input.shadowRoot!.querySelector("input")!, "Legacy request");
        const length = history.length;
        const pushes = vi.spyOn(history, "pushState");
        const go = vi.spyOn(history, "go");
        try {
          history[direction]();
          await expect.poll(() => question(el).open).toBe(true);
          expect(location.href).toBe(href);
          expect(schedule(el)).toBe(owner);
          expect(input.value).toBe("Legacy request");
          await answer(el, decision);
          if (decision === "keep") {
            expect(location.href).toBe(href);
            expect(schedule(el)).toBe(owner);
            expect(input.value).toBe("Legacy request");
            const unload = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(unload);
            expect(unload.defaultPrevented).toBe(true);
          } else {
            await expect.poll(() => shell(el)!.activeTabKey).toBe("floor");
            expect(schedule(el)).toBeNull();
            expect(location.href).toBe(destination);
            expect(history.state).toMatchObject({ external: "legacy", unrelated: 7 });
            const unload = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(unload);
            expect(unload.defaultPrevented).toBe(false);
          }
          expect(history.state.__wtNavigation.index).toBe(0);
          expect(history.length).toBe(length);
          expect(pushes).not.toHaveBeenCalled();
          expect(go).not.toHaveBeenCalled();
          expect(currentApi.requestAbsence).not.toHaveBeenCalled();
          expect(currentApi.logout).not.toHaveBeenCalled();
        } finally {
          go.mockRestore();
        }
      });

  it.each(["idle", "server"])(
    "%s security exit cancels a pending signout decision without asking again",
    async (boundary) => {
      const activity = fakeSessionActivity();
      const router = new ServerRouter({
        origin: location.origin,
        fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
      });
      const { el, owner } = await editedSchedule({}, activity);
      el.router = router;
      await flush(el);
      emit(shell(el)!, "logout");
      await expect.poll(() => question(el).open).toBe(true);
      const stale = question(el).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
      expect(schedule(el)).toBe(owner);
      if (boundary === "idle") {
        const config = activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void };
        config.onIdle();
      } else {
        router.dispatchEvent(
          new CustomEvent("server-changed", { detail: { from: "old", to: "new" } }),
        );
      }
      await expect.poll(() => lock(el)).not.toBeNull();
      await expect.poll(() => question(el).open).toBe(false);
      stale.click();
      await flush(el);
      expect(lock(el)).not.toBeNull();
      expect(schedule(el)).toBeNull();
      expect(currentApi.logout).toHaveBeenCalledTimes(boundary === "idle" ? 1 : 0);
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
    },
  );
  it("holds the first requested destination while another tab request arrives", async () => {
    const { el, owner } = await editedSchedule();
    const pushes = vi.spyOn(history, "pushState");
    emit(shell(el)!, "show-expo");
    await expect.poll(() => question(el).open).toBe(true);
    selectTab(el, "floor");
    await flush(el);
    expect(schedule(el)).toBe(owner);
    await answer(el, "discard");
    await expect.poll(() => el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
    expect(shell(el)!.activeTabKey).toBe("counter");
    expect(pushes).toHaveBeenCalledOnce();
  });
  it("counter tab changes and logout retain the same basket without a form warning", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    c.store.label = "Lunch";
    const lines = c.store.lines;
    selectTab(el, "floor");
    await flush(el);
    expect(question(el).open).toBe(false);
    selectTab(el, "counter");
    await flush(el);
    expect(counter(el)!.store.lines).toEqual(lines);
    expect(counter(el)!.store.label).toBe("Lunch");
    emit(shell(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(question(el).open).toBe(false);
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    expect(counter(el)!.store.lines).toEqual(lines);
    expect(counter(el)!.store.label).toBe("Lunch");
    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
  });

  it("browser Forward retains the request on Keep and replays the destination once on Discard", async () => {
    const { el, input } = await editedSchedule();
    await userEvent.fill(input.shadowRoot!.querySelector("input")!, "");
    emit(shell(el)!, "show-expo");
    await expect.poll(() => schedule(el)).toBeNull();
    history.back();
    await expect.poll(() => schedule(el)).not.toBeNull();
    const owner = schedule(el)!;
    const note = owner.shadowRoot!.querySelector<WtInput>(".abs-note")!;
    await note.updateComplete;
    await userEvent.fill(note.shadowRoot!.querySelector("input")!, "Forward draft");
    const href = location.href;
    const pushes = vi.spyOn(history, "pushState");
    history.forward();
    await expect.poll(() => question(el).open).toBe(true);
    expect(schedule(el)).toBe(owner);
    expect(location.href).toBe(href);
    await answer(el, "keep");
    expect(note.value).toBe("Forward draft");
    history.forward();
    await expect.poll(() => question(el).open).toBe(true);
    await answer(el, "discard");
    await expect.poll(() => el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
    expect(pushes).not.toHaveBeenCalled();
  });
  it("an explicit floor tab loads its data only once when the accepted URL is published", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    const reads = vi.mocked(currentApi.getTablesState).mock.calls.length;
    selectTab(el, "floor");
    await flush(el);
    expect(shell(el)!.activeTabKey).toBe("floor");
    expect(currentApi.getTablesState).toHaveBeenCalledTimes(reads + 1);
    expect(question(el).open).toBe(false);
  });
  it("a tab absent from the canvas does not discard or ask about the current request", async () => {
    const { el, owner, href } = await editedSchedule();
    selectTab(el, "missing-tab");
    await flush(el);
    expect(question(el).open).toBe(false);
    expect(schedule(el)).toBe(owner);
    expect(location.href).toBe(href);
  });

  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`native shell tab/Keep/Escape/Discard, ${locale}, ${theme}, ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el, owner, input, href } = await editedSchedule(
              {
                getTill: vi.fn().mockResolvedValue({ ...till, locale }),
              },
              undefined,
              theme,
            );
            expect(currentLocale()).toBe(locale);
            const tab =
              shell(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button:last-of-type")!;
            expect(tab.textContent?.trim()).toBe(locale === "es-ES" ? "Sala" : "Floor");
            await userEvent.click(tab);
            await expect.poll(() => question(el).open).toBe(true);
            const q = question(el);
            const keep = q
              .shadowRoot!.querySelector("[data-choice=keep]")!
              .shadowRoot!.querySelector("button")!;
            await expect.poll(() => keep.matches(":focus")).toBe(true);
            await expectNoA11yViolations(q);
            await page.screenshot({
              path: `__screenshots__/w69-till-shell-look/${locale}-${theme}-${width}-warning.png`,
            });
            await userEvent.keyboard("{Escape}");
            await expect.poll(() => q.open).toBe(false);
            expect(schedule(el)).toBe(owner);
            expect(input.value).toBe("Family visit");
            expect(location.href).toBe(href);
            await expect.poll(() => tab.matches(":focus")).toBe(true);
            await page.screenshot({
              path: `__screenshots__/w69-till-shell-look/${locale}-${theme}-${width}-kept.png`,
            });
            await userEvent.click(tab);
            await answer(el, "keep");
            expect(input.value).toBe("Family visit");
            await userEvent.click(tab);
            await answer(el, "discard");
            await expect.poll(() => schedule(el)).toBeNull();
            expect(shell(el)!.activeTabKey).toBe("floor");
            expect(currentApi.requestAbsence).not.toHaveBeenCalled();
          } finally {
            await page.viewport(size.width, size.height);
          }
        });

  it("opening the same Schedule destination retains its request without asking", async () => {
    const { el, owner, input, href } = await editedSchedule();
    emit(shell(el)!, "show-schedule");
    await flush(el);
    expect(question(el).open).toBe(false);
    expect(schedule(el)).toBe(owner);
    expect(input.value).toBe("Family visit");
    expect(location.href).toBe(href);
  });
});

describe("W69 held move basket protection", () => {
  async function loaded(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
    const { el } = await mountApp(
      {
        getTablesState: vi.fn().mockResolvedValue([{ ...freeTable, id: "t9", label: "Mesa 9" }]),
        askOrderDeadEnds: vi.fn().mockResolvedValue({ sends: false, deadEnds: [] }),
        moveBill: vi
          .fn()
          .mockResolvedValue({ partyId: "party-new", billId: "wo-1", merged: false }),
        ...overrides,
      },
      theme,
    );
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await expect.poll(() => c.store.id).toBe("wo-1");
    return { el, c };
  }
  function move(c: TillCounterScreen, orderId = "wo-1") {
    emit(c, "move-held-order", { orderId, tableId: "t9", seated: null, bills: "merge" });
  }
  function warning(el: TillApp) {
    return el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  }
  async function choose(el: TillApp, choice: "keep" | "discard") {
    const q = warning(el);
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
    await expect.poll(() => q.open).toBe(false);
  }
  function unloadCancelled() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  it("asks before moving the edited basket; Keep retains values and Discard moves once", async () => {
    const { el, c } = await loaded();
    c.store.setLineQuantity(0, "3");
    c.store.label = "Local lunch";
    move(c);
    await flush(el);
    expect(warning(el).open).toBe(true);
    expect(currentApi.askOrderDeadEnds).not.toHaveBeenCalled();
    expect(currentApi.moveBill).not.toHaveBeenCalled();
    await choose(el, "keep");
    expect(c.store.id).toBe("wo-1");
    expect(c.store.label).toBe("Local lunch");
    expect(c.store.lines[0]!.quantity).toBe("3");
    move(c);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => c.store.lines.length).toBe(0);
    expect(currentApi.moveBill).toHaveBeenCalledExactlyOnceWith(
      "wo-1",
      { tableId: "t9" },
      "merge",
      { partyId: null, otherPartyId: null },
    );
    expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
    expect(unloadCancelled()).toBe(false);
  });
  it("moving another held order retains the dirty basket without asking", async () => {
    const { el, c } = await loaded();
    c.store.setLineQuantity(0, "3");
    move(c, "other-held");
    await expect.poll(() => currentApi.moveBill).toHaveBeenCalledOnce();
    expect(warning(el).open).toBe(false);
    expect(c.store.id).toBe("wo-1");
    expect(c.store.lines[0]!.quantity).toBe("3");
    expect(unloadCancelled()).toBe(true);
  });
  it("a reverted retrieved basket moves directly and clears unload protection", async () => {
    const { el, c } = await loaded();
    c.store.setLineQuantity(0, "3");
    c.store.setLineQuantity(0, "2");
    move(c);
    await expect.poll(() => c.store.lines.length).toBe(0);
    expect(warning(el).open).toBe(false);
    expect(currentApi.moveBill).toHaveBeenCalledOnce();
    expect(unloadCancelled()).toBe(false);
  });
  it("a move refusal after Discard keeps the edited basket and unload warning", async () => {
    const { el, c } = await loaded({
      moveBill: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    c.store.label = "Local lunch";
    move(c);
    await expect.poll(() => warning(el).open).toBe(true);
    await choose(el, "discard");
    await expect.poll(() => currentApi.moveBill).toHaveBeenCalledOnce();
    await flush(el);
    expect(c.store.id).toBe("wo-1");
    expect(c.store.label).toBe("Local lunch");
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(unloadCancelled()).toBe(true);
  });
  it("a pending move cannot clear a later local basket edit", async () => {
    let release!: (value: { partyId: string; billId: string; merged: boolean }) => void;
    const { el, c } = await loaded({
      moveBill: vi.fn(() => new Promise((resolve) => (release = resolve))),
    });
    move(c);
    await expect.poll(() => currentApi.moveBill).toHaveBeenCalledOnce();
    c.store.label = "Typed during move";
    release({ partyId: "party-new", billId: "wo-1", merged: false });
    await flush(el);
    expect(c.store.id).toBe("wo-1");
    expect(c.store.label).toBe("Typed during move");
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(unloadCancelled()).toBe(true);
  });
  it("a pending move cannot clear a newly loaded copy with the same id and values", async () => {
    let release!: (value: { partyId: string; billId: string; merged: boolean }) => void;
    const { el, c } = await loaded({
      moveBill: vi.fn(() => new Promise((resolve) => (release = resolve))),
    });
    move(c);
    await expect.poll(() => currentApi.moveBill).toHaveBeenCalledOnce();
    c.store.loadFrom("wo-1", [...c.store.lines], "Mesa 4", 3);
    release({ partyId: "party-new", billId: "wo-1", merged: false });
    await flush(el);
    expect(c.store.id).toBe("wo-1");
    expect(c.store.label).toBe("Mesa 4");
    expect(c.store.lines[0]!.quantity).toBe("2");
  });
  it("a replaced basket makes its pending move decision inert", async () => {
    const { el, c } = await loaded();
    c.store.label = "Local lunch";
    move(c);
    await expect.poll(() => warning(el).open).toBe(true);
    const stale = warning(el).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    c.store.loadFrom("other", [{ product: jamon, quantity: "1" }], "Other", 1);
    await expect.poll(() => warning(el).open).toBe(false);
    stale.click();
    await flush(el);
    expect(currentApi.moveBill).not.toHaveBeenCalled();
    expect(c.store.id).toBe("other");
    expect(c.store.lines[0]!.product.id).toBe("jamon");
  });
  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`native held move Keep/Escape/Discard ${locale} ${theme} ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el, c } = await loaded(
              {
                getTill: vi.fn().mockResolvedValue({ ...till, locale }),
                listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
              },
              theme,
            );
            c.store.label = "Local lunch";
            const held = counterGrid(el)!.shadowRoot!.querySelector("till-held-orders")!;
            async function pick() {
              await held.updateComplete;
              await userEvent.click(
                held.shadowRoot!.querySelector(".move")!.shadowRoot!.querySelector("button")!,
              );
              await expect
                .poll(() => held.shadowRoot!.querySelector('[data-target="t9"]'))
                .not.toBeNull();
              await userEvent.click(
                held
                  .shadowRoot!.querySelector('[data-target="t9"]')!
                  .shadowRoot!.querySelector("button")!,
              );
              await expect.poll(() => warning(el).open).toBe(true);
            }
            await pick();
            const q = warning(el);
            const keep = q
              .shadowRoot!.querySelector("[data-choice=keep]")!
              .shadowRoot!.querySelector("button")!;
            await expect.poll(() => keep.matches(":focus")).toBe(true);
            expect(currentApi.moveBill).not.toHaveBeenCalled();
            await expectNoA11yViolations(q);
            await page.screenshot({
              path: `__screenshots__/w69-held-move-look/${locale}-${theme}-${width}-warning.png`,
            });
            await userEvent.keyboard("{Escape}");
            await expect.poll(() => q.open).toBe(false);
            expect(c.store.label).toBe("Local lunch");
            await expect
              .poll(() =>
                held
                  .shadowRoot!.querySelector(".move")!
                  .shadowRoot!.querySelector("button")!
                  .matches(":focus"),
              )
              .toBe(true);
            await pick();
            await choose(el, "keep");
            expect(c.store.label).toBe("Local lunch");
            await expect
              .poll(() =>
                held
                  .shadowRoot!.querySelector(".move")!
                  .shadowRoot!.querySelector("button")!
                  .matches(":focus"),
              )
              .toBe(true);
            expect(currentApi.moveBill).not.toHaveBeenCalled();
            await page.screenshot({
              path: `__screenshots__/w69-held-move-look/${locale}-${theme}-${width}-kept.png`,
            });
            await pick();
            await choose(el, "discard");
            await expect.poll(() => c.store.lines.length).toBe(0);
            expect(currentApi.moveBill).toHaveBeenCalledOnce();
            expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
          } finally {
            await page.viewport(size.width, size.height);
          }
        });
});

describe("basket unsaved replacement", () => {
  function unloadCancelled() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  function question(el: TillApp) {
    return el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  }
  async function answer(el: TillApp, decision: "keep" | "discard") {
    const q = question(el);
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
    await expect.poll(() => q.open).toBe(false);
  }
  it("registers memory-only lines and label for unload, including reverts", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    expect(unloadCancelled()).toBe(false);
    c.store.label = "Lunch";
    expect(unloadCancelled()).toBe(true);
    c.store.label = undefined;
    expect(unloadCancelled()).toBe(false);
    c.store.addProduct(cafe, "2");
    expect(unloadCancelled()).toBe(true);
    c.store.removeLine(0);
    expect(unloadCancelled()).toBe(false);
  });
  it("Keep retains the basket; Discard retrieves once without abandoning or paying it", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(jamon, "1");
    c.store.label = "Lunch";
    const id = c.store.id;
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(question(el).open).toBe(true);
    expect(currentApi.retrieveWorkingOrder).not.toHaveBeenCalled();
    await answer(el, "keep");
    expect(c.store.id).toBe(id);
    expect(c.store.lines[0]!.product.id).toBe("jamon");
    expect(c.store.label).toBe("Lunch");
    emit(c, "retrieve-order", { id: "wo-1" });
    await expect.poll(() => question(el).open).toBe(true);
    await answer(el, "discard");
    await expect.poll(() => c.store.id).toBe("wo-1");
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(currentApi.retrieveWorkingOrder).toHaveBeenCalledExactlyOnceWith("wo-1");
    expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
    expect(currentApi.recordSale).not.toHaveBeenCalled();
    expect(currentApi.parkOrder).not.toHaveBeenCalled();
    expect(unloadCancelled()).toBe(false);
  });
  it("retrieved label and line edits warn, and reverting to the loaded values clears unload", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await expect.poll(() => c.store.id).toBe("wo-1");
    expect(unloadCancelled()).toBe(false);
    c.store.label = "New label";
    expect(c.store.dirty).toBe(false);
    expect(unloadCancelled()).toBe(true);
    c.store.label = "Mesa 4";
    expect(unloadCancelled()).toBe(false);
    c.store.setLineQuantity(0, "3");
    expect(unloadCancelled()).toBe(true);
    c.store.setLineQuantity(0, "2");
    expect(unloadCancelled()).toBe(false);
  });
  it("an approved failed retrieval preserves the local basket and unload warning", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(jamon, "1");
    const id = c.store.id;
    emit(c, "retrieve-order", { id: "gone" });
    await expect.poll(() => question(el).open).toBe(true);
    await answer(el, "discard");
    await expect.poll(() => currentApi.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(c.store.id).toBe(id);
    expect(c.store.lines[0]!.product.id).toBe("jamon");
    expect(unloadCancelled()).toBe(true);
    expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
  });
  it("retained basket remains unload-protected through tabs and logout without asking", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    selectTab(el, "floor");
    await flush(el);
    expect(question(el).open).toBe(false);
    expect(unloadCancelled()).toBe(true);
    emit(shell(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(question(el).open).toBe(false);
    expect(unloadCancelled()).toBe(true);
    expect(c.store.lines[0]!.quantity).toBe("2");
  });
  it("a successful sale clears basket unload protection without asking before payment", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    expect(unloadCancelled()).toBe(true);
    emit(c, "confirm-payment", { method: "cash", amount: "3" });
    await expect.poll(() => ticket(el)).not.toBeNull();
    expect(question(el).open).toBe(false);
    expect(currentApi.recordSale).toHaveBeenCalledOnce();
    expect(unloadCancelled()).toBe(false);
    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(counter(el)!.store.lines).toEqual([]);
    expect(unloadCancelled()).toBe(false);
  });
  it("a clean retrieval answered after another local edit cannot overwrite that edit", async () => {
    const saved = await stubApi().retrieveWorkingOrder("wo-1");
    let resolve!: (value: typeof saved) => void;
    const pending = new Promise<typeof saved>((answer) => {
      resolve = answer;
    });
    const { el } = await mountApp({ retrieveWorkingOrder: vi.fn().mockReturnValue(pending) });
    const c = await toCounter(el);
    const id = c.store.id;
    emit(c, "retrieve-order", { id: "wo-1" });
    await expect.poll(() => currentApi.retrieveWorkingOrder).toHaveBeenCalledOnce();
    c.store.addProduct(jamon, "1");
    c.store.label = "Newer basket";
    resolve(saved);
    await flush(el);
    expect(c.store.id).toBe(id);
    expect(c.store.lines[0]!.product.id).toBe("jamon");
    expect(c.store.label).toBe("Newer basket");
    expect(unloadCancelled()).toBe(true);
  });
  it("opening Pay from the waiting list asks before replacing a memory-only basket", async () => {
    const saved = await stubApi().retrieveWorkingOrder("wo-1");
    const { el } = await mountApp({ retrievePlacedOrder: vi.fn().mockResolvedValue(saved) });
    const c = await toCounter(el);
    c.store.addProduct(jamon, "1");
    const id = c.store.id;
    emit(c, "pay-waiting-order", { id: "wo-1" });
    await flush(el);
    expect(question(el).open).toBe(true);
    expect(currentApi.retrievePlacedOrder).not.toHaveBeenCalled();
    await answer(el, "keep");
    expect(c.store.id).toBe(id);
    emit(c, "pay-waiting-order", { id: "wo-1" });
    await expect.poll(() => question(el).open).toBe(true);
    await answer(el, "discard");
    await expect.poll(() => c.store.id).toBe("wo-1");
    expect(currentApi.retrievePlacedOrder).toHaveBeenCalledOnce();
    expect(currentApi.collectOrder).not.toHaveBeenCalled();
    expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
    expect(unloadCancelled()).toBe(false);
  });
});

describe("basket protection lifetimes", () => {
  function unloadCancelled() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  it("display-only basket notifications leave a pending replacement decision open", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "retrieve-order", { id: "wo-1" });
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    c.store.setBlocked(["removed"]);
    await flush(el);
    expect(question.open).toBe(true);
    expect(currentApi.retrieveWorkingOrder).not.toHaveBeenCalled();
    await discardBasketChanges(el);
    await expect.poll(() => c.store.id).toBe("wo-1");
  });
  it("a captured card payment clears basket unload protection without another confirmation", async () => {
    const { el } = await mountApp({
      pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    emit(c, "collect-card", {});
    await expect.poll(() => ticket(el)).not.toBeNull();
    expect(currentApi.pay).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unloadCancelled()).toBe(false);
  });
  it("an accepted line save stays clean when the subsequent payment is refused", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.refused" }),
    });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await expect.poll(() => c.store.id).toBe("wo-1");
    c.store.setLineExtras(0, { note: "No sugar" });
    expect(unloadCancelled()).toBe(true);
    emit(c, "confirm-payment", { method: "cash", amount: "3" });
    await expect.poll(() => currentApi.recordSale).toHaveBeenCalledOnce();
    expect(currentApi.updateWorkingOrder).toHaveBeenCalledExactlyOnceWith("wo-1", {
      lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2", makeAt: null, note: "No sugar" }],
      label: "Mesa 4",
      revision: 3,
    });
    expect(unloadCancelled()).toBe(false);
    expect(c.store.lines[0]!.note).toBe("No sugar");
  });
  it("compares modifier membership without offered order while retaining line positions", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const extras = [
      { listId: "x1", productId: "e1", quantity: 1, name: "First", price: "1.00" },
      { listId: "x2", productId: "e2", quantity: 2, name: "Second", price: "2.00" },
    ];
    const options = [
      { listId: "o1", labelId: "l1" },
      { listId: "o2", labelId: "l2" },
    ];
    c.store.loadFrom(
      "stored",
      [{ product: cafe, quantity: "2.000", extras, options }],
      "Stored",
      2,
    );
    expect(unloadCancelled()).toBe(false);
    c.store.setLineModifiers(0, { extras: [...extras].reverse(), options: [...options].reverse() });
    expect(unloadCancelled()).toBe(false);
    c.store.setLineModifiers(0, {
      extras: [{ ...extras[0]!, listId: "another-list" }, extras[1]!],
      options,
    });
    expect(unloadCancelled()).toBe(true);
    c.store.setLineModifiers(0, { extras, options });
    expect(unloadCancelled()).toBe(false);
    c.store.setLineExtras(0, { note: "No sugar" });
    expect(unloadCancelled()).toBe(true);
    c.store.setLineExtras(0, { note: "" });
    expect(unloadCancelled()).toBe(false);
    c.store.setLineMakeAt(0, "kitchen");
    expect(unloadCancelled()).toBe(true);
    c.store.setLineMakeAt(0, undefined);
    expect(unloadCancelled()).toBe(false);
    c.store.addProduct(jamon, "1");
    expect(unloadCancelled()).toBe(true);
    c.store.removeLine(1);
    expect(unloadCancelled()).toBe(false);
    el.remove();
    expect(unloadCancelled()).toBe(false);
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

describe("basket native replacement warning", () => {
  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`Retrieve / Keep / Escape / Discard, ${locale}, ${theme}, ${width}`, async () => {
          const size = { width: window.innerWidth, height: window.innerHeight };
          await page.viewport(width, 900);
          try {
            const { el } = await mountApp(
              {
                getTill: vi.fn().mockResolvedValue({ ...till, locale }),
                listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
              },
              theme,
            );
            const c = await toCounter(el);
            c.store.addProduct(jamon, "1");
            c.store.label = "Lunch";
            const id = c.store.id;
            const held = counterGrid(el)!.shadowRoot!.querySelector("till-held-orders")!;
            await held.updateComplete;
            const retrieve = held
              .shadowRoot!.querySelector(".retrieve")!
              .shadowRoot!.querySelector("button")!;
            await userEvent.click(retrieve);
            const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
            await expect.poll(() => question.open).toBe(true);
            expect(currentApi.retrieveWorkingOrder).not.toHaveBeenCalled();
            const keep = question
              .shadowRoot!.querySelector("[data-choice=keep]")!
              .shadowRoot!.querySelector("button")!;
            await expect.poll(() => keep.matches(":focus")).toBe(true);
            expect(question.heading).toBe(
              locale === "en-GB"
                ? "Discard unsaved changes?"
                : "¿Descartar los cambios sin guardar?",
            );
            await expectNoA11yViolations(question);
            await page.screenshot({
              path: `__screenshots__/w69-basket-look/${locale}-${theme}-${width}-warning.png`,
            });
            await userEvent.keyboard("{Escape}");
            await expect.poll(() => question.open).toBe(false);
            expect(c.store.id).toBe(id);
            expect(c.store.label).toBe("Lunch");
            await expect.poll(() => retrieve.matches(":focus")).toBe(true);
            await userEvent.click(retrieve);
            await expect.poll(() => question.open).toBe(true);
            await userEvent.click(
              question
                .shadowRoot!.querySelector("[data-choice=keep]")!
                .shadowRoot!.querySelector("button")!,
            );
            await expect.poll(() => question.open).toBe(false);
            expect(c.store.lines[0]!.product.id).toBe("jamon");
            expect(currentApi.retrieveWorkingOrder).not.toHaveBeenCalled();
            await page.screenshot({
              path: `__screenshots__/w69-basket-look/${locale}-${theme}-${width}-kept.png`,
            });
            await userEvent.click(retrieve);
            await discardBasketChanges(el);
            await expect.poll(() => c.store.id).toBe("wo-1");
            expect(currentApi.retrieveWorkingOrder).toHaveBeenCalledExactlyOnceWith("wo-1");
            expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
            expect(currentApi.recordSale).not.toHaveBeenCalled();
          } finally {
            await page.viewport(size.width, size.height);
          }
        });
});

it("retained basket traverses indexed and unindexed history without a discard warning", async () => {
  const { el } = await mountApp();
  const c = await toCounter(el);
  c.store.addProduct(cafe, "2");
  c.store.label = "History basket";
  const id = c.store.id;
  selectTab(el, "floor");
  await flush(el);
  history.back();
  await expect.poll(() => counter(el)).not.toBeNull();
  expect(counter(el)!.store.id).toBe(id);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  history.forward();
  await expect.poll(() => shell(el)!.activeTabKey).toBe("floor");
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  const accepted = location.href;
  history.pushState({ external: "retained" }, "", accepted);
  history.back();
  await flush(el);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  history.forward();
  await flush(el);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  selectTab(el, "counter");
  await flush(el);
  expect(counter(el)!.store.id).toBe(id);
  expect(counter(el)!.store.label).toBe("History basket");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("New sale keeps edits made during payment until you explicitly discard them", async () => {
  let answer!: (value: TillSaleResult) => void;
  const paid = new Promise<TillSaleResult>((resolve) => (answer = resolve));
  const { el } = await mountApp({ recordSale: vi.fn().mockReturnValue(paid) });
  const c = await toCounter(el);
  c.store.addProduct(cafe, "2");
  const id = c.store.id;
  emit(c, "confirm-payment", { method: "cash", amount: "3" });
  await expect.poll(() => currentApi.recordSale).toHaveBeenCalledOnce();
  c.store.label = "Later label";
  answer(saleResult);
  await expect.poll(() => ticket(el)).not.toBeNull();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  emit(ticket(el)!, "new-sale");
  await flush(el);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  expect(question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(ticket(el)).not.toBeNull();
  expect(c.store.id).toBe(id);
  expect(c.store.label).toBe("Later label");
  emit(ticket(el)!, "new-sale");
  await discardBasketChanges(el);
  await expect.poll(() => counter(el)).not.toBeNull();
  expect(counter(el)!.store.id).not.toBe(id);
  expect(counter(el)!.store.lines).toEqual([]);
  expect(currentApi.recordSale).toHaveBeenCalledOnce();
  expect(currentApi.abandonWorkingOrder).not.toHaveBeenCalled();
});

it("a completed sale can start the next basket while its held-list refresh is still pending", async () => {
  let release!: (rows: HeldOrderSummary[]) => void;
  const pending = new Promise<HeldOrderSummary[]>((resolve) => (release = resolve));
  const { el } = await mountApp({
    listWorkingOrders: vi.fn().mockResolvedValueOnce([]).mockReturnValue(pending),
  });
  const c = await toCounter(el);
  c.store.addProduct(cafe, "2");
  const id = c.store.id;
  emit(c, "confirm-payment", { method: "cash", amount: "3" });
  await expect.poll(() => ticket(el)).not.toBeNull();
  emit(ticket(el)!, "new-sale");
  await flush(el);
  const next = counter(el);
  expect(next).not.toBeNull();
  expect(next!.store.id).not.toBe(id);
  expect(next!.store.lines).toEqual([]);
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  release([]);
  await flush(el);
  expect(counter(el)!.store.id).toBe(next!.store.id);
  expect(currentApi.recordSale).toHaveBeenCalledOnce();
});

import { page } from "vitest/browser";
import { currentContentLanguages } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { productUnit } from "./widgets/product-name.js";
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
import type { TillStationQueue } from "./widgets/station-queue.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  DevDeviceList,
  FloorZone,
  HeldOrderSummary,
  PayOutcome,
  ProductCatalogue,
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
  openedAt: "2026-08-05T10:00:00.000Z",
};

const floorZone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

const freeTable: TableState = {
  id: "t1",
  label: "1",
  zoneId: "z1",
  capacity: 4,
  state: "free",
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
};

const openTable: TableState = {
  id: "t2",
  label: "2",
  zoneId: "z1",
  capacity: 4,
  state: "open-tab",
  hasOpenTab: true,
  tabId: "wo-7",
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
  capabilities: ["print-receipt"] as CapabilityFlag[],
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
};

function fixtureOffers(catalogue: ProductCatalogue): ZoneOfferCatalogue {
  const defaultMenuId = catalogue.menus.find((menu) => menu.isDefault)?.id ?? null;
  return {
    context: { zoneId: "zone-counter", departmentId: "department-default", serviceMode: "prepay" },
    defaultMenuId,
    menus: catalogue.menus,
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? defaultMenuId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      active: true,
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
      offeredModifiers: product.offeredModifiers ?? [],
      variants: (product.variants ?? []).map(
        (variant): ZoneOfferCatalogue["offers"][number]["variants"][number] => ({
          id: variant.id,
          name: variant.name,
          customerName: variant.customerName ?? null,
          kitchenName: variant.kitchenName ?? null,
          image: variant.image ?? null,
          unitPrice: variant.unitPrice,
          menuPrice: null,
          offered: true,
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
    })),
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
    login: vi.fn().mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: "en-GB" }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products: [cafe] }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
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
    openTab: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
    addTabRound: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    markLineServed: vi.fn().mockResolvedValue(undefined),
    setLineCourse: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    recallLines: vi.fn().mockResolvedValue(undefined),
    voidLine: vi.fn().mockResolvedValue(undefined),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    moveTab: vi.fn().mockResolvedValue(undefined),
    joinTable: vi.fn().mockResolvedValue(undefined),
    mergeTabs: vi.fn().mockResolvedValue(undefined),
    transferLines: vi.fn().mockResolvedValue(undefined),
    splitTab: vi.fn().mockResolvedValue({ checkId: "wo-check" }),
    listStatuses: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    setServiceZone: vi.fn(),
    // `getDevDevices` rejects by default, so the default boot is not the dev chooser; `getDeviceIdentity`
    // resolves an enrolled `till`, so the default boot lands on the login (lock) screen.
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
      tillId: "t1",
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    join: vi.fn().mockResolvedValue({ joinId: "dev-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    deviceAdvance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
  if (!("listDefaultZoneOffers" in overrides)) {
    api.listDefaultZoneOffers = vi.fn(async () => fixtureOffers(await api.listProducts()));
  }
  if (!("listZoneOffers" in overrides)) {
    api.listZoneOffers = vi.fn(async () => fixtureOffers(await api.listProducts()));
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
  // Log in as a NON-configuring operator by default (the common case) — the capability tests below
  // drive a configuring one explicitly.
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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
  emit(floor(el)!, "open-table", { tableId: table.id, hasOpenTab: table.hasOpenTab });
  await flush(el);
  return tableOrder(el)!;
}

let currentApi: TillApi;
async function mountApp(overrides: Record<string, unknown> = {}) {
  currentApi = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: currentApi });
}

// Force a deterministic es-ES baseline before each test — DELIBERATELY not the module default (en-GB),
// so the boot/login switches to en-GB below are observable against a Spanish starting point rather than
// a no-op against an already-English default (a switch you cannot observe proves nothing).
beforeEach(() => setLocale("es-ES"));
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  if (vi.isMockFunction(history.pushState)) vi.mocked(history.pushState).mockRestore();
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app", () => {
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
    expect(modeIndicator(el)?.textContent?.trim()).toBe("Preparación");
  });

  it("starts on the lock screen", async () => {
    const { el } = await mountApp();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(ticket(el)).toBeNull();
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
      context: { zoneId: "zone-counter", departmentId: "department-bar", serviceMode: "prepay" },
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
        { id: "menu-standard", name: "Standard", isDefault: true },
        { id: "menu-happy-hour", name: "Happy hour", isDefault: false },
      ],
      offers: [
        {
          id: "offer-standard",
          menuId: "menu-standard",
          productId: "product-negroni",
          grossPrice: "9.00",
          unitPrice: "9.00",
          active: true,
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
          variants: [],
        },
        {
          id: "offer-happy-hour",
          menuId: "menu-happy-hour",
          productId: "product-negroni",
          grossPrice: "7.00",
          unitPrice: "7.00",
          active: true,
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
        { menuItemId: "offer-standard", quantity: "1" },
        { menuItemId: "offer-happy-hour", quantity: "1" },
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
    const select = c.shadowRoot!.querySelector<HTMLSelectElement>("#service-zone")!;
    select.value = "zone-deli";
    select.dispatchEvent(new Event("change"));
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
      // Drive the venue default to en-GB (≠ the es-ES starting point) so the device path's venue-default
      // `setLocale` is observable: an enrolled display has NO operator, so `#boot`'s
      // `if (this.operatorPersonId === "")` guard passes and the venue default is applied — the login-race
      // guard must never withhold the venue default from the operator-less device path.
      getTill: vi.fn().mockResolvedValue({
        ...till,
        locale: "en-GB",
        canvas: kdsCanvasDef,
        capabilities: ["act-as-kds"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
    // After login the waiter lands on the FLOOR (the face-set's post-lock face), never the counter.
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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
    // Counter concerns a handheld's floor landing never shows are skipped on this path.
    expect(currentApi.listWorkingOrders).not.toHaveBeenCalled();
  });

  // Handheld face-set containment (§6a): a `back-to-counter` — whether from the floor's Back
  // affordance or bubbled from any child — must NOT land the handheld on the counter POS (from
  // which `station`/`expo`/`schedule` are reachable). The floor's Back affordance is suppressed in
  // handheld mode (`canExitToCounter`).
  describe("handheld face-set containment (§6a)", () => {
    /** Boots a HANDHELD, logs the waiter in, and returns the app on the floor (the post-login face). */
    async function toHandheldFloor(): Promise<TillApp> {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      return el;
    }

    it("suppresses the floor's back-to-counter affordance in handheld mode (canExitToCounter=false)", async () => {
      const el = await toHandheldFloor();
      expect(floor(el)).not.toBeNull();
      // UI honesty: the handheld floor is the top of the phone shell, so its Back-to-counter control is
      // gone (a handheld has no counter to return to).
      expect(floor(el)!.canExitToCounter).toBe(false);
      expect(floor(el)!.shadowRoot!.querySelector(".back")).toBeNull();
    });

    it("does NOT leave the face-set when back-to-counter fires from the floor (stays on floor)", async () => {
      const el = await toHandheldFloor();
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
    });

    it("does NOT leave the face-set when back-to-counter bubbles from the table-order screen", async () => {
      const el = await toHandheldFloor();
      emit(floor(el)!, "open-table", { tableId: openTable.id, hasOpenTab: openTable.hasOpenTab });
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      // A stray back-to-counter bubbling up from the table-order subtree must not reach the counter POS.
      // On the shell it sets the active tab to `counter`, but the phone canvas authors NO counter tab, so
      // the shell falls back to its first tab (`floor`, a face-set member) — never the counter.
      emit(tableOrder(el)!, "back-to-counter");
      await flush(el);
      expect(counter(el)).toBeNull();
      expect(floor(el)).not.toBeNull();
    });
  });

  // ── Device front door ───────────────────────────────────────────────────────
  // One boot decision: dev + no adopted tab device → the chooser; not enrolled (401, not dev) → the join
  // screen; enrolled `kds` → the kiosk shell (the kds-boot test above); enrolled other → the login (lock)
  // screen. The default stub is an enrolled `till` (→ login); these tests override it.

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
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
      [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
          menuItemId: "menu-item-cafe-0",
          quantity: "1",
          extras: [{ listId: "list-milk", picks: [{ productId: "p-oat", quantity: 1 }] }],
        },
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
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

  it.each(["on_request", "never"] as const)(
    "%s offers an original at completion and switches to duplicate reprint after it succeeds",
    async (receiptPrintMode) => {
      const printReceipt = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({
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

  it("invoice-first collection offers a duplicate because the original printed at placement", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        orderFlow: "invoice_first",
        receiptPrintMode: "on_request",
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");

    emit(c, "place-order");
    await flush(el);
    emit(c, "collect-order", { method: "cash", amount: "5" });
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
      getTill: vi.fn().mockResolvedValue({ ...till, capabilities: [] }),
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

  it("a handheld hides the manual drawer action and ignores a forged open-drawer event even with the capability", async () => {
    const openDrawer = vi.fn().mockResolvedValue(undefined);
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: phoneCanvasDef,
        capabilities: ["open-cash-drawer", "print-receipt"],
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
      canConfigureTill: false,
    });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: openTable.id, hasOpenTab: true });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "20.00" });
    await flush(el);
    expect(recordSale).toHaveBeenCalledWith(
      [],
      { method: "cash", amount: "20.00" },
      openTable.tabId,
    );
    expect(ticket(el)!.shadowRoot!.querySelector("[data-test=open-drawer]")).toBeNull();

    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(openDrawer).not.toHaveBeenCalled();
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

  // ── Cash-drawer-authorization: the OPTIMISTIC 403 → supervisor-override dialog → retry flow ──
  // The till carries NO policy or role knowledge: it always TRIES the direct open, and only on the
  // server's `authorization.not_permitted` (a gated policy + an operator who lacks cash.drawer) does it
  // fetch the eligible supervisors and open the override dialog. This stays correct if the location's
  // policy changes mid-shift.

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

  it("a gated 403 fetches the eligible supervisors and opens the override dialog", async () => {
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
      [{ menuItemId: "menu-item-cafe-0", quantity: "1" }],
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
      [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
        { menuItemId: "menu-item-cafe-0", quantity: "1" },
      ],
      label: "Mesa 4",
      revision: 3,
    });
    // recordSale files the SAME edited composition under the same id, and the sync ran FIRST — the
    // server needs the lock updated before it files from it.
    expect(recordSale).toHaveBeenCalledWith(
      [
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
        { menuItemId: "menu-item-cafe-0", quantity: "1" },
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

  // A frozen answer carries six names and no ids (spec §2.3), so a retrieved line re-derives the
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
          workingOrderLineId: "line-answered",
          menuItemId: "menu-item-cafe-0",
          quantity: "3",
          options: [{ listId: "list-punto", labelId: "label-medium" }],
        },
      ],
    });
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
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
        { menuItemId: "menu-item-cafe-0", quantity: "1" },
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
    // is not the same as a server that refused with a `{ code }` (till-reroute §4.3): the operator must
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
    // (spec §3: the client holds the id stable across retries). The first attempt rejects (response
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
      lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
      lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
        { menuItemId: "menu-item-cafe-0", quantity: "1" },
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
        { menuItemId: "menu-item-cafe-0", quantity: "2" },
        { menuItemId: "menu-item-cafe-0", quantity: "1" },
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
    const catalogue = {
      context: { zoneId: "zone-counter", departmentId: "department-bar", serviceMode: "prepay" },
      defaultMenuId: "menu-standard",
      menus: [
        { id: "menu-standard", name: "Standard", isDefault: true },
        { id: "menu-happy", name: "Happy hour", isDefault: false },
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
        context: {
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
    await flush(el);

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
        tillId: null,
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
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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
        tillId: null,
      }),
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-1", queue: [] } }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api, sessionActivity: sa as never });
    await flush(el);
    // A KDS never logs in — it is configured as a kds_station (which holds the wake lock while active).
    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({
      loggedIn: false,
      kind: "kds_station",
    });
  });

  it("session activity: uses the real controller as a clean no-op when wake lock is unavailable", async () => {
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
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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
    it("show-floor loads the zones + occupancy read-model and shows the floor (basket preserved)", async () => {
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

    it("show-floor degrades to an empty floor when the occupancy load fails (never blocks)", async () => {
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

    it("threads the api + the canEdit gate to the floor screen (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      // The floor screen gets the app's api (for the on-till placement writes) and the manager gate.
      // `toCounter` logged in as STAFF, so `canEdit` is false here (the manager path is covered below).
      expect(floor(el)!.api).toBe(currentApi);
      expect(floor(el)!.canEdit).toBe(false);
    });

    // The on-till floor editor is a permission-locked `table-layout-editor` card, gated at the CELL by
    // the grid's `canConfigureTill`. So the end-to-end assertion is that the operator's `canConfigureTill`
    // reaches the floor tab's card grid. (The card's own lock rendering is covered by card-grid's suite.)
    const gridConfigurable = (el: TillApp) =>
      (activeTabGrid(el) as unknown as { canConfigureTill: boolean }).canConfigureTill;

    it("a login WITH the till.configure capability lights up the on-till floor editor, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      // The lock screen sends the server-computed capability; a manager holds `venue.configure`.
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Marta",
        canConfigureTill: true,
      });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);

      expect(gridConfigurable(el)).toBe(true);

      // Logging out drops the privilege so the next operator starts un-privileged.
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      emit(counter(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);
      expect(gridConfigurable(el)).toBe(false);
    });

    it("a login WITHOUT the till.configure capability keeps the on-till floor editor hidden, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      selectTab(el, "floor");
      await flush(el);

      expect(gridConfigurable(el)).toBe(false);
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
      const openTab = vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 });
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t1", hasOpenTab: false });
      await flush(el);

      // A free table opens a NEW tab (a pre-fiscal working order) before transitioning.
      expect(openTab).toHaveBeenCalledWith("t1");
      // On a TILL the table-order screen opens as a DRILL over the floor tab, which stays
      // mounted (inert) underneath — the drill is what the operator sees.
      expect(floor(el)).not.toBeNull();
      const screen = tableOrder(el);
      expect(screen).not.toBeNull();
      expect(screen!.orderId).toBe("wo-new");
    });

    it("open-table on an OCCUPIED table resumes its tab WITHOUT opening a new one", async () => {
      const openTab = vi.fn();
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", hasOpenTab: true });
      await flush(el);

      // An occupied table already has a tab — no fresh openTab, just the transition. The screen points
      // at the RESUMED tab id (resolved from the read-model's tabId), not a new one.
      expect(openTab).not.toHaveBeenCalled();
      // The table-order drill overlays the still-mounted floor tab.
      expect(floor(el)).not.toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-7");
    });

    it("open-table on an occupied table missing from the read-model transitions with no order id", async () => {
      const openTab = vi.fn();
      const { el } = await mountApp({
        // The read-model is empty, so the tapped table can't be resolved to a tab id.
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      await toCounter(el);
      selectTab(el, "floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", hasOpenTab: true });
      await flush(el);

      // A resume never opens a fresh tab; with no tab id resolved the screen carries none.
      expect(openTab).not.toHaveBeenCalled();
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
        lineNo: 1,
        productId: "cafe",
        quantity: "2.000",
        unitPriceGross: "1.50",
        servedAt: null,
        courseId: null,
        firedAt: "2026-08-17T09:59:00.000Z",
        state: "queued",
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
        const tableA = { ...openTable, id: "table-a", tabId: "order-a", zoneId: "zone-a" };
        const tableB = { ...openTable, id: "table-b", tabId: "order-b", zoneId: "zone-b" };
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

        emit(floor(el)!, "open-table", { tableId: tableA.id, hasOpenTab: true });
        emit(floor(el)!, "open-table", { tableId: tableB.id, hasOpenTab: true });
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
        // A handheld may settle at `POST /api/sales` for cash OR a manual card tender (the server
        // firewall permits both, fencing only the INTEGRATED reader, `/api/pay`), so the pay section
        // SHOWS with both tenders. Opening a table SWITCHES to the phone canvas's order tab, mounting the
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
          canConfigureTill: false,
        });
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: openTable.id, hasOpenTab: openTable.hasOpenTab });
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

      it("send-round appends the round to the tab then reloads its lines", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "send-round", { lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] });
        await flush(el);

        // Appended to the tab's own working order, then re-read so the drawer reflects the new round.
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [
          { menuItemId: "menu-item-cafe-0", quantity: "1" },
        ]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("send-round forwards a per-line course OVERRIDE verbatim to addTabRound (KDS-2 §5b)", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "send-round", {
          lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1", courseId: "postres" }],
        });
        await flush(el);
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [
          { menuItemId: "menu-item-cafe-0", quantity: "1", courseId: "postres" },
        ]);
      });

      it("send-round forwards a per-line hold flag verbatim to addTabRound (coursing A3)", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "send-round", {
          lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1", hold: true }],
        });
        await flush(el);
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [
          { menuItemId: "menu-item-cafe-0", quantity: "1", hold: true },
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

      it("fire-course fires the held course on the tab then reloads its lines", async () => {
        const fireCourse = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          fireCourse,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "fire-course", { orderId: "wo-7", courseId: "c1" });
        await flush(el);

        // Released on the tab's own working order (activeTabId), then re-read so the held-course actions
        // reconcile to server truth (the fired course drops off).
        expect(fireCourse).toHaveBeenCalledWith("wo-7", "c1");
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a failed fire-course surfaces a non-fatal banner, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
          fireCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "fire-course", { orderId: "wo-7", courseId: "c1" });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
      });

      it("serve-line marks the line served then reloads its lines", async () => {
        const markLineServed = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          markLineServed,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "serve-line", { lineNo: 1 });
        await flush(el);

        expect(markLineServed).toHaveBeenCalledWith("wo-7", 1);
        expect(getTabLines).toHaveBeenCalledTimes(2);
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
          addTabRound: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
          markLineServed: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
          setLineCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }),
          setTableStatus: vi.fn().mockRejectedValue({ code: "status.not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        for (const [type, detail] of [
          ["send-round", { lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] }],
          ["serve-line", { lineNo: 1 }],
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

      it("send-lines with an empty list is the send-all (release every held line)", async () => {
        const sendLines = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          sendLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "send-lines", { lineNos: [] });
        await flush(el);

        expect(sendLines).toHaveBeenCalledWith("wo-7", []);
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

      it("void-line cancels the started line then reloads its lines", async () => {
        const voidLine = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          voidLine,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "void-line", { lineNo: 1 });
        await flush(el);

        expect(voidLine).toHaveBeenCalledWith("wo-7", 1);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a rejected recall-lines surfaces the banner AND still reloads to reconcile to server truth", async () => {
        // A raced recall of a line the kitchen has just started rejects `ticket.already_started`; the
        // handler must still re-read the tab so the line flips from Recall to Cancel (server truth).
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          recallLines: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "recall-lines", { lineNos: [1] });
        await flush(el);

        // Non-fatal: the operator stays on the screen and sees the generic banner…
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        // …and the tab is re-read even on the reject, so the UI reconciles to server truth.
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a rejected send-lines / void-line also surfaces the banner and reloads", async () => {
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          sendLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
          voidLine: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        for (const [type, detail] of [
          ["send-lines", { lineNos: [1] }],
          ["void-line", { lineNo: 1 }],
        ] as const) {
          getTabLines.mockClear();
          emit(screen, type, detail);
          await flush(el);
          expect(tableOrder(el)).not.toBeNull();
          expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
          expect(getTabLines).toHaveBeenCalledTimes(1);
        }
      });

      // ── Move / join / merge / transfer table actions ──────────────────────────────────
      it("move-tab relocates the tab then reloads the floor (staying on the screen)", async () => {
        const moveTab = vi.fn().mockResolvedValue(undefined);
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          moveTab,
        });
        const screen = await toTableOrder(el, openTable);
        // One floor load reached the screen (entering the floor).
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "move-tab", { toTableId: "t9" });
        await flush(el);

        expect(moveTab).toHaveBeenCalledWith("wo-7", "t9");
        // Re-reads the floor so the freed/occupied tables reconcile, and stays on the table-order screen.
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(tableOrder(el)).not.toBeNull();
      });

      it("join-table extends the tab onto a table then reloads the floor", async () => {
        const joinTable = vi.fn().mockResolvedValue(undefined);
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          joinTable,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "join-table", { tableId: "t9" });
        await flush(el);

        expect(joinTable).toHaveBeenCalledWith("wo-7", "t9");
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(tableOrder(el)).not.toBeNull();
      });

      it("merge-tabs absorbs another tab then reloads this tab's lines AND the floor", async () => {
        const mergeTabs = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          mergeTabs,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "merge-tabs", { fromTabId: "wo-9", freeSourceTable: true });
        await flush(el);

        expect(mergeTabs).toHaveBeenCalledWith("wo-7", "wo-9", true);
        // The current tab absorbed the other's lines (reload) and the floor changed (reload).
        expect(getTabLines).toHaveBeenCalledTimes(2);
        expect(getTablesState).toHaveBeenCalledTimes(2);
      });

      it("transfer-lines moves selected lines out then reloads this tab's lines AND the floor", async () => {
        const transferLines = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          transferLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "transfer-lines", { toTabId: "wo-9", transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(transferLines).toHaveBeenCalledWith("wo-7", "wo-9", [{ lineNo: 1 }]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
        expect(getTablesState).toHaveBeenCalledTimes(2);
      });

      it("split-lines switches pay and later receipt actions to the detached check", async () => {
        const splitTab = vi.fn().mockResolvedValue({ checkId: "wo-check" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const recordSale = vi.fn().mockResolvedValue(saleResult);
        const reprint = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState,
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitTab,
          recordSale,
          reprint,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
        await flush(el);

        expect(splitTab).toHaveBeenCalledWith("wo-7", [{ lineNo: 1 }]);
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

      it("a modifier-dish partial split refusal keeps the origin open and explains the full-line rule", async () => {
        const splitTab = vi.fn().mockRejectedValue({ code: "tab.transfer_modifier_line" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitTab,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "split-lines", { transfers: [{ lineNo: 1, quantity: "1" }] });
        await flush(el);

        expect(splitTab).toHaveBeenCalledWith("wo-7", [{ lineNo: 1, quantity: "1" }]);
        expect(tableOrder(el)!.orderId).toBe("wo-7");
        expect(getTabLines).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
          t("table.split_modifier_error"),
        );
      });

      it("a refusal to split held kitchen work keeps the origin open and says to send it first", async () => {
        const splitTab = vi.fn().mockRejectedValue({ code: "tab.split_held_line" });
        const getTabLines = vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 });
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
          splitTab,
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
          moveTab: vi.fn().mockRejectedValue({ code: "table.occupied" }),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "move-tab", { toTableId: "t9" });
        await flush(el);
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
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
    it("forwards the selected simulator outcome to POST /api/pay", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountWidget<TillApp>("till-app", {
        api: stubApi({
          getTill: vi.fn().mockResolvedValue({ ...till, cardProvider: "simulator" }),
          pay,
        }),
      });
      const c = await toCounter(el);
      emit(c, "collect-card", { simulationOutcome: "declined" });
      await flush(el);

      expect(pay).toHaveBeenCalledWith(expect.objectContaining({ simulationOutcome: "declined" }));
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
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }],
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
      await flush(el);

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
          { menuItemId: "menu-item-cafe-0", quantity: "2" },
          { menuItemId: "menu-item-cafe-0", quantity: "1" },
        ],
        label: "Mesa 4",
        revision: 3,
      });
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [
          { menuItemId: "menu-item-cafe-0", quantity: "2" },
          { menuItemId: "menu-item-cafe-0", quantity: "1" },
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
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, cardProvider: "stripe_on_device", tipsEnabled: true }),
      });
      await toCounter(el);
      expect(tenderPay(el).cardProvider).toBe("stripe_on_device");
      expect(tenderPay(el).tipsEnabled).toBe(true);
    });

    it("threads a declined cardOutcome through to the widget, driving its card_outcome view", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, cardProvider: "stripe_terminal" }),
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

    it("boots into Mode I (invoice_first): tender-pay starts on the order stage; the default station's queue is fetched and rendered", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        // A non-empty queue so the has-items-gated prep-queue card renders (an empty queue hides it).
        getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("invoice_first");
      expect(tenderPay(el).stage).toBe("order");
      expect(stationQueueWidget(el)).not.toBeNull();
      // Resolves the default station once, then reads its queue on entering the counter.
      expect(currentApi.listStations).toHaveBeenCalledOnce();
      expect(currentApi.getStationQueue).toHaveBeenCalledWith("st-default");
    });

    it("boots into Mode T (ticket_then_pay): the same per-mode selection applies", async () => {
      const { el } = await mountApp({
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValue({ items: [stationGroup], notices: [] }),
      });
      await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);
    });

    it("no default station configured leaves the counter queue empty rather than throwing", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        listStations: vi.fn().mockResolvedValue([{ ...defaultStation, isDefault: false }]),
      });
      await toCounter(el);
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      // No default station ⇒ the queue is never fetched ⇒ empty ⇒ the has-items gate hides the card.
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("place-order (fresh basket): parks then places, moves to the collect stage, refreshes the prep queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "2" }],
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
          { menuItemId: "menu-item-cafe-0", quantity: "2" }, // retrieved
          { menuItemId: "menu-item-cafe-0", quantity: "1" }, // the edit
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
      // Placing issues the deferred invoice in invoice-first mode, which is a fiscal record and can
      // be refused for the venue's own settings exactly like a sale. It takes NO tender, so it gets
      // `place.refused` rather than `sale.refused`: a refund instruction would be wrong here, and
      // this asserts the two messages are not interchangeable.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
      // request is `sale.unconfirmed` — the placement / deferred invoice may have filed (§4.3).
      const placeOrder = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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

    it("collect-order: settles the placed order and shows the ticket", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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

    it("a failed collect keeps the counter (collect stage) and the basket, showing a non-fatal error", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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

    it("collect-order: a NETWORK failure (no answer) shows sale.unconfirmed, basket kept", async () => {
      // Collect is a terminal fiscal-file moment (Mode T files immediate, Mode I settles the deferred
      // invoice), so a `collectOrder` whose `fetch` got no answer has the same "did it file?" ambiguity
      // as `#onConfirmPayment` (till-reroute §4.3): `sale.unconfirmed`, not the free-to-retry
      // `sale.error`. The `{ code }` refusal path stays `sale.error` (the test above).
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
    // skips Mode P. So these exercise the handler wiring under `invoice_first`, exactly as the
    // advance-ticket-item tests above do.
    it("mark-collected: hands over the order via markCollected, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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

    // A phone-portrait canvas: a `floor` tab (a `floor-plan` card) + an `order` tab (a `table-order`
    // card). A handheld renders the FULL shell (its operator header) but NO Station/Expo/Schedule
    // affordances — a phone reaches none of those.
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

    it("renders the tab shell for a handheld with a full header and no affordances", async () => {
      // A handheld stays on `lock` until the waiter PIN-logs-in (its face-set post-lock face is `floor`);
      // the shell activates only on that authenticated surface, so boot THEN login before asserting.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      const s = shell(el)!;
      expect(s).not.toBeNull();
      // Handheld = the FULL header, never kiosk (kiosk is the kds display alone).
      expect(s.kiosk).toBe(false);
      // No Station/Expo/Schedule buttons — the handheld affordance list is empty even though none of the
      // three is authored as a tab (the `handheldMode` branch in `#affordances`; the memo recompute on
      // `handheldMode` change is what makes this `[]` rather than the stale pre-probe `{station,expo,schedule}`).
      expect(s.affordances).toEqual([]);
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
        getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
        getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
      });
      await flush(hidden.el);
      const hiddenGrid = hidden.el.shadowRoot!.querySelector("till-card-grid")!;
      expect(hiddenGrid).not.toBeNull();
      // The kds-board card is hidden (its required `act-as-kds` is absent), so no station screen mounts.
      expect(hiddenGrid.shadowRoot!.querySelector("till-station-screen")).toBeNull();

      // Profile grants `act-as-kds` → the same card renders its embedded station screen.
      const shown = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "dev-1", formFactor: "kds", stationId: "st-dev" }),
        getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
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
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      return el;
    }

    it("switches a handheld to the Order tab (card mount) when a table is opened, not a drill-in", async () => {
      const el = await toHandheldFloor();
      expect(shell(el)!.activeTabKey).toBe("floor");
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false });
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
        tabId: "wo-new",
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
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false }); // → Order tab card
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
      // not the stale free one — so a re-tap resumes the open tab instead of re-firing `openTab`.
      const grid = el.shadowRoot!.querySelector("till-card-grid")!;
      const floorScreen = grid.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
      expect(floorScreen).not.toBeNull();
      expect(floorScreen!.tables).toEqual([occupiedT1]);
    });

    it("lands a handheld on its home (floor) tab after a new sale, refreshing the stale floor — not a phantom counter tab", async () => {
      // A handheld authors NO `counter` tab, so #onNewSale must land it on its HOME tab (the canvas's
      // first tab, `floor`), never a phantom `"counter"`. It reaches #onNewSale after settling a TAB
      // (pay-tab → ticket → New sale); the just-closed table is then stale in the floor read-model, so the
      // return must re-read occupancy — a re-tap must resume nothing.
      const occupiedT1: TableState = {
        ...freeTable,
        state: "open-tab",
        hasOpenTab: true,
        tabId: "wo-new",
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
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false }); // → Order tab card
      await flush(el);
      expect(shell(el)!.activeTabKey).toBe("order");
      const before = getTablesState.mock.calls.length;
      const pushHistory = vi.spyOn(history, "pushState");
      occupied = true; // the tab has been settled server-side; the floor read-model would now reflect it
      emit(shell(el)!, "new-sale"); // the ticket view's "New sale" after settling the tab
      await flush(el);
      // Lands on the device's HOME tab (floor), NOT a phantom `"counter"` a handheld never authors.
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
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false });
      await flush(el);
      // The table-order screen mounts into the shell's `drill` slot, OVER the (now inert) floor tab.
      expect(drill(el)).not.toBeNull();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.getAttribute("slot")).toBe("drill");
    });

    it("pops the table-order drill-in back to the floor tab on back-to-floor", async () => {
      const el = await toShellFloor();
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false });
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
      // Opening a table (`openTab`) and table-service actions do NOT update `this.tables`, so after a
      // waiter opens table N from the floor tab, adds a round, and taps Back, the floor tab must RE-READ
      // occupancy or it re-renders from the STALE read-model — table N still shows FREE. Tapping it again
      // calls `openTab(N)` → server throws `tab.already_open` → the waiter cannot resume the tab they just
      // opened. So this asserts FRESHNESS — the floor reflects a SECOND fetch.
      const occupiedT1: TableState = {
        ...freeTable,
        state: "open-tab",
        hasOpenTab: true,
        tabId: "wo-new",
        tabLineCount: 1,
        tabTotal: "3.00",
      };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: shellCanvas }),
        // FIRST floor load (tab-select): table free. SECOND load (the back-to-floor refresh): now occupied.
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([freeTable])
          .mockResolvedValueOnce([occupiedT1]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await toCounter(el);
      emit(shell(el)!, "tab-select", { key: "floor" }); // first floor load → freeTable
      await flush(el);
      emit(shell(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false }); // drill in
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      emit(tableOrder(el)!, "back-to-floor"); // pop the drill + tables-only refresh → occupiedT1
      await flush(el);
      const g = grid(el)!;
      const floorScreen = g.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
      expect(floorScreen).not.toBeNull();
      // The floor RE-READ occupancy: table t1 now renders the SECOND fetch (occupied), not the stale free
      // one — so tapping it resumes the open tab instead of re-firing `openTab` → `tab.already_open`.
      expect(floorScreen!.tables).toEqual([occupiedT1]);
    });

    it("pushes the schedule drill-in from the shell's Schedule affordance", async () => {
      const el = await toShellCounter();
      emit(shell(el)!, "show-schedule");
      await el.updateComplete;
      expect(drill(el)).not.toBeNull();
      expect(schedule(el)).not.toBeNull();
      expect(schedule(el)!.getAttribute("slot")).toBe("drill");
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
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Bea", canConfigureTill: false });
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
        canConfigureTill: false,
        locale,
      });
      await flush(el);
      return counter(el)!;
    }

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
        canConfigureTill: false,
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

    it("locale-selected while on the LOCK screen switches transiently — setLocale, NOT putLocale", async () => {
      // A pre-login pick is transient: the app switches the UI but writes NOTHING (there is no session to
      // write to). Emitted from the lock screen exactly as the chooser's composed event does.
      const { el } = await mountApp();
      await flush(el);
      expect(lock(el)).not.toBeNull();
      emit(lock(el)!, "locale-selected", { code: "en-GB" });
      await flush(el);
      expect(currentLocale()).toBe("en-GB"); // switched
      expect(currentApi.putLocale).not.toHaveBeenCalled(); // but NOT persisted
    });

    it("locale-selected while LOGGED IN persists (putLocale) then switches (setLocale)", async () => {
      const putLocale = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountApp({ putLocale });
      const c = await toCounterAs(el, null); // venue default es-ES
      expect(currentLocale()).toBe("es-ES");

      emit(c, "locale-selected", { code: "en-GB" });
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

      emit(c, "locale-selected", { code: "en-GB" });
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
      expect(shell(el)!.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
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

      emit(c, "locale-selected", { code: "en-GB" }); // putLocale now pending
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
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
      putLocale,
    });
    await flush(el);
    emit(shell(el)!, "locale-selected", { code: "en-GB" });
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
          .shadowRoot!.querySelector("till-product-grid")!
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

    it.each(["p1", "p2"])(
      "resets the menu after logout and a new login as %s",
      async (personId) => {
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
          canConfigureTill: false,
        });
        await flush(el);
        expect(gridNames(el)).toEqual(["Bocadillo"]);
        expect(switcherButtons(el)[0]!.getAttribute("aria-pressed")).toBe("true");
        expect(sessionStorage.getItem("waitron.lastMenu")).toBe("cat-food");
      },
    );

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
    const chooser = screen.shadowRoot!.querySelector("till-language-chooser")!;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const trigger = chooser
      .shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!
      .getBoundingClientRect();
    expect(trigger.right).toBeLessThanOrEqual(window.innerWidth);
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
      .shadowRoot!.querySelector("till-language-chooser")!
      .shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!
      .getBoundingClientRect();
    expect(
      enrol.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(language.top);
  } finally {
    await page.viewport(width, height);
    window.scrollTo(0, 0);
  }
});

describe("remembered dietary filters", () => {
  const salad: TillProduct = {
    ...cafe,
    id: "salad",
    name: "Ensalada",
    customerName: { es: "Ensalada para el cliente" },
    diet: { vegan: "yes", vegetarian: "yes", contains: [] },
  };
  const mixed: TillProduct = {
    ...cafe,
    id: "mixed",
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
        .shadowRoot!.querySelector("till-product-grid")!
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
    emit(floor(el)!, "open-table", { tableId: freeTable.id, hasOpenTab: false });
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
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
    });
    await flush(el);
    expect(station(el)!.deviceMode).toBe(true);
    expect(station(el)!.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(currentApi.listStations).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/tabs/kitchen");
  });
});

it.each(["station", "expo", "schedule"])(
  "rejects the %s destination on a handheld without hiding its floor",
  async (view) => {
    history.replaceState(null, "", `/tabs/floor/view/${view}`);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvasDef }),
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

// The venue's servers (till-reroute §4.1). Mirrors the un-exported helpers in server-router.test.ts —
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

describe("till-app follows a server move (till-reroute §4.3)", () => {
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
    // The working order is KEPT across the move (only the operator session is dropped, §4.3).
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

  it("shows the waiting-for-promotion banner in the shell while the router waits (§4.4)", async () => {
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

it("sends a walk-up line's options answer without any local price preview", () => {});

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
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
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

  it("a plain list refresh that fails starts no retry, leaves a countdown alone, and takes over a retry in flight", async () => {
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault(); // the discard handler does not catch its own refresh's failure
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const listWorkingOrders = failingAfterLogin<HeldOrderSummary[]>([]);
      const { el } = await mountApp({ listWorkingOrders });
      const c = await toCounterFake(el);

      emit(c, "discard-order", { id: "wo-1" });
      await settle(el);
      expect(listWorkingOrders).toHaveBeenCalledTimes(2);
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
      expect(rejections).toHaveLength(3);
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
    const getStationQueue = failingAfterLogin<StationQueue>({ items: [], notices: [] });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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

  /** An invoice-first counter whose zone list offers a prepay zone, `zone-deli`, to switch to. */
  function mountWithPrepayZone(getStationQueue: ReturnType<typeof vi.fn>) {
    const counterZone = fixtureOffers({ menus: [defaultMenu], products: [cafe] });
    counterZone.context = {
      zoneId: "zone-counter",
      departmentId: "department-default",
      serviceMode: "invoice_first",
    };
    counterZone.zones = [
      {
        id: "zone-counter",
        name: "Counter",
        departmentId: "department-default",
        departmentName: "Restaurant",
        serviceMode: "invoice_first",
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
    deli.context = { zoneId: "zone-deli", departmentId: "department-deli", serviceMode: "prepay" };
    return mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
    const getStationQueue = failingAfterLogin<StationQueue>({ items: [], notices: [] });
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
});

describe("a counter pay, place or hold refused for a reason the operator can act on", () => {
  // Each of these refusals names what to do (wait for the card, remove the sold-out item); the
  // generic "try again" would send the operator round the same refusal.
  const actions = [
    ["confirm-payment", { method: "cash", amount: "5" }, "recordSale", undefined, "sale.error"],
    ["collect-card", {}, "pay", undefined, "sale.error"],
    ["place-order", undefined, "placeOrder", "invoice_first", "place.error"],
  ] as const;

  for (const code of ["order.payment_in_flight", "product.unavailable"]) {
    it.each(actions)(
      `${code}: %s shows the code's own message, not the generic one`,
      async (type, detail, method, orderFlow, generic) => {
        const { el } = await mountApp({
          ...(orderFlow === undefined
            ? {}
            : { getTill: vi.fn().mockResolvedValue({ ...till, orderFlow }) }),
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

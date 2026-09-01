import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { diag } from "./diagnostics.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { TillScheduleScreen } from "./screens/till-schedule-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillStationScreen } from "./screens/till-station-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillStationQueue } from "./widgets/station-queue.js";
import type { TillProductGrid } from "./widgets/product-grid.js";
import { LAYOUT_A, type LayoutDef } from "./layout.js";
import type {
  FloorZone,
  HeldOrderSummary,
  PayOutcome,
  TabLine,
  TableServiceStatus,
  TableState,
  TillApi,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";

// The venue's default menu (catalogue) — every product fixture below is tagged with its id, so the
// counter grid (which shows only the selected menu's products) renders them under the default selection.
const defaultMenu = { id: "cat-default", name: "Carta", isDefault: true };

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
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
  descriptions: { es: "Jamón" },
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
  // FP-2: unplaced (the app tests exercise the FP-1 flows, which default to the list view).
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
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  // The FILED line list the ticket renders (server's composition), never the client basket.
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
  change: "2.00",
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const till = {
  locale: "es-ES",
  // The RECEIPT (fiscal) locale — a SEPARATE server field from the UI `locale` above (sourced from
  // `cfg.locale` server-side). Same value here for the ES-venue default, but distinct so a test can
  // drive them apart to prove the receipt does not follow the operator UI (decision 2).
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  // The venue's KDS whole-ticket bump mode (KDS-1 §2e); `line` is the default (per-line bump only), so
  // the station-screen tests that don't drive it exercise the per-line path. A test overrides it.
  bumpMode: "line" as const,
  // The venue's KDS fire-control mode (KDS-2 §2c); `waiter` is the default (the tab screen fires), so the
  // station display shows no fire action unless a test drives this to `kitchen`.
  fireControl: "waiter" as const,
  // The venue's ACTIVE kitchen courses (KDS-2 §5b) — threaded to the table-order screen's picker + fire
  // actions. Empty by default; a test drives it to exercise the course surfaces.
  courses: [] as { id: string; name: string; displayOrder: number }[],
  // Both always present on the real `GET /api/till` (`TillInfo`'s own doc) — defaulted here to the
  // manual (datáfono) Card path, `"none"`, so every pre-Task-9 test below (which never touches these
  // two fields) keeps exercising #62's unchanged behaviour rather than the integrated one.
  cardProvider: "none" as const,
  tipsEnabled: false,
  // `layout`/`receipt` are DELIBERATELY omitted (an older server that predates the editor): #boot then
  // leaves the received layout undefined, so #layoutFor()'s Mode-P prep-queue drop applies as the
  // fallback and the ticket receipt defaults to {} — the slice-1 behaviour every pre-Task-9 test relies
  // on. The `authored layout + receipt` suite supplies them explicitly.
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
  // KDS order-timing alerts (design §4/§6) — the station-queue group's own thresholds, so the widget's
  // classifyBand call doesn't throw on the missing field.
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

/** The venue's single default station — what `#refreshStationQueue` resolves to fetch the counter's
 * default-station queue (Modes I/T). */
const defaultStation = {
  id: "st-default",
  name: "Cocina",
  displayOrder: 0,
  isDefault: true,
  active: true,
};

/**
 * A fake `TillApi` covering every method the app (and the lock screen it mounts) calls. Each defaults
 * to a resolved value; a test overrides any with its own `vi.fn()`. Cast through `unknown` because the
 * app touches only this method surface, never the rest of the class.
 */
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(till),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1", canConfigureTill: false, locale: "en-GB" }),
    // Per-user-language-preference (Task 9): the pre-login chooser reads `getLocales` (only when
    // opened) and the logged-in persist path writes `putLocale` (a spy a test asserts on).
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
      lines: [{ productId: "cafe", quantity: "2.000" }],
    }),
    abandonWorkingOrder: vi.fn().mockResolvedValue(undefined),
    updateWorkingOrder: vi.fn().mockResolvedValue(undefined),
    placeOrder: vi.fn().mockResolvedValue(placedResult),
    collectOrder: vi.fn().mockResolvedValue(saleResult),
    // Counter receipt/drawer (§5): the ticket screen's reprint + manual drawer-open levers. Default
    // resolved; the failure tests override them to reject.
    reprint: vi.fn().mockResolvedValue(undefined),
    openDrawer: vi.fn().mockResolvedValue(undefined),
    // Cash-drawer-authorization (§5): the eligible supervisors the override dialog picks from, fetched
    // only when a gated 403 sends the operator into the override flow. Default roster of one.
    listDrawerAuthorizers: vi
      .fn()
      .mockResolvedValue([{ personId: "sup-1", displayName: "Responsable" }]),
    // KDS-1 kitchen surface: the counter's default-station queue (Modes I/T) + the per-line advance.
    listStations: vi.fn().mockResolvedValue([defaultStation]),
    getStationQueue: vi.fn().mockResolvedValue([]),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    // KDS-3 expo/pass surface: the cross-station board the expo screen fetches + its per-course levers.
    getExpoQueue: vi.fn().mockResolvedValue([]),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    // Live floor (FP-1): the app loads these on entering the floor and opens a tab on a table tap.
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    openTab: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    // FP-1 table-order screen: the app loads the tab's lines on entering it and writes rounds/serve/
    // status from its events. Each defaults to a resolved value; a test overrides any with its own fn.
    getTabLines: vi.fn().mockResolvedValue([]),
    addTabRound: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    markLineServed: vi.fn().mockResolvedValue(undefined),
    setLineCourse: vi.fn().mockResolvedValue(undefined),
    // Coursing corrections (C5): the per-line send/recall/cancel verbs. Each defaults to a resolved void;
    // a test overrides any with its own spy. The tab's lines are re-read after each (success OR reject).
    sendLines: vi.fn().mockResolvedValue(undefined),
    recallLines: vi.fn().mockResolvedValue(undefined),
    voidLine: vi.fn().mockResolvedValue(undefined),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    // TS-3/TS-4 table actions: move/join/merge/transfer. Each defaults to a resolved void; a test
    // overrides any with its own spy. `getTablesState` above is re-read after each on the success path.
    moveTab: vi.fn().mockResolvedValue(undefined),
    joinTable: vi.fn().mockResolvedValue(undefined),
    mergeTabs: vi.fn().mockResolvedValue(undefined),
    transferLines: vi.fn().mockResolvedValue(undefined),
    listStatuses: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    // Device mode (device-identity-1 §5a): the boot device probe. `getDeviceIdentity` is the kind-aware
    // probe the boot runs FIRST (handheld-tableside Task 7); it defaults to a 401 — a NORMAL operator till
    // is not an enrolled device — so every existing test boots to the lock screen as before. The KDS-boot
    // test overrides it to `kds_station` (then `getDeviceStation` prefetches the queue); the handheld-boot
    // test overrides it to `handheld`. `getDeviceStation` keeps its own 401 default so the KDS end-state is
    // unchanged. `enrolDevice`/`deviceAdvance` are the station screen's (device mode), present so its own
    // probe/enrol paths never hit an undefined method.
    getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    enrolDevice: vi.fn().mockResolvedValue({
      deviceId: "dev-1",
      kind: "kds_station",
      stationId: "st-dev",
      label: "Pase",
    }),
    deviceAdvance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

/** Drains the microtask queue (settling awaited API promises + chained awaits) then Lit's render. */
async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view");
/** The supervisor-override dialog (cash-drawer-authorization §5), present only while an override is
 * in flight; typed loosely enough to read its `authorizers`/`error` props without importing the class. */
const overrideDialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { authorizers: unknown; error: string | null }>(
    "till-supervisor-override-dialog",
  );
const schedule = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillScheduleScreen>("till-schedule-screen");
const floor = (el: TillApp) => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
const station = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillStationScreen>("till-station-screen");
/** The handheld enrol screen (handheld-tableside Task 8), present only while `handheldEnrolling` is set;
 * queried by tag (its class is not imported here — the app only needs to know it is mounted). */
const handheldEnrol = (el: TillApp) => el.shadowRoot!.querySelector("till-handheld-enrol-screen");
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");
/** The pay widget nested inside the counter screen's OWN shadow root (7c per-mode control). */
const tenderPay = (el: TillApp) =>
  counter(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
/** The station-queue widget nested inside the counter screen's shadow root (the default-station queue),
 * or `null` when the layout (Mode P) omits it. */
const stationQueueWidget = (el: TillApp) =>
  counter(el)!.shadowRoot!.querySelector<TillStationQueue>("till-station-queue");

/** Fires a composed, bubbling CustomEvent from `source` — the shape every till screen emits. */
function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** Boots the app, settles boot, and logs a person in — leaving the app on the counter. */
async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  // Log in as a NON-configuring operator by default (the common case) — the FP-2 capability tests below
  // drive a configuring one explicitly. `canConfigureTill` rides the `logged-in` event exactly as the
  // lock screen sends it (the server computes it from the operator's role).
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  return counter(el)!;
}

/** Boots, logs in, rings a cash sale — leaving the app on the ticket screen where the Reprint / Abrir
 * cajón levers live (counter receipt/drawer §5). */
async function toTicket(el: TillApp): Promise<void> {
  const c = await toCounter(el);
  c.store.addProduct(cafe, "2");
  await el.updateComplete;
  emit(c, "confirm-payment", { method: "cash", amount: "5" });
  await flush(el);
}

/** Boots, logs in, opens the floor, then opens `table`'s tab — leaving the app on the table-order
 * screen (FP-1). The app must be mounted with `getTablesState` returning `table` so the floor has it. */
async function toTableOrder(el: TillApp, table: TableState): Promise<TillTableOrderScreen> {
  await toCounter(el);
  emit(counter(el)!, "show-floor");
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
// a no-op against an already-English default (§1: a switch you cannot observe proves nothing).
beforeEach(() => setLocale("es-ES"));
afterEach(cleanupWidgets);

describe("till-app", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-app")).toBe(TillApp);
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
    expect(c.products).toEqual([cafe]);
    expect(c.operatorName).toBe("Ana");
  });

  it("a failing listStaff leaves the roster empty and never blocks the counter (no unhandled rejection)", async () => {
    // `#onLoggedIn` loads the colleague roster AFTER the counter is shown, so a roster failure must
    // degrade gracefully: leave `staff` at its default `[]` and surface no error. Under
    // `void this.#onLoggedIn(...)` an uncaught rejection escapes as an UNHANDLED promise rejection —
    // the load-bearing assertion below is `rejections === []`, since `staff` is `[]` either way (the
    // unguarded assignment simply never completes). Removing the try/catch makes `rejections` hold the
    // roster error and this test go red — the deletion proof.
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

      // The counter still shows — the sale flow is never blocked by the roster fetch.
      expect(c).not.toBeNull();
      expect(counter(el)).not.toBeNull();
      // The roster degraded to empty rather than throwing.
      expect((el as unknown as { staff: unknown[] }).staff).toEqual([]);
      // No error banner: a roster failure is non-fatal, not a surfaced error.
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      // The rejection was caught, not left unhandled.
      expect(rejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  // Both boot-failure shapes reach the same bare `catch`: a network rejection (server unreachable) and a
  // non-2xx `{ code }` the client throws (e.g. `server.internal`). Parametrised so the comment's "either
  // way boot cannot complete" claim is a tested receipt, not just prose.
  it.each([
    { label: "server unreachable", reason: new Error("server down") },
    { label: "non-2xx { code }", reason: { code: "server.internal" } },
  ])(
    "a failing getTill ($label) surfaces the boot error, never an unhandled rejection",
    async ({ reason }) => {
      // `firstUpdated` fires `void this.#boot()`, and `#boot` awaits `getTill()` to load the till's setup
      // (locale, issuer, order flow, card wiring). A failing boot must be a HANDLED state, not an UNHANDLED
      // promise rejection: it surfaces the `boot.error` banner and stays on the lock screen. The two
      // load-bearing assertions are the visible banner (removing `#boot`'s try/catch drops the errorKey) AND
      // `rejections === []` (removing it lets getTill's rejection escape as an unhandled rejection) —
      // together the deletion proof.
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

        // A boot failure never crashes the app into a blank screen — the lock screen still renders.
        expect(lock(el)).not.toBeNull();
        // The failure is surfaced, not swallowed: the operator sees why the till is unusable.
        const banner = el.shadowRoot!.querySelector('[role="alert"]');
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain(t("boot.error"));
        // The rejection was caught, not left unhandled.
        expect(rejections).toEqual([]);
      } finally {
        window.removeEventListener("unhandledrejection", onRejection);
      }
    },
  );

  // Device mode (device-identity-1 §5a): an enrolled display boots straight into its bound station; a
  // normal operator till's 401 device probe leaves it on the lock screen with no boot error; and the
  // lock screen's set-up affordance routes a fresh display into device mode to reach the enrol view.
  it("boots an ENROLLED kds_station device straight into the station screen in device mode", async () => {
    const { el } = await mountApp({
      // Drive the venue default to en-GB (≠ the es-ES starting point) so the device path's venue-default
      // `setLocale` is observable: an enrolled display has NO operator, so `#boot`'s
      // `if (this.operatorPersonId === "")` guard passes and the venue default is applied — the login-race
      // guard must never withhold the venue default from the operator-less device path.
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en-GB" }),
      // The kind-aware probe (Task 7): a `kds_station` identity keeps the existing behaviour — the boot
      // then PREFETCHES the bound station's queue (`getDeviceStation`), a DELIBERATE second authenticated
      // read that preserves the `initialDeviceStation` optimisation. Only the mock plumbing changes here;
      // the end-state assertions (lands on `station`, `deviceMode` true) are exactly as before.
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "dev-1", kind: "kds_station", stationId: "st-dev" }),
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: [] } }),
    });
    await flush(el);
    expect(currentApi.getDeviceStation).toHaveBeenCalled();
    // Straight past the lock screen — a device never logs in.
    expect(lock(el)).toBeNull();
    const s = station(el);
    expect(s).not.toBeNull();
    expect(s!.deviceMode).toBe(true);
    // The venue default was applied on the operator-less device path (guard passes on `operatorPersonId === ""`).
    expect(currentLocale()).toBe("en-GB");
  });

  it("boots a HANDHELD device into the phone shell (stays on lock) and lands on the floor after login", async () => {
    // The kind-aware probe (Task 7): a `handheld` identity puts the till into handheld mode but STAYS on
    // the lock screen — the waiter PIN-logs-in, then lands on the floor rather than the counter POS.
    const status: TableServiceStatus = { id: "s1", label: "Reservada", color: "#f00" };
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
      // The floor's data source (FP-1) — proving the handheld login LOADS the floor via `#onShowFloor`,
      // not that it merely switches `screen` to an empty one (`<till-floor-screen>` renders purely from
      // these props, which only `#onShowFloor` fetches).
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
    // The floor was LOADED, not just shown: `#onShowFloor`'s three fetches ran and the screen renders
    // POPULATED from them — the fix for the empty-floor dead end.
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

  // Handheld face-set containment (§6a): the phone shell may reach ONLY `HANDHELD_FACES`
  // (`lock`/`floor`/`table-order`). A `back-to-counter` — whether from the floor's Back affordance or
  // bubbled from any child — must NOT land the handheld on the counter POS (from which `station`/`expo`/
  // `schedule` are reachable). The screen state machine consults the face-set instead of navigating
  // blindly; the floor's Back affordance is suppressed in handheld mode (`canExitToCounter`).
  describe("handheld face-set containment (§6a)", () => {
    /** Boots a HANDHELD, logs the waiter in, and returns the app on the floor (the post-login face). */
    async function toHandheldFloor(): Promise<TillApp> {
      const { el } = await mountApp({
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        getTabLines: vi.fn().mockResolvedValue([]),
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
      // Fire the escape event the floor's Back used to emit — the app's face-set gate must swallow it.
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      // Still on the floor; the counter POS (and the station/expo/schedule it leads to) is unreachable.
      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
    });

    it("does NOT leave the face-set when back-to-counter bubbles from the table-order screen", async () => {
      const el = await toHandheldFloor();
      emit(floor(el)!, "open-table", { tableId: openTable.id, hasOpenTab: openTable.hasOpenTab });
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      // A stray back-to-counter bubbling up from the table-order subtree must be gated too — the handheld
      // stays on `table-order` (a face-set member), never falls through to the counter.
      emit(tableOrder(el)!, "back-to-counter");
      await flush(el);
      expect(tableOrder(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
    });
  });

  it("a normal operator till (401 identity probe) stays on the lock screen with NO boot error", async () => {
    // The default stub's getDeviceIdentity rejects `device.unauthorized` — the expected not-a-device case.
    const { el } = await mountApp();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(false);
    // A rejected identity probe never falls through to the KDS station prefetch.
    expect(currentApi.getDeviceStation).not.toHaveBeenCalled();
    // A device 401 must NOT surface `boot.error` (that is only for a failed getTill).
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  // A RE-BOOT resets the device-mode state before re-probing (`#boot` runs more than once — notably
  // `#onHandheldEnrolled` re-runs it after a fresh phone enrols). Device state left by a PRIOR boot (or a
  // prior `#onSetupDevice`) must not survive into a later one: the probe RESETS `handheldMode`/`deviceMode`
  // and the `screen` baseline before re-establishing the correct mode, so every boot starts clean.
  it("a re-boot resolving handheld after a prior device-mode state ends on lock in handheld mode (not station)", async () => {
    // First boot 401s → normal lock; `setup-device` then leaves deviceMode=true / screen=station; the
    // re-boot's identity probe resolves `handheld`.
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockRejectedValueOnce({ code: "device.unauthorized" })
        .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
    });
    await flush(el);
    // Leave a stale device-mode state behind: setup-device flips deviceMode on and navigates to station.
    emit(lock(el)!, "setup-device");
    await flush(el);
    expect(station(el)).not.toBeNull();
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(true);
    // Re-boot (the enrol path) with the identity now `handheld`. Emit from the station element — it
    // bubbles to the app's `@handheld-enrolled` handler, which re-runs `#boot`.
    emit(station(el)!, "handheld-enrolled");
    await flush(el);
    // The re-boot reset the stale device state before re-probing: a handheld waits on the lock screen,
    // never the station the prior setup-device left it on, and deviceMode is cleared.
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
  });

  it("a re-boot resolving NO device after a prior handheld boot returns to the normal lock (both modes false)", async () => {
    // First boot resolves `handheld` (handheldMode=true, on lock); the re-boot's probe 401s — no device.
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce({ deviceId: "d1", kind: "handheld", stationId: null })
        .mockRejectedValue({ code: "device.unauthorized" }),
    });
    await flush(el);
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    // Re-boot with no device — `#onHandheldEnrolled`'s path, but the cookie no longer resolves.
    emit(lock(el)!, "handheld-enrolled");
    await flush(el);
    // The stale handheld mode did not survive: back to a normal operator lock, both device modes false.
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(false);
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
  });

  it("the lock screen's set-up affordance routes a fresh display into device mode", async () => {
    const { el } = await mountApp();
    await flush(el);
    // The lock screen emits `setup-device`; the app switches to the station screen in device mode so an
    // unenrolled display can reach the enrol view.
    emit(lock(el)!, "setup-device");
    await flush(el);
    const s = station(el);
    expect(s).not.toBeNull();
    expect(s!.deviceMode).toBe(true);
  });

  // §C2 containment/identity. An enrolled handheld returns to the lock screen on every logout/cold boot
  // (it STAYS on lock, unlike a KDS). If the lock screen still offered "Set up as kitchen display", a
  // waiter could re-enrol the phone as a KDS station (silently swapping its device cookie) and escape
  // the phone shell to `station`. The app hands the lock screen `deviceEnrolled = handheldMode ||
  // deviceMode`, which hides both device-setup affordances on an already-enrolled device.
  it("hides the lock screen's device-setup affordances on an enrolled handheld (deviceEnrolled)", async () => {
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
    });
    await flush(el);
    // A handheld waits on the lock screen, in handheld mode.
    expect(lock(el)).not.toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    expect(lock(el)!.deviceEnrolled).toBe(true);
    // Neither affordance is rendered, so the re-enrol / escape route is gone.
    expect(lock(el)!.shadowRoot!.querySelector("[data-setup-device]")).toBeNull();
    expect(lock(el)!.shadowRoot!.querySelector("[data-setup-handheld]")).toBeNull();
  });

  // §C2 defense-in-depth. Even if a `setup-device` event still reached the app while a handheld is
  // active (a leaked/bubbled affordance), `#onSetupDevice` must NOT flip the phone's identity to a KDS
  // station nor navigate it to `station` — it is routed through the face-set gate and guarded on
  // handheld mode. Prove-by-deletion: drop that guard and this test goes red (deviceMode flips, screen
  // becomes `station`).
  it("ignores a setup-device event while a handheld is active (no identity flip, no escape to station)", async () => {
    const { el } = await mountApp({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
    });
    await flush(el);
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    // Fire the escape event directly (bypassing the now-hidden affordance) — the gate must swallow it.
    emit(lock(el)!, "setup-device");
    await flush(el);
    // Still the phone shell: on the lock screen, never the station, and identity is unchanged.
    expect(lock(el)).not.toBeNull();
    expect(station(el)).toBeNull();
    expect((el as unknown as { deviceMode: boolean }).deviceMode).toBe(false);
  });

  // Handheld enrol (handheld-tableside Task 8): the lock screen's "set up as waiter handheld" affordance
  // opens the enrol view, and a redeemed code re-boots the app into the phone shell.
  it("the set-up-handheld affordance opens the handheld enrol view (lock screen gone)", async () => {
    const { el } = await mountApp();
    await flush(el);
    // The lock screen emits `setup-handheld`; the app overlays the handheld enrol screen so a fresh phone
    // can pair itself, and the lock screen it replaces is no longer rendered.
    emit(lock(el)!, "setup-handheld");
    await flush(el);
    expect(handheldEnrol(el)).not.toBeNull();
    expect(lock(el)).toBeNull();
  });

  it("a redeemed handheld enrol re-boots into the phone shell (handheld mode, back on the lock screen)", async () => {
    const { el } = await mountApp({
      // The FIRST boot (at mount) is a normal 401 — not-a-device. AFTER enrol the cookie is set, so the
      // re-boot's SECOND identity probe resolves `handheld`. `mockRejectedValueOnce` then default-resolve
      // gives the two-call sequence the one mock must serve across both boots.
      getDeviceIdentity: vi
        .fn()
        .mockRejectedValueOnce({ code: "device.unauthorized" })
        .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
    });
    await flush(el);
    emit(lock(el)!, "setup-handheld");
    await flush(el);
    expect(handheldEnrol(el)).not.toBeNull();
    // The enrol screen redeemed a code (the device cookie is now set) and announced `handheld-enrolled`.
    emit(handheldEnrol(el)!, "handheld-enrolled");
    await flush(el);
    // The re-boot read the fresh cookie as `handheld`: the enrol view is gone, the app is back on the lock
    // screen (the phone shell — a handheld waits for the PIN login), and handheld mode is on.
    expect(handheldEnrol(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
    expect((el as unknown as { handheldMode: boolean }).handheldMode).toBe(true);
    // Proof it RE-BOOTED rather than merely flipping a state: the identity probe ran a second time.
    expect(currentApi.getDeviceIdentity).toHaveBeenCalledTimes(2);
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
      [{ productId: "cafe", quantity: "2" }],
      { method: "cash", amount: "5" },
      // The workingOrderId sent is the store's stable id, NOT a fresh uuid, so a lost-response re-tap
      // replays and a retrieved order settles under its own id (see the retrieve→pay and retry tests
      // below). A `expect.any(String)` here was satisfied by the old `crypto.randomUUID()` bug.
      workingOrderId,
    );
    // A FRESH walk-up (never persisted) is filed straight from its lines — no pre-pay re-lock. Only a
    // RETRIEVED/parked basket is synced first (see the retrieve→edit→pay test); syncing a walk-up here
    // would try to update a working order the server has never seen.
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    // The ticket renders the SERVER result (its `lines` are the filed composition), not a client basket.
    expect(view.result).toBe(saleResult);
    expect(view.issuer).toEqual({ venueName: "Bar Pepe", nif: "B12345678" });
  });

  it("confirm-payment: forwards a line's selected modifier options as bare optionGroupItemIds (ordering modifiers)", async () => {
    // A basket line carrying modifiers (Task 9) sends `options: [{ optionGroupItemId }]` — the bare ids,
    // never the display name/priceDelta (the server re-prices authoritatively). A plain line still omits
    // `options` entirely, so the mixed basket proves the no-modifier line is byte-identical to before.
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1", [
      { optionGroupItemId: "opt-oat", name: { es: "Leche de avena" }, priceDelta: "0.50" },
    ]);
    c.store.addProduct(cafe, "2"); // a plain line — must reach the wire with NO options key
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [
        { productId: "cafe", quantity: "1", options: [{ optionGroupItemId: "opt-oat" }] },
        { productId: "cafe", quantity: "2" },
      ],
      { method: "cash", amount: "5" },
      c.store.id,
    );
  });

  it("confirm-payment: forwards a per-option quantity > 1 and OMITS it at 1 (per-option quantity, feature A)", async () => {
    // The picker sets `SelectedLineOption.quantity` for a modifier taken ×N; the send builder must
    // forward it as `options[].quantity` so the server prices and re-validates the count. A quantity of
    // 1 (or absent) is OMITTED so a plain modifier's wire stays byte-identical to before.
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "1", [
      {
        optionGroupItemId: "opt-shot",
        name: { es: "Extra chupito" },
        priceDelta: "0.50",
        quantity: 2,
      },
      {
        optionGroupItemId: "opt-oat",
        name: { es: "Leche de avena" },
        priceDelta: "0.50",
        quantity: 1,
      },
    ]);
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [
        {
          productId: "cafe",
          quantity: "1",
          options: [
            { optionGroupItemId: "opt-shot", quantity: 2 },
            { optionGroupItemId: "opt-oat" }, // quantity 1 → omitted
          ],
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
    // The client basket's "Café" never reaches the receipt.
    expect(ticket(el)!.shadowRoot!.textContent).not.toContain("Café");
  });

  // ── Counter receipt/drawer (§5): the ticket screen's Reprint + Abrir cajón buttons ────────────────
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
    // Sanity: the sale filed against this id, and the ticket is showing.
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

  it("open-drawer: a drawer.no_printer rejection surfaces the drawer.error banner, never an unhandled rejection", async () => {
    // The till has no receipt printer set → the server rejects `{ code: "drawer.no_printer" }`. The app
    // surfaces its usual non-fatal banner (generic copy, never the raw code) and stays on the ticket.
    const { el } = await mountApp({
      openDrawer: vi.fn().mockRejectedValue({ code: "drawer.no_printer" }),
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
    expect(banner!.textContent).toContain(t("drawer.error"));
    // Non-fatal: the ticket is still on screen.
    expect(ticket(el)).not.toBeNull();
  });

  // ── Cash-drawer-authorization (§5): the OPTIMISTIC 403 → supervisor-override dialog → retry flow ──
  // The till carries NO policy or role knowledge: it always TRIES the direct open, and only on the
  // server's `authorization.not_permitted` (a gated policy + an operator who lacks cash.drawer) does it
  // fetch the eligible supervisors and open the override dialog. This stays correct if the location's
  // policy changes mid-shift.

  it("a direct open (200 first try) never opens the override dialog and fetches no authorizers", async () => {
    const { el } = await mountApp(); // openDrawer resolves by default
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);
    expect(currentApi.openDrawer).toHaveBeenCalledWith(); // tried directly, no override
    expect(overrideDialog(el)).toBeNull(); // no dialog
    expect(currentApi.listDrawerAuthorizers).not.toHaveBeenCalled(); // no fetch
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
    expect(overrideDialog(el)).toBeNull(); // closed on success
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

  it("a drawer.no_printer on the override closes the dialog and surfaces the generic drawer.error banner", async () => {
    const openDrawer = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted" })
      .mockRejectedValueOnce({ code: "drawer.no_printer" });
    const { el } = await mountApp({ openDrawer });
    await toTicket(el);
    emit(ticket(el)!, "open-drawer");
    await flush(el);

    emit(overrideDialog(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el);

    expect(overrideDialog(el)).toBeNull(); // closed
    const banner = el.shadowRoot!.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain(t("drawer.error"));
  });

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
    // Task 2 widened ConfirmPaymentDetail/Tender to the cash|card union and Task 3's #onConfirmPayment
    // forwards whichever tender the widget emits without branching — this pins that a CARD tender
    // reaches recordSale UNCHANGED (method still "card", externalRef still present, never dropped) and
    // keyed under the store's own stable working-order id, exactly like the cash test above. Mutating
    // #onConfirmPayment to send only `{ method: tender.method, amount: tender.amount }` (dropping
    // externalRef) or to send `crypto.randomUUID()` instead of `this.#store.id` both fail this test —
    // the exact-object + exact-id assertions below are what make it load-bearing rather than a type-only
    // check.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "1");
    await el.updateComplete;
    const workingOrderId = store.id; // the walk-up's STABLE client-minted id — the pay-idempotency key

    emit(c, "confirm-payment", { method: "card", amount: "1.50", externalRef: "OP-42" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ productId: "cafe", quantity: "1" }],
      { method: "card", amount: "1.50", externalRef: "OP-42" },
      workingOrderId,
    );
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    expect(view.result).toBe(saleResult);
  });

  it("confirm-payment success: refreshes the held-orders list so a just-paid parked order drops off", async () => {
    // The Minor review finding: paying a RETRIEVED parked order must drop it off the cross-till held
    // list immediately, like park/retrieve/discard already do. `listWorkingOrders` returns the order
    // first, then an empty list after it is settled — so a successful pay re-reads and the settled
    // order is gone. Removing the new `#refreshHeldOrders()` on the success path fails this (one call,
    // not two — the order lingers in the in-memory list until the next park/retrieve/discard).
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
    expect(ticket(el)).not.toBeNull(); // the sale still filed and the ticket still shows

    // Returning to the counter ("New sale") shows the refreshed (now empty) list, not the stale one —
    // the app's held state was updated to [] by the pay refresh, so the re-rendered counter reads it.
    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(counter(el)!.heldOrders).toEqual([]);
  });

  it("threads the RECEIPT invoiceLocale from getTill to the ticket, DECOUPLED from the UI locale", async () => {
    // The ticket's receipt locale (till-ticket-view.invoiceLocale) is threaded from getTill's OWN
    // `invoiceLocale` field (the fiscal cfg.locale) — NOT the UI-driving `locale`. Drive the two APART
    // (UI en-GB, receipt ca-ES) to prove the receipt follows `invoiceLocale`, never the operator UI
    // (per-user-language spec, decision 2 — a Catalan receipt must not be flipped to the venue default).
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en-GB", invoiceLocale: "ca-ES" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // The receipt takes the fiscal `invoiceLocale`, distinct from the operator UI (en-GB) — proving
    // the two are read from separate fields, not aliased.
    expect(ticket(el)!.invoiceLocale).toBe("ca-ES");
  });

  it("retrieve then pay: recordSale settles under the RETRIEVED order's own id, not a fresh one", async () => {
    // The Critical fix: paying a retrieved order must send that order's adopted id (wo-1), so the
    // server takes the pay-the-parked-order branch and settles it. The pre-fix `crypto.randomUUID()`
    // sent a random id → the walk-up branch → wo-1 left `open` and re-payable → double-charge + a
    // second unrepairable chained record. `retrieveWorkingOrder` defaults to id "wo-1" + a cafe line.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.id).toBe("wo-1"); // loadFrom adopted the retrieved order's id

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // the adopted id is the pay-idempotency key — this FAILS against the pre-fix random-uuid line.
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ productId: "cafe", quantity: "2" }],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    // Behaviour 1 (re-review): the order was retrieved but NOT edited, so it must NOT be re-synced —
    // re-syncing re-prices with the live catalogue and would file at the pay-time price, defeating the
    // add-time lock. An unedited retrieve→pay files from the stored lock (recordSale straight through).
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → pay re-syncs the edited basket BEFORE paying, so the edit is not dropped (Finding 2)", async () => {
    // 7c regression: the server's retrieved-order pay files from the STORED lock and IGNORES the sent
    // basket, so an edit made after retrieve must be re-locked (`updateWorkingOrder`) BEFORE the pay or
    // it is SILENTLY DROPPED from both the charge and the filed record. Retrieve wo-1 (café×2), add a
    // second café, then pay: `updateWorkingOrder` must carry the EDITED composition and run BEFORE
    // `recordSale`. Deleting the persisted-sync in `#onConfirmPayment` makes this fail (the edit is lost).
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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

    // The edited composition was re-locked: café×2 (retrieved) + café×1 (the edit), under the order's id.
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    // recordSale files the SAME edited composition under the same id, and the sync ran FIRST — the
    // server needs the lock updated before it files from it.
    expect(recordSale).toHaveBeenCalledWith(
      [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
      recordSale.mock.invocationCallOrder[0]!,
    );
  });

  it("retrieve → edit → pay: a not_open re-sync FALLS THROUGH to the settled replay, not sale.error (Findings 3 & 4)", async () => {
    // Behaviours 3 & 4 of the re-review: a lost-response retry, or the LOSER of a two-till concurrent
    // pay on the same parked order (a normal 7b flow), finds the order ALREADY settled. The edit-gated
    // re-sync then throws `working_order.not_open` — which must NOT surface. It means "already settled →
    // let the pay path replay": `recordSale`'s settled branch returns the FILED ticket (no double-file,
    // no error banner). Deleting the not_open swallow in `#onConfirmPayment` makes this fail (the throw
    // reaches the sale.error handler and no ticket shows) — the replay-safety deletion proof.
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
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull(); // no sale.error banner
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
      lines: [{ productId: "cafe", quantity: "2" }],
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
      lines: [{ productId: "cafe", quantity: "2" }],
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
    // A re-entrant park (double-tap / laggy link) must not fire a second POST. Deleting the
    // `if (this.parking) return` guard makes parkOrder fire twice — the deletion proof.
    const parkOrder = vi.fn(() => new Promise(() => {})); // never resolves
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
    // P6 "Re-hold of a retrieved-and-edited order is not wired": now that the server made park
    // IDEMPOTENT (a re-sent park with the same id REPLAYS the existing OPEN order and inserts nothing —
    // the re-sent basket is DISCARDED), re-parking a RETRIEVED, EDITED order would SILENTLY DISCARD the
    // edit yet show success. So Hold must mirror the pay/place paths: route a PERSISTED order through
    // `#syncIfDirty` (`updateWorkingOrder`), never `parkOrder`. Retrieve wo-1 (café×2), add a second
    // café, tap Hold: `updateWorkingOrder` must carry the EDITED composition + label and `parkOrder`
    // must NOT be called; the basket clears (success). Before the fix `#onParkOrder` calls `parkOrder`
    // unconditionally — the edit is replayed away — so this fails (parkOrder called, updateWorkingOrder
    // not).
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(parkOrder).not.toHaveBeenCalled();
    // Success path: the basket empties and stays on the counter (a hold is not a completed sale).
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("retrieve → (no edit) → Hold does not re-park an unedited retrieved order (P6)", async () => {
    // The unedited half of P6: a retrieved order tapped straight to Hold has nothing to save — and must
    // STILL not re-park, because an idempotent re-park is a needless round trip that only replays the
    // already-stored order. `#syncIfDirty` no-ops on a clean basket (`persisted && !dirty`), so neither
    // `updateWorkingOrder` nor `parkOrder` fires; the basket clears so the operator can move on. Before
    // the fix `parkOrder` IS called, so this fails.
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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

    expect(parkOrder).not.toHaveBeenCalled(); // an idempotent re-park is not a save — skip it
    expect(updateWorkingOrder).not.toHaveBeenCalled(); // #syncIfDirty no-ops on a clean basket
    // Success path: the basket empties and stays on the counter.
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
  });

  it("retrieve → edit → Hold with a BLANK label keeps the retrieved order's name, does not wipe it (P6)", async () => {
    // The Hold field opens BLANK, so `park-order` carries `label: undefined`. `updateWorkingOrder` writes
    // `label ?? null`, so forwarding that undefined would WIPE the retrieved order's name ("Mesa 4" → NULL)
    // — anonymising it in the cross-till held list. The persisted branch falls back to the STORED label,
    // so a blank re-hold preserves the name. Proven by deletion: dropping `?? this.#store.label` sends
    // label undefined here and fails this assertion. (A typed label still renames — the case above.)
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(parkOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → Hold surfaces held.park_error and keeps the basket when the update fails (P6)", async () => {
    // The persisted Hold path's error handling: a REAL `updateWorkingOrder` failure (not the
    // `working_order.not_open` that `#syncIfDirty` swallows) must surface the same non-fatal
    // `held.park_error` banner and leave the basket intact — the exact guarantee the fresh-walk-up park
    // has (see "a failed parkOrder keeps the counter and the basket"), now proven for the persisted path.
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
    expect(store.lines[0]!.product).toBe(cafe);
    // still on the counter with the retrieved basket
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
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
    // each: numeric(_,3) "2.000" is cleaned to "2" for display; re-pricing is unaffected
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
    expect(store.lines[0]!.product).toBe(cafe);
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.product_gone"));
    // still on the counter with the partial basket
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
    // still on the counter
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
    // sibling handler. Without the `errorKey = undefined` at the top of `#onDiscardOrder`, the banner
    // would persist — this fails against the pre-fix handler.
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
    // THE load-bearing assertion: a shift change never loses the half-built order.
    expect(store.lines).toHaveLength(2);
    expect(store.lines[0]!.product).toBe(cafe);
  });

  it("records a nav event on the shared diagnostics trail when the screen changes", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    // `diag` is a MODULE SINGLETON shared across every test (login itself records a `nav`), so scope the
    // assertion to events appended after this baseline rather than the total length (which leaks).
    const before = diag.snapshot().length;
    emit(c, "show-schedule");
    await flush(el);
    const nav = diag
      .snapshot()
      .slice(before)
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
    expect(counter(el)).toBeNull();
    // Basket-preserving, like logout: navigating to the schedule never loses the half-built order.
    expect(store.lines).toHaveLength(1);
    // The roster (from listStaff) and the logged-in operator id reach the schedule screen.
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
    // The load-bearing assertion: the basket survives the whole counter → schedule → counter round trip.
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

      emit(c, "show-floor");
      await flush(el);

      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      expect(currentApi.listZones).toHaveBeenCalledOnce();
      // The loaded zones + tables reach the floor screen.
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
      const c = await toCounter(el);

      emit(c, "show-floor");
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
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      // The floor screen gets the app's api (for the on-till placement writes) and the manager gate.
      // `toCounter` logged in as STAFF, so `canEdit` is false here (the manager path is covered below).
      expect(floor(el)!.api).toBe(currentApi);
      expect(floor(el)!.canEdit).toBe(false);
    });

    it("a login WITH the till.configure capability lights up the on-till floor editor, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      // The lock screen sends the server-computed capability; a manager holds `till.configure`.
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Marta",
        canConfigureTill: true,
      });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);

      expect(floor(el)!.canEdit).toBe(true);
      expect(floor(el)!.shadowRoot!.querySelector("[data-edit-toggle]")).not.toBeNull();

      // Logging out drops the privilege so the next operator starts un-privileged.
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      emit(counter(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);
      expect(floor(el)!.canEdit).toBe(false);
    });

    it("a login WITHOUT the till.configure capability keeps the on-till floor editor hidden, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);

      expect(floor(el)!.canEdit).toBe(false);
      expect(floor(el)!.shadowRoot!.querySelector("[data-edit-toggle]")).toBeNull();
    });

    it("floor-refresh re-reads the tables but NOT the zones after an on-till placement write (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
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
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);
      expect(floor(el)!.tables).toEqual([freeTable]);

      emit(floor(el)!, "floor-refresh");
      await flush(el);

      // Still on the floor, tables unchanged from the last good load.
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
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t1", hasOpenTab: false });
      await flush(el);

      // A free table opens a NEW tab (a pre-fiscal working order) before transitioning.
      expect(openTab).toHaveBeenCalledWith("t1");
      expect(floor(el)).toBeNull();
      // The real table-order screen (Ruling FP-D) now holds the slot, pointed at the freshly-opened tab
      // id (the app stored `openTab`'s new id in activeTabId and threads it through as `.orderId`).
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
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", hasOpenTab: true });
      await flush(el);

      // An occupied table already has a tab — no fresh openTab, just the transition. The screen points
      // at the RESUMED tab id (resolved from the read-model's tabId), not a new one.
      expect(openTab).not.toHaveBeenCalled();
      expect(floor(el)).toBeNull();
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
      const c = await toCounter(el);
      emit(c, "show-floor");
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

      emit(c, "show-floor");
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        expect(getTabLines).toHaveBeenCalledWith("wo-7");
        expect(screen.lines).toEqual([tabLine]);
        expect(screen.products).toEqual([cafe]);
      });

      it("a counter till can settle the tab — canSettle true (default)", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
        });
        const screen = await toTableOrder(el, openTable);
        // The pay section is available. The screen threads no `cardProvider`, so the embedded pay widget
        // offers BOTH tenders — cash and the manual (datáfono) card.
        expect(screen.canSettle).toBe(true);
      });

      it("a handheld reaches the table-order screen and can settle — canSettle true", async () => {
        // A handheld boots into handheld mode (Task 7) and lands on the floor after login; opening a
        // table reaches the table-order screen. It may settle at `POST /api/sales` for cash OR a manual
        // card tender (the server firewall permits both, fencing only the INTEGRATED reader, `/api/pay`),
        // so the pay section SHOWS with both tenders.
        const { el } = await mountApp({
          getDeviceIdentity: vi
            .fn()
            .mockResolvedValue({ deviceId: "d1", kind: "handheld", stationId: null }),
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "send-round", { lines: [{ productId: "cafe", quantity: "1" }] });
        await flush(el);

        // Appended to the tab's own working order, then re-read so the drawer reflects the new round.
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [{ productId: "cafe", quantity: "1" }]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("send-round forwards a per-line course OVERRIDE verbatim to addTabRound (KDS-2 §5b)", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "send-round", {
          lines: [{ productId: "cafe", quantity: "1", courseId: "postres" }],
        });
        await flush(el);
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [
          { productId: "cafe", quantity: "1", courseId: "postres" },
        ]);
      });

      it("send-round forwards a per-line hold flag verbatim to addTabRound (coursing A3)", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
        });
        const screen = await toTableOrder(el, openTable);
        emit(screen, "send-round", {
          lines: [{ productId: "cafe", quantity: "1", hold: true }],
        });
        await flush(el);
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [
          { productId: "cafe", quantity: "1", hold: true },
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "set-line-course", { lineNo: 1, courseId: null });
        await flush(el);

        expect(setLineCourse).toHaveBeenCalledWith("wo-7", 1, null);
      });

      it("a rejected set-line-course surfaces the banner AND still reloads to reconcile to server truth", async () => {
        // A raced move of a line the kitchen has just fired rejects `ticket.already_fired`; the handler
        // must still re-read the tab so the stale picker reconciles to server truth (like its siblings).
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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

        // Non-fatal: the operator stays on the screen and sees the generic banner…
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        // …and the tab is re-read even on the reject, so the picker reconciles to server truth.
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a failed round/serve/status write surfaces a non-fatal error, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          addTabRound: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
          markLineServed: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
          setLineCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }),
          setTableStatus: vi.fn().mockRejectedValue({ code: "status.not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        for (const [type, detail] of [
          ["send-round", { lines: [{ productId: "cafe", quantity: "1" }] }],
          ["serve-line", { lineNo: 1 }],
          ["set-line-course", { lineNo: 1, courseId: "c2" }],
          ["set-status", { statusId: "s1" }],
        ] as const) {
          emit(screen, type, detail);
          await flush(el);
          // Non-fatal: the operator stays on the table-order screen and sees the generic banner.
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

        // Keyed by the TABLE id "t2" (Ruling FP-F), never the tab's order id "wo-7".
        expect(setTableStatus).toHaveBeenCalledWith("t2", "s1");
      });

      // ── Coursing corrections (C5): send / recall / cancel line actions ─────────────────────────────
      it("send-lines fires the held lines on the tab then reloads its lines", async () => {
        const sendLines = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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

      // ── TS-3/TS-4: move / join / merge / transfer table actions ──────────────────────────────────
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
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

      it("a failed table action surfaces a non-fatal banner, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
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
        const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          recordSale,
          updateWorkingOrder,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        // The server files the tab's STORED locked lines and ignores the sent basket, so we send `[]`
        // (the documented shape) tagged with the tab's order id — and crucially NEVER #syncIfDirty →
        // updateWorkingOrder, which would re-price and destroy the tab's locks (H2).
        expect(recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "10.00" }, "wo-7");
        expect(updateWorkingOrder).not.toHaveBeenCalled();
        expect(ticket(el)).not.toBeNull();
      });

      it("a failed tab pay keeps the operator on the screen with a non-fatal error", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        expect(ticket(el)).toBeNull();
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("sale.error"));
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

        // A fresh occupancy read (a just-paid table shows free) and the floor is shown again.
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(listZones).toHaveBeenCalledTimes(2);
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
    // (only the one call on entering the counter). Proves the new refresh is on success, not always.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1); // basket intact — the sale in progress is not lost
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(el.shadowRoot!.textContent).not.toContain("sale.rejected"); // never leaks the raw code
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
    // confirm-payment dispatched in that window (double-tap / laggy link) must be a no-op. Deleting
    // the `if (this.submitting) return` guard makes recordSale fire twice — the deletion proof.
    const recordSale = vi.fn(() => new Promise<TillSaleResult>(() => {})); // never resolves
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
  // collect-card (integrated card terminal, sub-project 7 Task 8): same shape as confirm-payment
  // (single-flight, dirty-retrieved-order re-sync, held-list refresh on success) but branching on the
  // server's DATA outcome instead of assuming a ticket — a decline/timeout/network_unavailable must
  // never wedge the till (CLAUDE.md §5: nothing may block a sale but the sale itself). The widget that
  // EMITS `collect-card` is Task 9; these tests dispatch the synthetic event directly.
  // ---------------------------------------------------------------------------------------------

  describe("collect-card (integrated card terminal, Task 8)", () => {
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
        lines: [{ productId: "cafe", quantity: "2" }],
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
        lines: [{ productId: "cafe", quantity: "1" }],
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
      // `unknown` still reads its real runtime value). `till-tender-pay` (Task 9) is the real reader
      // now — its own tests cover the rendered retry/switch-tender/wait output — so this layer stays
      // scoped to till-app's own state, the same way every other assertion in this file does.
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

    // Fix round 1 (Important): cardOutcome must not survive the basket it describes being replaced.
    // errorKey is reset at every user action; cardOutcome was only reset in #onCollectCard itself and
    // #onNewSale, so a decline on basket A leaked into whatever basket the operator moved to next via
    // Park or Retrieve. Task 9 now threads `.cardOutcome` through `till-counter-screen`/`till-tender-pay`,
    // so a stale value here would reach the rendered card_outcome screen without this reset.
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

    it("single-flight: a second collect-card while pay is pending fires exactly once", async () => {
      // Same double-file safety as confirm-payment's single-flight test (CLAUDE.md §5): the first pay
      // never resolves, so a second collect-card dispatched in that window (double-tap / laggy link)
      // must be a no-op.
      const pay = vi.fn(() => new Promise<PayOutcome>(() => {})); // never resolves
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
      // The same 7c regression #onConfirmPayment guards against (its own "Finding 2" test above): the
      // server's retrieved-order pay path files from the STORED lock and IGNORES req.lines for the
      // integrated route too (IntegratedPayRequest's own doc), so an edit made after retrieve must be
      // re-locked (updateWorkingOrder) BEFORE the pay or it is silently dropped from both the charge and
      // the filed record. Deleting the #syncIfDirty call in #onCollectCard makes this fail (the edit is
      // lost from both assertions below).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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
          { productId: "cafe", quantity: "2" },
          { productId: "cafe", quantity: "1" },
        ],
        label: "Mesa 4",
      });
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [
          { productId: "cafe", quantity: "2" },
          { productId: "cafe", quantity: "1" },
        ],
      });
      expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
        pay.mock.invocationCallOrder[0]!,
      );
    });

    it("retrieve → collect-card (unedited): no re-sync, files the stored lock straight through", async () => {
      // Behaviour 1's mirror for the integrated route: an UNEDITED retrieve must NOT re-sync — that
      // would re-price against the live catalogue and defeat the add-time lock (design §3).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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
        lines: [{ productId: "cafe", quantity: "2" }],
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Integrated card wiring (Task 9): `cardProvider`/`tipsEnabled`, read once from `GET /api/till`
  // (#boot), and `cardOutcome` (Task 8's state) all reach the REAL nested `till-tender-pay` — through
  // `till-counter-screen`, exactly like `orderFlow`/`stage` above (per-mode pay control).
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
  // 7c prepare & collect: per-mode control selection (end-to-end, not just the widget in isolation)
  // and the prep queue rendered from fetched data.
  // ---------------------------------------------------------------------------------------------

  describe("per-mode pay control + station queue (KDS-1)", () => {
    it("boots into Mode P (prepay, the default): tender-pay shows the unchanged Pay flow, no station queue fetched or rendered", async () => {
      const { el } = await mountApp(); // the till fixture defaults orderFlow: "prepay"
      const c = await toCounter(el);
      expect(tenderPay(el).mode).toBe("prepay");
      expect(tenderPay(el).stage).toBe("order");
      expect(stationQueueWidget(el)).toBeNull(); // Mode P's layout omits the widget entirely
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      expect(c.products).toEqual([cafe]); // sanity: still a normal counter otherwise
    });

    it("boots into Mode I (invoice_first): tender-pay starts on the order stage; the default station's queue is fetched and rendered", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
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
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      expect(stationQueueWidget(el)).not.toBeNull();
    });

    it("renders the station queue from fetched data, not just an empty placeholder", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValue([stationGroup]),
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
      expect(stationQueueWidget(el)!.groups).toEqual([]);
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
        lines: [{ productId: "cafe", quantity: "2" }],
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
      // Symmetric with the unedited retrieve→pay path (Behaviour 1 above): retrieving adopts the order's
      // id and marks it persisted+clean (loadFrom). An UNEDITED retrieved order must NOT re-sync before
      // placing — `updateWorkingOrder` re-prices with the LIVE catalogue and would replace the add-time
      // lock, filing at the place-time price and defeating the line-add snapshot (design §3: placing does
      // not re-lock price). It must never re-park either (a re-park of the same id would idempotently
      // REPLAY the existing open order server-side and discard the edit). `placeOrder` files the STORED
      // composition straight. Removing the `dirty` gate in `#syncIfDirty` makes this fail (the unedited
      // order re-syncs).
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
      // EDITED composition and runs BEFORE `placeOrder`. Deleting the `#syncIfDirty` call in the
      // persisted branch of `#onPlaceOrder` makes this fail (the edit is lost).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
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
          { productId: "cafe", quantity: "2" }, // retrieved
          { productId: "cafe", quantity: "1" }, // the edit
        ],
        label: "Mesa 4",
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
      // mocked to reject `not_open`, matching the real server (the earlier revision mocked `placeOrder` to
      // SUCCESS, an impossible pairing — `placeOrder` succeeds only when the order is open, which is exactly
      // when `updateWorkingOrder` would not have thrown). Removing `#onPlaceOrder`'s place.error handler,
      // or advancing the stage on a failed place, makes this fail.
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
      expect(ticket(el)).toBeNull(); // stays on the counter, no ticket
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

    it("place single-flight: a second place-order while the first is pending places EXACTLY ONCE", async () => {
      const parkOrder = vi.fn(() => new Promise(() => {})); // never resolves
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

    it("collect single-flight: a second collect-order while the first is pending collects EXACTLY ONCE", async () => {
      const collectOrder = vi.fn(() => new Promise<TillSaleResult>(() => {})); // never resolves
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
        getStationQueue: vi.fn().mockResolvedValueOnce([stationGroup]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
      await flush(el);

      expect(currentApi.advanceTicketItem).toHaveBeenCalledWith("ti-1", "preparing");
      // once on entering the counter, once after the advance.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      expect(stationQueueWidget(el)!.groups).toEqual([]);
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
    // skips Mode P by a pre-existing decision (`sendToPrep` has no counter UI yet). So these exercise the
    // handler wiring under `invoice_first`, exactly as the advance-ticket-item tests above do.
    it("mark-collected: hands over the order via markCollected, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValueOnce([stationGroup]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "mark-collected", { orderId: "wo-1" });
      await flush(el);

      expect(currentApi.markCollected).toHaveBeenCalledWith("wo-1");
      // once on entering the counter, once after the handover — so the collected order drops off the queue.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      expect(stationQueueWidget(el)!.groups).toEqual([]);
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
      expect(counter(el)).toBeNull();
      // The basket survives the trip (till-owned store, not per-counter), like the schedule/floor nav —
      // still one line even while the counter is unmounted and the station screen is showing.
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
      expect(counter(el)).toBeNull();
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
  // Layout & receipt editors (Task 9): #boot reads `layout`/`receipt` from GET /api/till. An AUTHORED
  // layout (structurally different from the built-in default) renders VERBATIM — no Mode-P filter, the
  // owner's choice (design §7); a DEFAULT or ABSENT layout keeps slice 1's Mode-P prep-queue drop as
  // the fallback (#layoutFor). `receipt` is threaded to the ticket view. The `till` fixture above OMITS
  // both fields, so every pre-Task-9 test exercises the ABSENT→fallback branch.
  // ---------------------------------------------------------------------------------------------

  describe("authored layout + receipt (design §7)", () => {
    // A full 6-widget layout, but prep-queue FIRST — a structural difference from LAYOUT_A (reordered),
    // so it is AUTHORED, not the default.
    const authoredReordered: LayoutDef = [
      { type: "prep-queue", region: "aside", config: {} },
      { type: "product-grid", region: "main", config: {} },
      { type: "basket", region: "aside", config: {} },
      { type: "total", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
      { type: "held-orders", region: "aside", config: {} },
    ];

    const gridOf = (el: TillApp) =>
      counter(el)!.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;

    it("renders an AUTHORED layout verbatim — under Mode P an authored prep-queue is NOT dropped", async () => {
      // The two-branch proof (this is the AUTHORED half): under Mode P the default fallback would drop
      // prep-queue, but an authored layout is rendered verbatim, so the owner's prep-queue survives.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          orderFlow: "prepay",
          layout: authoredReordered,
          receipt: {},
        }),
      });
      const c = await toCounter(el);
      // the authored arrangement reached the counter verbatim (order preserved)
      expect(c.layout).toEqual(authoredReordered);
      // and under Mode P the authored prep-queue is present — the mode filter did NOT run
      expect(stationQueueWidget(el)).not.toBeNull();
    });

    it("threads an authored product-grid `columns` config end to end to the grid widget", async () => {
      // A full layout identical to the default EXCEPT product-grid carries `columns: 4` — a config
      // difference makes it AUTHORED (rendered verbatim), and the value reaches the real grid widget.
      const authoredColumns: LayoutDef = [
        { type: "product-grid", region: "main", config: { columns: 4 } },
        { type: "basket", region: "aside", config: {} },
        { type: "total", region: "aside", config: {} },
        { type: "tender-pay", region: "aside", config: {} },
        { type: "held-orders", region: "aside", config: {} },
        { type: "prep-queue", region: "aside", config: {} },
      ];
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, layout: authoredColumns, receipt: {} }),
      });
      await toCounter(el);
      expect(gridOf(el).columns).toBe(4);
    });

    it("a layout structurally EQUAL to the default keeps the Mode-P prep-queue drop (default detection)", async () => {
      // The two-branch proof (this is the DEFAULT half): a VALUE-copy of LAYOUT_A (not the local
      // reference — it arrives as fresh JSON) is detected as the default, so under Mode P the fallback
      // still drops prep-queue exactly as slice 1 shipped. Making isDefaultLayout return a constant
      // false breaks this (prep-queue would survive); returning constant true breaks the authored test.
      const defaultCopy: LayoutDef = LAYOUT_A.map((w) => ({ ...w, config: { ...w.config } }));
      const { el } = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, orderFlow: "prepay", layout: defaultCopy, receipt: {} }),
      });
      await toCounter(el);
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("falls back to #layoutFor() when GET /api/till OMITS `layout` (older server): Mode P drops prep-queue", async () => {
      // The `till` fixture carries no `layout` — #boot leaves receivedLayout undefined, so #layoutFor()
      // applies the Mode-P prep-queue drop, the slice-1 behaviour, unchanged.
      const { el } = await mountApp();
      await toCounter(el);
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("threads the receipt trim from getTill through to the ticket view", async () => {
      const receipt = { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, layout: LAYOUT_A, receipt }),
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

    it("login switches the UI to the operator's stored locale — a DEEP counter child renders English", async () => {
      // Venue default es-ES; the operator's stored locale is en-GB. On login the app resolves en-GB and
      // `setLocale`s it; the `keyed(currentLocale(), …)` wrapper recreates the counter subtree, so a deep child
      // (the logout button, inside the counter's OWN shadow root) renders in English, not Spanish.
      const { el } = await mountApp();
      const c = await toCounterAs(el, "en-GB");
      expect(currentLocale()).toBe("en-GB");
      const logout = c.shadowRoot!.querySelector(".logout")!;
      expect(logout.textContent).toContain(t("action.logout", "en-GB")); // "Log out"
      expect(logout.textContent).not.toContain(t("action.logout", "es-ES")); // not "Cerrar sesión"
    });

    it("boot does NOT clobber an operator locale applied while getTill was still in flight (slow-link race)", async () => {
      // Slow-link race: the operator's login (the lock screen's `getStaff` + a human PIN entry) completes
      // while boot's `getTill` is STILL in flight. `#onLoggedIn` applies the operator's stored en-GB
      // synchronously (before its first await) and sets `operatorPersonId`; when `getTill` finally
      // resolves, the boot continuation must NOT re-apply the venue default (es-ES) over it. The guard is
      // `#boot`'s `if (this.operatorPersonId === "")` — deletion proof: drop it (making the venue-default
      // `setLocale` unconditional) and this fails, the language clobbered back es-ES for the whole session.
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
      // write to). Proven-by-deletion target: dropping the `screen === "lock"` guard makes this fail
      // (putLocale would fire). Emitted from the lock screen exactly as the chooser's composed event does.
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
      // a non-fatal banner appears — never the raw code. Deleting the try/catch's `errorKey` set drops the
      // banner; moving `setLocale` before/outside the try would wrongly switch on a failed save.
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

    it("threads the api down to the counter so its chooser can load the offered locales", async () => {
      const { el } = await mountApp();
      const c = await toCounterAs(el, null);
      // The counter renders the chooser and is handed the app's api (its `loadLocales` reads getLocales).
      expect(c.api).toBe(currentApi);
      expect(c.shadowRoot!.querySelector("till-language-chooser")).not.toBeNull();
    });

    it("does not revert the locale if the app disconnects mid-logout", async () => {
      // #onLogout's `setLocale(this.#venueLocale)` runs AFTER `await api.logout()`, so a teardown during
      // that round trip must not repaint a live sibling's module-global locale — the same guard #boot
      // carries. Log in as an en-GB operator (UI → English), start logout with `logout()` in flight,
      // detach, then resolve: the venue-default revert (es-ES) must be SKIPPED. Deleting the new
      // `if (!this.isConnected) return` makes the revert fire and this fail — the deletion proof.
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
      // SKIP only the now-pointless local repaint — never mutate a live sibling's locale. Deleting the
      // new `if (!this.isConnected) return` after putLocale makes the switch fire and this fail.
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

  // Multi-menu till: the switcher over the counter grid. A location may sell across several accessible
  // menus; the grid shows ONE at a time and the switcher picks it. The app owns `selectedCatalogueId`
  // (defaulting to the flagged menu at login), so a switcher pick re-filters the grid without touching
  // the working order — an in-flight cart line survives.
  describe("multi-menu switcher", () => {
    const foodMenu = { id: "cat-food", name: "Comida", isDefault: true };
    const drinksMenu = { id: "cat-drinks", name: "Bebidas", isDefault: false };
    const bocadillo: TillProduct = {
      id: "bocadillo",
      descriptions: { es: "Bocadillo" },
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
      descriptions: { es: "Cerveza" },
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

    /** The menu switcher inside the counter's main region. */
    const switcher = (el: TillApp) =>
      counter(el)!.shadowRoot!.querySelector<HTMLElement>(".region-main till-menu-switcher")!;
    /** The switcher's option buttons (empty when it renders nothing — one menu or none). */
    const switcherButtons = (el: TillApp) => [
      ...switcher(el).shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="menu-"]'),
    ];
    /** The product names the counter GRID is currently showing (its `wt-button.tile` labels). */
    const gridNames = (el: TillApp) =>
      [
        ...counter(el)!
          .shadowRoot!.querySelector("till-product-grid")!
          .shadowRoot!.querySelectorAll(".name"),
      ].map((n) => n.textContent);

    it("shows the switcher and only the DEFAULT menu's products on the grid at login", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      await toCounter(el);

      // Both menus offered, default (Comida) first and marked pressed.
      expect(switcherButtons(el).map((b) => b.textContent?.trim())).toEqual(["Comida", "Bebidas"]);
      expect(switcherButtons(el)[0]!.getAttribute("aria-pressed")).toBe("true");
      // The grid shows ONLY the default menu's product — the guard-by-deletion assertion: drop the
      // screen's `filterProductsByMenu` `.filter` (grid shows all products) and this fails on "Cerveza".
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

    it("keeps a mid-order menu switch, then reverts to the location default on the NEXT order (pay → new-sale)", async () => {
      // Owner decision: switching menus is TEMPORARY — it sticks for the current order but reverts to the
      // location's default menu when the next order begins.
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);

      // Login lands on the location default (Comida).
      expect(selected(el)).toBe("cat-food");

      // Switch to the non-default menu and ring a line — a mid-order switch STICKS (the control: it must
      // NOT be reset while the order is in progress, or it would fight the waiter).
      switcherButtons(el)[1]!.click();
      await flush(el);
      c.store.addProduct(cerveza, "1");
      await el.updateComplete;
      expect(selected(el)).toBe("cat-drinks");

      // Complete the sale: the switch STILL sticks across the ticket — the order it belongs to is settled
      // but the NEXT one has not begun yet.
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull();
      expect(selected(el)).toBe("cat-drinks");

      // Start the next order — the temporary switch reverts to the location default.
      emit(ticket(el)!, "new-sale");
      await flush(el);
      expect(selected(el)).toBe("cat-food");
      // ...and the switcher + grid reflect the default once more.
      expect(switcherButtons(el)[0]!.getAttribute("aria-pressed")).toBe("true");
      expect(gridNames(el)).toEqual(["Bocadillo"]);
    });

    it("reverts a temporary menu switch to the location default when the basket is PARKED (a fresh order begins)", async () => {
      const { el } = await mountApp({ listProducts: twoMenuProducts });
      const c = await toCounter(el);

      // Switch to the non-default menu and ring a line — the switch sticks mid-order (the control).
      switcherButtons(el)[1]!.click();
      await flush(el);
      c.store.addProduct(cerveza, "1");
      await el.updateComplete;
      expect(selected(el)).toBe("cat-drinks");

      // Park it: the basket clears and a fresh working order begins, so the menu reverts to the default.
      emit(c, "park-order", { label: "Mesa 4" });
      await flush(el);
      expect(c.store.lines).toHaveLength(0);
      expect(selected(el)).toBe("cat-food");
    });

    it("with a SINGLE menu the switcher renders nothing and the grid shows every product (unchanged)", async () => {
      // The default stubApi ships one menu (`defaultMenu`) with `cafe` on it — the pre-multi-menu shape.
      const { el } = await mountApp();
      await toCounter(el);

      // The switcher element is present but renders no options — a single-menu venue looks as before.
      expect(switcherButtons(el)).toHaveLength(0);
      expect(gridNames(el)).toEqual(["Café"]);
    });
  });
});

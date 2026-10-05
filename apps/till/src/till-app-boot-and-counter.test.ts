import { page } from "vitest/browser";
import { applyTokens, currentContentLanguages } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import indexHtml from "../index.html?raw";
import { productUnit } from "./widgets/product-name.js";
import { TillApp } from "./till-app.js";
import { ServerRouter } from "./api/server-router.js";
import { setLocale, t } from "./i18n/t.js";
import { DEV_DEVICE_STORAGE_KEY } from "./api/dev-device.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  ProductCatalogue,
  ServiceZoneSummary,
  TillApi,
  TillProduct,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  catalogueId: "cat-default",
  catalogueName: "Carta",
};

const defaultMenu = { id: "cat-default", name: "Carta", isDefault: true };

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

const tillCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
    },
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

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

const till = {
  locale: "es-ES",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as "auto" | "on_request" | "never",
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas: tillCanvas,
  capabilities: ["print-receipt", "show-station", "show-expo", "show-schedule"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

function zoneOffers(
  catalogue: ProductCatalogue,
  zoneId: string,
  serviceMode: ServiceZoneSummary["serviceMode"] = "prepay",
  defaultMenuId: string | null = catalogue.menus.find((menu) => menu.isDefault)?.id ?? null,
): ZoneOfferCatalogue {
  const body: ZoneOfferCatalogue = {
    context: { zoneId, departmentId: "department-default", serviceMode },
    defaultMenuId,
    // No `versionId`: a line added from these offers asserts no version, so the wire bodies the
    // suites pin are the ones a till sends against the live version.
    menus: [],
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      available: true,
      image: null,
      description: null,
      menuName: product.catalogueName ?? "Menu",
      placements: [[]],
      name: product.name,
      customerName: null,
      kitchenName: null,
      unit: productUnit(product),
      vatClass: product.vatClass,
      category: product.category ?? "Other",
      allergens: product.allergens,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      offeredModifiers: [],
      variants: [],
      courseId: null,
    })),
  };
  body.menus = servedMenus(catalogue.menus, body.offers) as ZoneOfferCatalogue["menus"];
  return body;
}

const zone = (id: string, serviceMode: ServiceZoneSummary["serviceMode"]): ServiceZoneSummary => ({
  id,
  name: id,
  departmentId: `department-${id}`,
  departmentName: id,
  serviceMode,
});

let api: TillApi;
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi
      .fn()
      .mockResolvedValue(zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter")),
    listZoneOffers: vi.fn(),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    getExpoQueue: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    retrieveWorkingOrder: vi.fn(),
    reprint: vi.fn().mockResolvedValue(undefined),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    printPaymentSlip: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

function fakeSessionActivity() {
  return {
    configure: vi.fn(),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

async function mountApp(overrides: Record<string, unknown> = {}, props: Partial<TillApp> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api, ...props });
}

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const shell = (el: TillApp) =>
  el.shadowRoot!.querySelector<
    HTMLElement & { activeTabKey?: string; loadLocales?: () => Promise<unknown> }
  >("till-tab-shell");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view");
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const privateState = <T>(el: TillApp, field: string): T =>
  (el as unknown as Record<string, T>)[field]!;

async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  return counter(el)!;
}

/** Stands in for the page's `setTimeout` so the one-minute content-language refresh can be fired by
 * hand; every other delay still runs on the real timer. */
function captureMinuteTimers() {
  const realSetTimeout = window.setTimeout.bind(window);
  const minuteTimers: (() => void)[] = [];
  const spy = vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: () => void,
    ms?: number,
  ) => {
    if (ms === 60_000) {
      minuteTimers.push(handler);
      return 0;
    }
    return realSetTimeout(handler, ms);
  }) as unknown as typeof window.setTimeout);
  return { minuteTimers, restore: () => spy.mockRestore() };
}

beforeEach(() => {
  setLocale("es-ES");
  sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
});
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem("waitron.makeNow.till-dev");
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app session activity", () => {
  it("opens an enrolled watcher screen without asking for a station", async () => {
    const board = {
      watcher: { id: "pass", name: "Pass", runsPass: true, active: true },
      orders: [],
    };
    const getDeviceStation = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
    const getDeviceWatcher = vi.fn().mockResolvedValue(board);
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "watcher-device",
        name: "Pass",
        formFactor: "kds",
        stationId: null,
        watcherId: "pass",
      }),
      getDeviceStation,
      getDeviceWatcher,
    });
    await flush(el);
    const screen = el
      .shadowRoot!.querySelector("till-card-grid")!
      .shadowRoot!.querySelector<
        HTMLElement & { deviceMode: boolean; initialDeviceWatcher: unknown }
      >("till-expo-screen");
    expect(screen).not.toBeNull();
    expect(screen!.deviceMode).toBe(true);
    expect(screen!.initialDeviceWatcher).toBe(board);
    expect(getDeviceWatcher).toHaveBeenCalledTimes(1);
    expect(getDeviceStation).not.toHaveBeenCalled();
  });

  it("keeps an enrolled station screen on its station board", async () => {
    const getDeviceStation = vi
      .fn()
      .mockResolvedValue({ station: { id: "st-1", queue: [], notices: [], printersDown: [] } });
    const getDeviceWatcher = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "station-device",
        name: "Grill",
        formFactor: "kds",
        stationId: "st-1",
        watcherId: null,
      }),
      getDeviceStation,
      getDeviceWatcher,
    });
    await flush(el);
    expect(
      el
        .shadowRoot!.querySelector("till-card-grid")!
        .shadowRoot!.querySelector("till-station-screen"),
    ).not.toBeNull();
    expect(getDeviceStation).toHaveBeenCalledTimes(1);
    expect(getDeviceWatcher).not.toHaveBeenCalled();
  });

  it("replaces a watcher board when the device is enrolled to a station", async () => {
    const getDeviceIdentity = vi
      .fn()
      .mockResolvedValueOnce({
        deviceId: "watcher-device",
        name: "Pass",
        formFactor: "kds",
        stationId: null,
        watcherId: "pass",
      })
      .mockResolvedValueOnce({
        deviceId: "station-device",
        name: "Grill",
        formFactor: "kds",
        stationId: "st-1",
        watcherId: null,
      });
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity,
      getDeviceWatcher: vi.fn().mockResolvedValue({
        watcher: { id: "pass", name: "Pass", runsPass: true, active: true },
        orders: [],
      }),
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-1", queue: [], notices: [], printersDown: [] } }),
    });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-card-grid")!, "enrolled");
    await flush(el);
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    const grid = el.shadowRoot!.querySelector("till-card-grid")!;
    expect(grid.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-expo-screen")).toBeNull();
  });
  it("keeps a made-here instruction through navigation and restores it for the same device", async () => {
    setLocale("en-GB");
    localStorage.removeItem("waitron.makeNow.till-dev");
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    const made = {
      lineId: "lager-1",
      name: "Lager",
      quantity: "2.000",
      unitName: null,
      soldInEach: true,
      optionSnapshots: [],
      extras: [],
      note: null,
    };
    receive!([made, made]);
    await flush(el);
    expect(
      el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.querySelectorAll("li"),
    ).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "2× Lager",
    );
    await toCounter(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "2× Lager",
    );
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toContain("lager-1");
    el.remove();
    const reloaded = await mountApp();
    await flush(reloaded.el);
    expect(
      reloaded.el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent,
    ).toContain("2× Lager");
    reloaded.el
      .shadowRoot!.querySelector("till-make-now")!
      .shadowRoot!.querySelector("button")!
      .click();
    await flush(reloaded.el);
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toBeNull();
    expect(
      reloaded.el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent,
    ).not.toContain("2× Lager");
  });

  it("does not restore another device's instructions", async () => {
    localStorage.setItem(
      "waitron.makeNow.other-device",
      JSON.stringify([
        {
          lineId: "other",
          name: "Other drink",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]),
    );
    const { el } = await mountApp();
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).not.toContain(
      "Other drink",
    );
    localStorage.removeItem("waitron.makeNow.other-device");
  });

  it("clears old instructions on a same-app device switch and restores them on return", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    const identity = vi.fn(async () => ({
      deviceId: sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY),
      name: "Device",
      formFactor: "till",
      stationId: null,
    }));
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      getDeviceIdentity: identity,
      getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    receive!([
      {
        lineId: "old-line",
        name: "Old drink",
        quantity: "1.000",
        unitName: null,
        soldInEach: true,
        optionSnapshots: [],
        extras: [],
        note: null,
      },
    ]);
    await flush(el);
    const widget = el.shadowRoot!.querySelector("till-make-now")!;
    expect(widget.shadowRoot!.textContent).toContain("Old drink");
    emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-device-chooser")).not.toBeNull();
    expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toContain("old-line");
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "other-device");
    emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
    await flush(el);
    expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
    await flush(el);
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
    await flush(el);
    expect(widget.shadowRoot!.textContent).toContain("Old drink");
  });

  it("clears old instructions on a same-app switch when localStorage access throws", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
        getDeviceIdentity: vi.fn(async () => ({
          deviceId: sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY),
          name: "Device",
          formFactor: "till",
          stationId: null,
        })),
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "old-line",
          name: "Old drink",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Old drink");
      emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
      sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "other-device");
      emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    } finally {
      if (previous !== undefined) Object.defineProperty(globalThis, "localStorage", previous);
    }
  });

  it("ignores a stored value that is not an item list", async () => {
    localStorage.setItem("waitron.makeNow.till-dev", "{}");
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    receive!([
      {
        lineId: "fresh",
        name: "Lager",
        quantity: "1.000",
        unitName: null,
        soldInEach: true,
        optionSnapshots: [],
        extras: [],
        note: null,
      },
    ]);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Lager",
    );
  });

  it("drops a stored item with malformed option snapshots before rendering", async () => {
    localStorage.setItem(
      "waitron.makeNow.till-dev",
      JSON.stringify([
        {
          lineId: "bad",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [{}],
          extras: [],
          note: null,
        },
        {
          lineId: "good",
          name: "Coffee",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [
            {
              listName: { es: "Tamaño" },
              listCustomerName: null,
              listKitchenName: null,
              labelName: { es: "Grande" },
              labelCustomerName: null,
              labelKitchenName: null,
            },
          ],
          extras: [],
          note: null,
        },
      ]),
    );
    const { el } = await mountApp();
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).not.toContain(
      "Lager",
    );
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Tamaño: Grande",
    );
  });

  it("keeps Done usable when site data methods throw", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "lager",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Lager");
      widget.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Lager");
    } finally {
      get.mockRestore();
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("keeps the instruction when the localStorage global itself throws", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "lager",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Lager");
      widget.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Lager");
    } finally {
      if (previous !== undefined) Object.defineProperty(globalThis, "localStorage", previous);
    }
  });

  it("restarts the idle countdown on a pointer or key press anywhere inside the app", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp({}, { sessionActivity: sa as never });
    await flush(el);
    const inner = lock(el)!;

    inner.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(sa.noteInteraction).toHaveBeenCalledTimes(1);
    inner.dispatchEvent(new Event("keydown", { bubbles: true, composed: true }));
    expect(sa.noteInteraction).toHaveBeenCalledTimes(2);
  });

  it("asks for the screen wake lock again when the tab's visibility changes", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp({}, { sessionActivity: sa as never });
    await flush(el);
    expect(sa.reacquire).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(sa.reacquire).toHaveBeenCalledOnce();
  });

  it("treats a device with an unknown form factor as an ordinary till on the login screen", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp(
      {
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "d9",
          name: "Future device",
          formFactor: "wall-panel",
          stationId: null,
        }),
      },
      { sessionActivity: sa as never },
    );
    await flush(el);

    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({ loggedIn: false, kind: "till" });
    expect(lock(el)).not.toBeNull();
    expect(lock(el)!.deviceName).toBe("Future device");
  });
});

describe("till-app boot interrupted by removal from the page", () => {
  it("does not open the dev device chooser when the device list arrives after removal", async () => {
    let resolveDevices!: (list: unknown) => void;
    const { el, host } = await mountApp({
      getDevDevices: vi.fn(() => new Promise((resolve) => (resolveDevices = resolve))),
    });
    await flush(el);

    host.removeChild(el);
    resolveDevices({ devices: [] });
    await flush(el);
    host.appendChild(el);
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-device-chooser")).toBeNull();
    expect(lock(el)).not.toBeNull();
  });

  it("does not enter kitchen-display mode when the station arrives after removal", async () => {
    const sa = fakeSessionActivity();
    let resolveStation!: (station: unknown) => void;
    const { el, host } = await mountApp(
      {
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "kds1",
          name: "Pass",
          formFactor: "kds",
          stationId: "st-1",
        }),
        getDeviceStation: vi.fn(() => new Promise((resolve) => (resolveStation = resolve))),
      },
      { sessionActivity: sa as never },
    );
    await flush(el);

    host.removeChild(el);
    resolveStation({ station: { id: "st-1", queue: [], notices: [] } });
    await flush(el);

    expect(sa.configure).not.toHaveBeenCalled();
    host.appendChild(el);
    await flush(el);
    expect(shell(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
  });
});

describe("till-app content languages", () => {
  it("re-reads the content languages every minute and applies the new answer", async () => {
    const timers = captureMinuteTimers();
    try {
      const getContentLanguages = vi
        .fn()
        .mockResolvedValueOnce({ defaultLanguage: "fr", languages: ["fr", "en"] })
        .mockResolvedValueOnce({ defaultLanguage: "ca", languages: ["ca", "es"] });
      const { el } = await mountApp({ getContentLanguages });
      await flush(el);
      expect(currentContentLanguages().defaultLanguage).toBe("fr");
      expect(timers.minuteTimers).toHaveLength(1);

      timers.minuteTimers[0]!();
      await flush(el);

      expect(getContentLanguages).toHaveBeenCalledTimes(2);
      expect(currentContentLanguages().defaultLanguage).toBe("ca");
      expect(timers.minuteTimers).toHaveLength(2);
    } finally {
      timers.restore();
    }
  });

  it("keeps the minute refresh going after a refresh fails, without an unhandled rejection", async () => {
    const timers = captureMinuteTimers();
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const getContentLanguages = vi
        .fn()
        .mockResolvedValueOnce({ defaultLanguage: "fr", languages: ["fr", "en"] })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const { el } = await mountApp({ getContentLanguages });
      await flush(el);

      timers.minuteTimers[0]!();
      await flush(el);
      await flush(el);

      expect(getContentLanguages).toHaveBeenCalledTimes(2);
      expect(rejections).toEqual([]);
      expect(currentContentLanguages().defaultLanguage).toBe("fr");
      expect(timers.minuteTimers).toHaveLength(2);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      timers.restore();
    }
  });

  it("applies nothing and schedules no refresh when the first answer arrives after removal", async () => {
    const timers = captureMinuteTimers();
    try {
      let answer!: (config: ContentLanguages) => void;
      const { el, host } = await mountApp({
        getContentLanguages: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      });
      const before = currentContentLanguages().defaultLanguage;
      expect(before).not.toBe("fr");

      host.removeChild(el);
      answer({ defaultLanguage: "fr", languages: ["fr", "en"] });
      await flush(el);

      expect(currentContentLanguages().defaultLanguage).toBe(before);
      expect(timers.minuteTimers).toHaveLength(0);
    } finally {
      timers.restore();
    }
  });
});

describe("till-app receipt issuance", () => {
  it("shows Make now after a counter cash payment reports a drink", async () => {
    let receive: ((items: unknown[]) => void) | undefined;
    const item = {
      lineId: "lager-pay",
      name: "Lager",
      quantity: "1.000",
      unitName: null,
      soldInEach: true,
      optionSnapshots: [],
      extras: [],
      note: null,
    };
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
      recordSale: vi.fn(async () => {
        receive!([item]);
        return saleResult;
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Lager",
    );
  });

  async function ticketAfterSale(tillInfo: Record<string, unknown>): Promise<TillTicketView> {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(tillInfo) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    return ticket(el)!;
  }

  it("uses automatic printing when zone offers omit the receipt choice, even if boot says otherwise", async () => {
    const legacyTill: Record<string, unknown> = { ...till };
    delete legacyTill.receiptPrintMode;

    expect((await ticketAfterSale(legacyTill)).originalReceiptAvailable).toBe(false);
    cleanupWidgets();
    expect(
      (await ticketAfterSale({ ...till, receiptPrintMode: "on_request" })).originalReceiptAvailable,
    ).toBe(false);
  });

  it("takes pay timing from the zone context when no zone chooser is supplied", async () => {
    const catalogue = zoneOffers(
      { menus: [defaultMenu], products: [cafe] },
      "zone-counter",
      "ticket_then_pay",
    );
    delete catalogue.zones;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    });
    const c = await toCounter(el);

    expect(c.orderFlow).toBe("ticket_then_pay");
  });

  it("offers the original receipt according to the selected zone, even when boot says auto", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.context.receiptPrintMode = "on_request";
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "auto" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.originalReceiptAvailable).toBe(true);
  });

  it("updates original receipt availability when the counter switches zones", async () => {
    const initial = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    initial.context.receiptPrintMode = "on_request";
    initial.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const deli = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-deli");
    deli.context.receiptPrintMode = "auto";
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "on_request" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(initial),
      listZoneOffers: vi.fn().mockResolvedValue(deli),
    });
    const c = await toCounter(el);
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(c.selectedServiceZoneId).toBe("zone-deli");
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.originalReceiptAvailable).toBe(false);
  });

  it("keeps the original receipt on offer and says why when printing it fails", async () => {
    const printReceipt = vi.fn().mockRejectedValue({ code: "printing.no_printer" });
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.context.receiptPrintMode = "on_request";
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "on_request" }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      printReceipt,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    const workingOrderId = vi.mocked(api.recordSale).mock.calls[0]![2];

    emit(ticket(el)!, "print-receipt");
    await flush(el);

    expect(printReceipt).toHaveBeenCalledWith(workingOrderId);
    expect(banner(el)!.textContent).toContain(t("receipt.error"));
    expect(ticket(el)!.originalReceiptAvailable).toBe(true);
  });

  it("says the card slip could not print when printing it fails", async () => {
    const printPaymentSlip = vi.fn().mockRejectedValue({ code: "printing.no_printer" });
    const { el } = await mountApp({ printPaymentSlip });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "payment-slip");
    await flush(el);

    expect(printPaymentSlip).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(t("payment_slip.error"));
    expect(ticket(el)).not.toBeNull();
  });

  it.each([
    ["reprint", "reprint"],
    ["print-receipt", "printReceipt"],
    ["payment-slip", "printPaymentSlip"],
  ] as const)("a %s request with no filed sale on screen sends nothing", async (type, method) => {
    const { el } = await mountApp();
    const c = await toCounter(el);

    emit(c, type);
    await flush(el);

    expect(
      (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).not.toHaveBeenCalled();
    expect(banner(el)).toBeNull();
  });
});

describe("till-app counter menus and service zones", () => {
  it("uses pay-first controls when zone offers fail despite a retired venue-wide mode", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      listDefaultZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    const c = await toCounter(el);

    expect(c.orderFlow).toBe("prepay");
    expect(banner(el)!.textContent).toContain(t("service_zone.load_error"));
  });

  const twoMenus = [
    { id: "menu-food", name: "Comida", isDefault: false },
    { id: "menu-drinks", name: "Bebidas", isDefault: true },
  ];

  it("ignores a menu pick naming a menu the counter's zone does not offer", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    expect(privateState<string>(el, "selectedCatalogueId")).toBe("cat-default");
    sessionStorage.removeItem("waitron.lastMenu");

    emit(c, "menu-selected", { id: "menu-elsewhere" });
    await flush(el);

    expect(privateState<string>(el, "selectedCatalogueId")).toBe("cat-default");
    expect(sessionStorage.getItem("waitron.lastMenu")).toBeNull();
  });

  it("ignores a zone change naming a zone the counter was not offered", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue) });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-unknown" });
    await flush(el);

    expect(api.listZoneOffers).not.toHaveBeenCalled();
    expect(c.selectedServiceZoneId).toBe("zone-counter");
  });

  it("keeps the counter's pay timing when the new zone serves by table tab, and falls back to its marked default menu", async () => {
    const catalogue = zoneOffers(
      { menus: [defaultMenu], products: [cafe] },
      "zone-counter",
      "invoice_first",
    );
    catalogue.zones = [zone("zone-counter", "invoice_first"), zone("zone-terrace", "table_tab")];
    const terrace = zoneOffers(
      {
        menus: twoMenus,
        products: [
          { ...cafe, id: "tostada", catalogueId: "menu-food" },
          { ...cafe, id: "cana", catalogueId: "menu-drinks" },
        ],
      },
      "zone-terrace",
      "table_tab",
      null,
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn().mockResolvedValue(terrace),
    });
    const c = await toCounter(el);
    expect(c.orderFlow).toBe("invoice_first");

    emit(c, "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);

    expect(c.selectedServiceZoneId).toBe("zone-terrace");
    expect(c.orderFlow).toBe("invoice_first");
    expect(c.selectedMenuId).toBe("menu-drinks");
  });

  it("shows service_zone.load_error when the new zone's menus cannot load, but not for a superseded request", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [
      zone("zone-counter", "prepay"),
      zone("zone-a", "prepay"),
      zone("zone-b", "prepay"),
    ];
    let rejectA!: (reason: unknown) => void;
    let rejectB!: (reason: unknown) => void;
    const listZoneOffers = vi.fn(
      (zoneId: string) =>
        new Promise<ZoneOfferCatalogue>((_resolve, reject) => {
          if (zoneId === "zone-a") rejectA = reject;
          else rejectB = reject;
        }),
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers,
    });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-a" });
    emit(c, "counter-zone-selected", { zoneId: "zone-b" });
    rejectA(new TypeError("Failed to fetch"));
    await flush(el);
    expect(banner(el)).toBeNull();

    rejectB(new TypeError("Failed to fetch"));
    await flush(el);
    expect(banner(el)!.textContent).toContain(t("service_zone.load_error"));
    expect(c.selectedServiceZoneId).toBe("zone-counter");
  });
});

/** The first element matching `selector` anywhere under `root`, through shadow roots. */
function deepFind(root: Element, selector: string): Element | null {
  const tree = root.shadowRoot ?? root;
  const direct = tree.querySelector(selector);
  if (direct !== null) return direct;
  for (const child of tree.querySelectorAll("*")) {
    const found = child.shadowRoot === null ? null : deepFind(child, selector);
    if (found !== null) return found;
  }
  return null;
}

describe("till-app simplified-invoice limit", () => {
  // The counter with its basket card, so the basket's own buttons are on screen.
  const limitedTill = {
    ...till,
    simplifiedInvoiceLimit: "3.00",
    canvas: {
      ...tillCanvas,
      tabs: [
        {
          ...tillCanvas.tabs[0]!,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
            { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
          ],
        },
      ],
    } satisfies CanvasDef,
  };
  /** The banner's words, with the no-break space a formatted amount carries read as a space. */
  const said = (el: TillApp) => banner(el)!.textContent!.replace(/\s/g, " ");

  it("refuses a line that would take the basket past the limit, saying so in its own words", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(limitedTill) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "2");
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    expect(c.store.total).toBe("3.00");
    expect(c.store.lines).toHaveLength(1);
    expect(said(el)).toBe(
      "El pedido pasaría de 3,00 €, el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido.",
    );
  });

  it("refuses raising a line's quantity past the limit from the basket's own button", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(limitedTill) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "2");
    await flush(el);
    const basket = deepFind(el, "till-basket")!;
    basket.shadowRoot!.querySelector<HTMLElement>(".step-inc")!.click();
    await flush(el);
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(said(el)).toContain("3,00 €");
  });

  it("refuses nothing for a server that sends no limit", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "9");
    await el.updateComplete;
    expect(c.store.total).toBe("13.50");
    expect(banner(el)).toBeNull();
  });

  it("shows the server's refusal of a sale past the limit in its own words, naming the limit", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "sale.total_exceeds_simplified_limit",
        total: "3010.01",
        limit: "3010.00",
        status: 409,
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(said(el)).toBe(
      "El pedido pasaría de 3010,00 €, el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido.",
    );
    expect(c.store.lines).toHaveLength(1);
  });

  it("words the refusal without the amount when the server names no limit", async () => {
    const { el } = await mountApp({
      recordSale: vi
        .fn()
        .mockRejectedValue({ code: "sale.total_exceeds_simplified_limit", status: 409 }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(banner(el)!.textContent).toBe(
      "Este pedido supera el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido",
    );
  });
});

describe("till-app integrated card collection", () => {
  it("sends the reader the operator picked", async () => {
    const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
      pay,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;

    emit(c, "collect-card", { readerId: "reader-2" });
    await flush(el);

    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ readerId: "reader-2" }));
  });
});

describe("till-app retrieving a held order", () => {
  it("resolves a line's selling id to the FIRST live offer carrying it", async () => {
    const catalogue = zoneOffers(
      {
        menus: [defaultMenu],
        products: [
          { ...cafe, id: "first", name: "Primero", unitPrice: "1.00", menuItemId: "mi-dup" },
          { ...cafe, id: "second", name: "Segundo", unitPrice: "2.00", menuItemId: "mi-dup" },
        ],
      },
      "zone-counter",
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [{ menuItemId: "mi-dup", quantity: "1.000" }],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(c.store.lines.map((line) => line.product.name)).toEqual(["Primero"]);
  });

  it("keeps a line that names no product or selling id from its stored snapshot", async () => {
    const snapshot: TillProduct = { ...cafe, id: "retired", name: "Antiguo", unitPrice: "4.00" };
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [{ quantity: "1.000", product: snapshot }],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(c.store.lines).toHaveLength(1);
    expect(c.store.lines[0]!.product).toMatchObject({ id: "retired", name: "Antiguo" });
    expect(c.store.lines[0]!.quantity).toBe("1");
    expect(banner(el)).toBeNull();
  });
});

describe("till-app shell navigation", () => {
  it("ignores a tab selection naming a tab the canvas does not have", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    const path = location.pathname;

    emit(shell(el)!, "tab-select", { key: "reports" });
    await flush(el);

    expect(shell(el)!.activeTabKey).toBe("counter");
    expect(counter(el)).not.toBeNull();
    expect(location.pathname).toBe(path);
  });

  it("renders the shell with no tab body for a canvas that authors no tabs", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: { formFactor: "till", tabs: [] } }),
    });
    await toCounter(el);

    expect(shell(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
  });

  it("does not open a destination as an overlay when the canvas authors it as a tab", async () => {
    const withScheduleTab: CanvasDef = {
      formFactor: "till",
      tabs: [...tillCanvas.tabs, { key: "schedule", title: "Schedule", columns: 12, cards: [] }],
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: withScheduleTab }),
    });
    await toCounter(el);

    emit(shell(el)!, "show-schedule");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-schedule-screen")).toBeNull();
    expect(location.pathname).not.toContain("schedule");

    emit(shell(el)!, "show-expo");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
  });

  it("hands the shell's language chooser the till's list of interface languages", async () => {
    const { el } = await mountApp();
    await toCounter(el);

    await expect(shell(el)!.loadLocales!()).resolves.toEqual([
      { code: "es-ES", label: "Español" },
      { code: "en-GB", label: "English" },
    ]);
    expect(api.getLocales).toHaveBeenCalledOnce();
  });

  it("probes the servers again when the lock screen asks to check again", async () => {
    const router = new ServerRouter({
      origin: "https://box.deli.test",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as typeof fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const probeNow = vi.spyOn(router, "probeNow").mockResolvedValue(undefined);
    const { el } = await mountApp({}, { router });
    await flush(el);

    emit(lock(el)!, "check-again");

    expect(probeNow).toHaveBeenCalledOnce();
  });
});

/** The bottom edges of the till and the screen it shows, and the box of that screen's language button. */
function edgesOf(el: TillApp, screen: Element) {
  const chooser = screen.shadowRoot!.querySelector("wt-language-chooser")!;
  return {
    app: el.getBoundingClientRect().bottom,
    screen: screen.getBoundingClientRect().bottom,
    chooser: chooser.getBoundingClientRect(),
  };
}

/** The language button is drawn, and lies vertically inside the page: neither above its top nor below its bottom. */
function expectChooserOnPage(chooser: DOMRect, pageBox: DOMRect): void {
  expect(chooser.height).toBeGreaterThan(0);
  expect(chooser.top).toBeGreaterThanOrEqual(pageBox.top);
  expect(chooser.bottom).toBeLessThanOrEqual(pageBox.bottom);
}

// The container stands in for the page: `index.html` gives the till one screen's height, less its own
// padding, so the till must fill that box and no more.
describe("till-app fits the page it is given", () => {
  const PAGE_HEIGHT = 500;
  /** A counter whose products fill far more than the page, as a real menu does, so the shell must
   * shrink below its content rather than to it. */
  const fullMenu = zoneOffers(
    {
      menus: [defaultMenu],
      products: Array.from({ length: 40 }, (_, i) => ({
        ...cafe,
        id: `cafe-${i}`,
        name: `Café ${i}`,
      })),
    },
    "zone-counter",
  );

  it("keeps the tab shell's language button on the page while a refusal banner shows", async () => {
    const { el, host } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
      pay: vi.fn().mockRejectedValue({ code: "device.forbidden_action", status: 403 }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(fullMenu),
    });
    host.style.height = `${PAGE_HEIGHT}px`;
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;

    emit(c, "collect-card", {});
    await flush(el);

    expect(banner(el)).not.toBeNull();
    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, shell(el)!);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });

  it("keeps the whole page within the screen, its padding included, while a refusal banner shows", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(1024, 768);
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
    document.head.append(style);
    applyTokens(document.documentElement);
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
    try {
      api = stubApi({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "simulator",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay: vi.fn().mockRejectedValue({ code: "device.forbidden_action", status: 403 }),
        listDefaultZoneOffers: vi.fn().mockResolvedValue(fullMenu),
      });
      const el = Object.assign(document.createElement("till-app"), { api });
      app.append(el);
      const c = await toCounter(el);
      c.store.addProduct(c.products[0]!, "1");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(banner(el)).not.toBeNull();
      expect(document.documentElement.scrollHeight).toBe(window.innerHeight);
    } finally {
      app.remove();
      style.remove();
      document.documentElement.removeAttribute("data-wt-theme-root");
      await page.viewport(width, height);
    }
  });

  it("keeps the lock screen's language button on the page while its staff list is short", async () => {
    const { el, host } = await mountApp();
    host.style.height = `${PAGE_HEIGHT}px`;
    await flush(el);

    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, lock(el)!);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });

  it("keeps the join screen's language button on the page", async () => {
    const { el, host } = await mountApp({
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    host.style.height = `${PAGE_HEIGHT}px`;
    await flush(el);

    const join = el.shadowRoot!.querySelector("till-enrol-screen")!;
    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, join);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });
});

describe("till-app logout while a request is waiting for the server", () => {
  it("does not start a sale after sign-out overtakes its first await", async () => {
    const recordSale = vi.fn();
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    emit(shell(el)!, "logout");
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
  });

  it("does not place an order after its park answers for a signed-out operator", async () => {
    let answerPark!: () => void;
    const placeOrder = vi.fn();
    const { el } = await mountApp({
      parkOrder: vi.fn(() => new Promise<void>((resolve) => (answerPark = resolve))),
      placeOrder,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    answerPark();
    await flush(el);

    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("does not show the next operator an earlier collection refusal", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      markCollected: vi.fn(() => new Promise<void>((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(api.markCollected).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "server.internal" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not start the waiting-list read when a hand-over's station read outlives sign-out", async () => {
    const { el } = await mountApp({ markCollected: vi.fn().mockResolvedValue(undefined) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "hand-over-order", { id: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not load a retrieved order into the next operator's basket", async () => {
    let answer!: (order: { id: string; orderNumber: number; label: null; lines: [] }) => void;
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    const basketId = c.store.id;
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    answer({ id: "wo-1", orderNumber: 1, label: null, lines: [] });
    await flush(el);

    expect(c.store.id).toBe(basketId);
  });

  it("does not reload held orders for a cash payment refused after sign-out", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    refuse({ code: "bill.payments_received" });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not start later list reads when a cash sale's held-list read outlives sign-out", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    let answerHeld!: (rows: []) => void;
    vi.mocked(api.listWorkingOrders).mockImplementationOnce(
      () => new Promise((resolve) => (answerHeld = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerHeld).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerHeld([]);
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a cash sale's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...zoneOffers(
          { menus: [defaultMenu], products: [cafe] },
          "zone-counter",
          "ticket_then_pay",
        ),
        zones: [zone("zone-counter", "ticket_then_pay")],
      }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a card capture's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...zoneOffers(
          { menus: [defaultMenu], products: [cafe] },
          "zone-counter",
          "ticket_then_pay",
        ),
        zones: [zone("zone-counter", "ticket_then_pay")],
      }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a place's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn().mockResolvedValue(undefined),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a found-bill payment's station read outlives sign-out", async () => {
    const { el } = await mountApp({ collectOrder: vi.fn().mockResolvedValue(saleResult) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a collection's station read outlives sign-out", async () => {
    const { el } = await mountApp({ markCollected: vi.fn().mockResolvedValue(undefined) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload stations for a zone choice answered after sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    let answer!: (catalogue: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn(() => new Promise<ZoneOfferCatalogue>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(api.listZoneOffers).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    answer(zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-deli"));
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
  });

  it("does not choose a menu after a zone's station read outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const deli = zoneOffers(
      { menus: [{ id: "cat-deli", name: "Deli", isDefault: true }], products: [cafe] },
      "zone-deli",
    );
    let answerStations!: (rows: []) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn().mockResolvedValue(deli),
    });
    const c = await toCounter(el);
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const selected = privateState<string>(el, "selectedCatalogueId");
    answerStations([]);
    await flush(el);

    expect(privateState<string>(el, "selectedCatalogueId")).toBe(selected);
  });

  it("does not reload held orders for a retrieve refused after sign-out", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    refuse({ code: "working_order.not_found" });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not reload held orders for a discard answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);
    expect(api.abandonWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not replace a discard refusal after its held-list read outlives sign-out", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const c = await toCounter(el);
    let answerHeld!: (rows: []) => void;
    vi.mocked(api.listWorkingOrders).mockImplementationOnce(
      () => new Promise((resolve) => (answerHeld = resolve)),
    );
    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);
    expect(answerHeld).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    const before = banner(el)?.textContent;
    answerHeld([]);
    await flush(el);

    expect(banner(el)?.textContent).toBe(before);
  });

  it("does not reload station and waiting lists for a found bill payment answered after sign-out", async () => {
    let answer!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer(saleResult);
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload counter lists for a card capture answered after sign-out", async () => {
    let answer!: (result: { outcome: "captured"; ticket: TillSaleResult }) => void;
    const { el } = await mountApp({
      pay: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(api.pay).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer({ outcome: "captured", ticket: saleResult });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not show a card refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      pay: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(api.pay).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not retry a cash sale after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(saleResult);
    const { el } = await mountApp({
      recordSale,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(recordSale).toHaveBeenCalledOnce();
  });

  it("does not retry a card sale after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const pay = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({
      pay,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(pay).toHaveBeenCalledOnce();
  });

  it("does not retry a place after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      placeOrder,
      parkOrder: vi.fn().mockResolvedValue(undefined),
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(placeOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a park after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      parkOrder,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a park after its dead-end recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      parkOrder,
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a cash sale after its save-refusal recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const recordSale = vi.fn();
    const { el } = await mountApp({
      recordSale,
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "station.no_replacement" }),
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    c.store.markPersisted();
    c.store.setLineQuantity(0, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a card sale after its save-refusal recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const pay = vi.fn();
    const { el } = await mountApp({
      pay,
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "station.no_replacement" }),
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    c.store.markPersisted();
    c.store.setLineQuantity(0, "2");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(pay).not.toHaveBeenCalled();
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not show a place refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.placeOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not show a found-bill refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(privateState(el, "findBillError")).toBeUndefined();
  });

  it("does not reload waiting orders for a collect answered after sign-out", async () => {
    let answer!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "collect-order", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer(saleResult);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload station and waiting lists for a place answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.placeOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload held orders for a park answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      parkOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not reload station and waiting lists for a collection answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      markCollected: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(api.markCollected).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not start the waiting read after a refused collection's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      markCollected: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload the station list for a ticket advance answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      advanceTicketItem: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "advance-ticket-item", { itemId: "item-1", to: "ready" });
    await flush(el);
    expect(api.advanceTicketItem).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
  });

  it("stays on the lock screen when a cash sale's answer arrives after the operator logged out", async () => {
    let answerSale!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answerSale = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;

    answerSale(saleResult);
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(shell(el)).toBeNull();
    expect(privateState<string>(el, "operatorName")).toBe("");
    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not retain the earlier operator's sale result after the next operator signs in", async () => {
    let answerSale!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answerSale = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    expect(privateState<TillSaleResult | undefined>(el, "result")).toBeUndefined();
    answerSale(saleResult);
    await flush(el);

    expect(privateState<TillSaleResult | undefined>(el, "result")).toBeUndefined();
  });
});
